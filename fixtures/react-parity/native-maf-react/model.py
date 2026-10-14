"""Local OpenAI chat.completions seam. Positive AG-UI events come only from the installed generated service."""
import base64
import http.server
import json
import select
import socket
import threading
import time
from urllib.request import Request, urlopen

EXPENSE = {'vendor':'Blue Finch Bistro','category':'meals','amount_usd':220,'memo':'Team dinner for 4 attendees; receipt attached.'}
APPROVED = 'Expense recorded: $220.00 to Blue Finch Bistro (meals) — queued for reimbursement.'
REJECTED = 'Error: Tool call invocation was rejected by user.'
POLICY = 'Policy for meals: limit $300 per expense, receipts required over $25. Team meals require attendee count in the memo.'
class Model(http.server.ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,mode):
        super().__init__(('127.0.0.1',0),Handler)
        self.mode=mode; self.physical=[]; self.http_seen=0; self.parse_errors=[]; self.records=[]; self.errors=[]; self.active=0; self.held_active=0; self.connections=0; self.closing=threading.Event(); self.lock=threading.Lock()
    def stats(self):
        return {'physical':list(self.physical),'requests':len(self.records),'httpSeen':self.http_seen,'parseErrors':list(self.parse_errors),'active':self.active,'heldActive':self.held_active,'connections':self.connections,'errors':self.errors,'records':[dict(r) for r in self.records]}
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def setup(self):
        super().setup()
        self.server.connections+=1
    def finish(self):
        try: super().finish()
        finally:self.server.connections-=1
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path!='/stats': self.send_error(404); return
        raw=json.dumps(self.server.stats()).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        model=self.server
        # Count the HTTP request before path/body/JSON validation. The parent owns
        # this counter; the append-only checkpoint also survives partial attempts.
        with model.lock:
            model.http_seen+=1
            model.physical.append({'sequence':model.http_seen,'path':self.path,'time':time.monotonic()})
        if self.path!='/v1/chat/completions': self.send_error(404); return
        raw=b''
        try:
            raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
            parsed=json.loads(raw)
        except Exception as exc:
            failure={'path':self.path,'requestBase64':base64.b64encode(raw).decode(),'stage':'body-read-or-json','error':repr(exc)}
            with model.lock:
                model.parse_errors.append(failure)

            self.send_error(400,'Invalid model request body');return
        record={'path':self.path,'requestBase64':base64.b64encode(raw).decode(),'body':parsed,'responseBase64':'','closed':False,'receivedAtMonotonic':time.monotonic(),'peerAddress':self.client_address,'localAddress':self.connection.getsockname()}
        with model.lock: model.records.append(record); model.active+=1
        try:
            if len(model.records)>30:raise RuntimeError('local fixture model request safety bound exceeded')
            body=record['body']; messages=body['messages']; tools=[message for message in messages if message.get('role')=='tool']
            submit=[message for message in tools if message.get('tool_call_id')=='c0_submit_expense']
            if model.mode=='cancel':
                record['branch']='hold'; model.held_active+=1;record['heldCounterReleased']=False
                self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Connection','close'); self.end_headers()
                chunk=self.chunk({'role':'assistant','content':''})
                data=('data: '+json.dumps(chunk)+'\n\n').encode(); self.wfile.write(data);self.wfile.flush();record['responseBase64']=base64.b64encode(data).decode()
                deadline=time.monotonic()+30
                while not model.closing.is_set() and time.monotonic()<deadline:
                    readable,_,_=select.select([self.connection],[],[],0.05)
                    if readable:
                        try:
                            peer_closed=self.connection.recv(1,socket.MSG_PEEK)==b''
                            record['peerCloseKind']='EOF' if peer_closed else None
                        except ConnectionResetError:
                            peer_closed=True;record['peerCloseKind']='reset'
                        if peer_closed:record['peerClosed']=True;break
                else:
                    if not model.closing.is_set(): raise RuntimeError('held model timed out')
                record['peerClosedAtMonotonic']=time.monotonic() if record.get('peerClosed') else None
                record['heldReleasedByCleanup']=model.closing.is_set()
                model.held_active-=1;record['heldCounterReleased']=True
                return
            if submit:
                if len(submit)!=1: raise RuntimeError('unexpected submit result count')
                result=submit[0].get('content')
                record['actualContinuationToolContent']=result
                if result==APPROVED: content='The fictional $220.00 Blue Finch Bistro expense was submitted for reimbursement.'
                elif result==REJECTED: content='The fictional Blue Finch Bistro expense was not submitted.'
                else: raise RuntimeError('unknown actual submit result: '+repr(result))
                record['branch']='continuation-approve' if result==APPROVED else 'continuation-decline'
                deltas=[{'role':'assistant','content':''},{'content':content}]; message={'role':'assistant','content':content}; finish='stop'
            elif tools:
                if len(tools)!=1 or tools[0].get('tool_call_id')!='c0_lookup_expense_policy' or tools[0].get('content')!=POLICY:
                    raise RuntimeError('unknown tool continuation branch')
                record['branch']='submit-expense'
                args=json.dumps({'expense':EXPENSE},separators=(',',':'))
                parts=[args[:23],args[23:64],args[64:107],args[107:]]
                deltas=[{'role':'assistant','content':''},{'tool_calls':[{'index':0,'id':'c0_submit_expense','type':'function','function':{'name':'submit_expense','arguments':''}}]}]
                deltas += [{'tool_calls':[{'index':0,'function':{'arguments':part}}]} for part in parts]
                message={'role':'assistant','content':None,'tool_calls':[{'id':'c0_submit_expense','type':'function','function':{'name':'submit_expense','arguments':args}}]};finish='tool_calls'
            else:
                if not any(message.get('role')=='user' and 'Blue Finch Bistro' in str(message.get('content')) for message in messages):
                    raise RuntimeError('unknown initial branch')
                record['branch']='lookup-policy'
                call={'id':'c0_lookup_expense_policy','type':'function','function':{'name':'lookup_expense_policy','arguments':'{"category":"meals"}'}}
                deltas=[{'role':'assistant','content':''},{'tool_calls':[{'index':0,**call}]}]
                message={'role':'assistant','content':None,'tool_calls':[call]};finish='tool_calls'
            if body.get('stream'):
                chunks=[self.chunk(delta) for delta in deltas]+[self.chunk({},finish)]
                data=b''.join(('data: '+json.dumps(chunk)+'\n\n').encode() for chunk in chunks)+b'data: [DONE]\n\n'
                record['responseBase64']=base64.b64encode(data).decode()
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers()
                # Chunk boundaries and partial arguments are real provider frames; never AG-UI events.
                for chunk in chunks:
                    self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode());self.wfile.flush();time.sleep(.015)
                self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
            else:
                value={'id':'chatcmpl-c0','object':'chat.completion','created':int(time.time()),'model':'c0-loopback','choices':[{'index':0,'message':message,'finish_reason':finish}],'usage':{'prompt_tokens':0,'completion_tokens':0,'total_tokens':0}}
                data=json.dumps(value).encode();record['responseBase64']=base64.b64encode(data).decode()
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        except Exception as exc:
            record['error']=repr(exc);model.errors.append(repr(exc))
            try:self.send_error(500,'C0 unknown model branch')
            except OSError:pass
        finally:
            if record.get('branch')=='hold' and not record.get('heldCounterReleased'):
                model.held_active-=1;record['heldCounterReleased']=True
            record['closed']=True
            model.active-=1
            self.close_connection=True
    def chunk(self,delta,finish=None):
        return {'id':'chatcmpl-c0','object':'chat.completion.chunk','created':int(time.time()),'model':'c0-loopback','choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
