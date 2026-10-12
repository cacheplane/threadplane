"""Private bounded worker: actual Memory builder, one owned store for its lifetime."""
import os
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'
import asyncio
from contextlib import redirect_stdout, nullcontext
from copy import deepcopy
from dataclasses import asdict, is_dataclass
import hashlib
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch
from uuid import UUID

NETWORK_GUARD = patch.object(socket.socket, 'connect', side_effect=AssertionError('Remote socket forbidden'))
NETWORK = NETWORK_GUARD.start()
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'cockpit/deep-agents/memory/python'
sys.path[:0] = [str(PROJECT), str(PROJECT / 'tests')]
from test_streaming import MemoryModel, SCENARIOS
from model_support import CountingStore, load
from deepagents.backends import StoreBackend
from src.memory_observation import validate_scope

SOURCES = ('src/graph.py', 'src/memory_observation.py', 'tests/test_streaming.py', 'tests/model_support.py', 'prompts/memory.md', 'uv.lock')
MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024
SCENARIO_NAMES = set(SCENARIOS) | {'fail-initial', 'fail-model', 'fail-terminal'}

def encode(value):
    if hasattr(value, 'model_dump'):
        return value.model_dump(mode='json')
    if is_dataclass(value):
        return asdict(value)
    raise TypeError('Unsupported graph wire value')

def checkpoint(state):
    fields = ('thread_id', 'checkpoint_id', 'checkpoint_ns', 'checkpoint_map')
    return {
        'values': state.values, 'next': list(state.next),
        'checkpoint': {k:v for k,v in state.config['configurable'].items() if k in fields},
        'parent_checkpoint': {k:v for k,v in state.parent_config['configurable'].items() if k in fields} if state.parent_config else None,
        'created_at': state.created_at, 'metadata': state.metadata,
        'tasks': [{'id':t.id, 'name':t.name,
                   **({'error': t.error} if t.error is not None else {}),
                   **({'state': t.state} if t.state is not None else {}),
                   'interrupts':[{'id':i.id,'value':i.value} for i in t.interrupts]} for t in state.tasks],
    }

def valid_uuid(value):
    try:
        return isinstance(value,str) and len(value)==36 and UUID(value).version==4 and str(UUID(value))==value
    except ValueError:
        return False

async def main():
    # Block sockets before loading any actual graph modules/model constructors.
    with nullcontext(NETWORK) as network:
        model, store = MemoryModel(), CountingStore()
        with redirect_stdout(sys.stderr):
            _, graph = load(model, store=store)
        owners, seen, request_ids = set(), set(), set()
        known = {}
        scenario = 'teach'
        provenance = {}
        while line := sys.stdin.buffer.readline(MAX_REQUEST + 1):
            request = {}
            try:
                if len(line)>MAX_REQUEST or not line.endswith(b'\n'):
                    # A broken frame cannot be resynchronized safely.
                    raise EOFError('Invalid bounded request frame')
                request = json.loads(line)
                if not isinstance(request,dict):
                    raise ValueError('Malformed request')
                request_id = request.get('requestId')
                if type(request_id) is not int or request_id<=0 or request_id in request_ids or len(request_ids)>=2000:
                    raise EOFError('Invalid/replayed request identity')
                request_ids.add(request_id)
                op = request.get('op')
                fields = {'create':{'threadId'}, 'configure':{'scenario'}, 'state':{'threadId','checkpoint'},
                          'history':{'threadId','limit'}, 'submit':{'threadId','messages','context'}}
                if op not in fields or set(request)-({'requestId','op'}|fields[op]):
                    raise ValueError('Unsupported operation fields')
                thread = request.get('threadId')
                config = {'configurable': {'thread_id': thread}}
                if op=='create':
                    if not valid_uuid(thread) or thread in owners or len(owners)>=100:
                        raise ValueError('Invalid/duplicate owner')
                    owners.add(thread)
                    known[thread] = set()
                elif op!='configure' and thread not in owners:
                    raise ValueError('Unknown owner')
                if 'checkpoint' in request:
                    cp = request['checkpoint']
                    if (not isinstance(cp,dict) or set(cp)-{'thread_id','checkpoint_id','checkpoint_ns','checkpoint_map'}
                        or cp.get('thread_id')!=thread or cp.get('checkpoint_ns')!=''
                        or cp.get('checkpoint_id') not in known[thread]
                        or ('checkpoint_map' in cp and cp['checkpoint_map']!={'':cp['checkpoint_id']})):
                        raise ValueError('Unknown/foreign root checkpoint')
                    config['configurable'].update(cp)
                with redirect_stdout(sys.stderr):
                    result = {}
                    scope = None
                    if op=='configure':
                        if request.get('scenario') not in SCENARIO_NAMES:
                            raise ValueError('Unsupported scenario')
                        scenario = request['scenario']
                    elif op=='state':
                        result['state'] = checkpoint(await graph.aget_state(config))
                    elif op=='history':
                        limit = request.get('limit',10)
                        if type(limit) is not int or not 1<=limit<=100:
                            raise ValueError('Invalid bounded history query')
                        result['history'] = [checkpoint(s) async for s in graph.aget_state_history(config,limit=limit)]
                    elif op=='submit':
                        scope = validate_scope(request.get('context'))
                        messages = request.get('messages')
                        if not isinstance(messages,list) or len(messages)!=1:
                            raise ValueError('Expected one actual human')
                        human = messages[0]
                        if (not isinstance(human,dict) or set(human)!={'type','id','content'} or human['type']!='human'
                            or not isinstance(human['id'],str) or not human['id'].strip() or len(human['id'])>256
                            or not isinstance(human['content'],str) or len(human['content'].encode())>65536):
                            raise ValueError('Invalid actual human')
                        identity = (thread,human['id'])
                        if identity in seen:
                            raise ValueError('Replayed human')
                        seen.add(identity)
                        model.calls = SCENARIOS['teach' if scenario=='fail-terminal' else 'recall' if scenario.startswith('fail-') else scenario]
                        provenance[thread] = {'scenario':scenario,'memoryScope':scope}
                        events = []
                        prompt_start, operation_start = len(model.prompts), len(store.operations)
                        read_count = 0
                        original = StoreBackend.download_files
                        failure_read = {'fail-initial':1,'fail-model':2,'fail-terminal':4}.get(scenario)
                        def controlled_failure(backend,paths):
                            nonlocal read_count
                            read_count += 1
                            if read_count==failure_read:
                                raise RuntimeError('Controlled offline backend read failure')
                            return original(backend,paths)
                        with patch.object(StoreBackend,'download_files',controlled_failure) if failure_read else nullcontext():
                            try:
                                async for namespace,kind,event in graph.astream(
                                    {'messages':messages},config,context=request['context'],
                                    output_keys=graph.output_channels,subgraphs=True,
                                    stream_mode=['messages','values','updates','checkpoints','custom']):
                                    events.append([list(namespace),kind,deepcopy(event)])
                                    if kind=='checkpoints' and not namespace:
                                        known[thread].add(event['config']['configurable']['checkpoint_id'])
                            except Exception as failure:
                                result['failure'] = type(failure).__name__
                        state = await graph.aget_state(config)
                        if state.config['configurable'].get('checkpoint_id'):
                            known[thread].add(state.config['configurable']['checkpoint_id'])
                        result.update(events=events,state=checkpoint(state),
                                      modelPrompts=model.prompts[prompt_start:],
                                      storeOperations=[{'type':type(o).__name__,'namespace':getattr(o,'namespace',None),'key':getattr(o,'key',None)} for o in store.operations[operation_start:]])
                    network.assert_not_called()
                    result['proof'] = {
                        'actualCompiledGraph': True, 'op':op,'threadId':thread, 'pythonPid':os.getpid(),
                        **provenance.get(thread,{'scenario':scenario,'memoryScope':None}),
                        'sourceSha256':{p:hashlib.sha256((PROJECT/p).read_bytes()).hexdigest() for p in SOURCES},
                        'workerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                        'networkConnectAttempts':network.call_count,
                    }
                    result['requestId'] = request_id
                    wire = json.dumps(result,default=encode,ensure_ascii=False).encode()
                    if len(wire)>MAX_RESPONSE:
                        raise EOFError('Oversized response')
                sys.stdout.buffer.write(wire+b'\n')
                sys.stdout.buffer.flush()
            except EOFError:
                return
            except Exception:
                print(json.dumps({'requestId':request.get('requestId') if isinstance(request,dict) else None,'error':'Graph operation failed'}),flush=True)

asyncio.run(main())
