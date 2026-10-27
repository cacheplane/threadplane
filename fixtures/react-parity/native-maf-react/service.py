"""Test-only direct mount of unchanged generated service with passive instrumentation."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import signal
import sys
import threading
from contextlib import nullcontext
from model import Model

ROOT = Path(os.environ['MAF_FIXTURE_ROOT'])
model = Model(os.environ['MAF_FIXTURE_MODE'])
model_thread = threading.Thread(target=model.serve_forever, daemon=True)
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex
def checked_address(address):
    if not isinstance(address, tuple) or address[:2] != ('127.0.0.1', model.server_port):
        raise RuntimeError('Fixture blocked non-owned model destination')
def connect(self, address):
    checked_address(address); return original_connect(self, address)
def connect_ex(self, address):
    checked_address(address); return original_connect_ex(self, address)
socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
os.environ['OPENAI_BASE_URL'] = f'http://127.0.0.1:{model.server_port}/v1'
sys.path.insert(0, str(ROOT / 'deployments/ag-ui-maf'))
import server
from deps.microsoft_agent_framework.src import agent as agent_module
target = agent_module.submit_expense.func.__code__
entries = 0
def profile(frame, event, arg):
    global entries
    if event == 'call' and frame.f_code is target: entries += 1
sys.setprofile(profile)
threading.setprofile(profile)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
@server.app.get('/fixture-stats')
def stats():
    return {'entries':entries, 'model':model.stats(), 'pid':os.getpid(), 'python':sys.version,
            'modelPort':model.server_port,
            'modules':{name:{'path':module.__file__,'sha256':sha(module.__file__)} for name,module in
                       [('generated_server',server),('generated_agent',agent_module)]},
            'profile':{'filename':target.co_filename,'firstlineno':target.co_firstlineno,'sourceSha256':sha(target.co_filename),'kind':'passive sys.setprofile; no body replacement'},
            'versions':{name:importlib.metadata.version(name) for name in
                        ['agent-framework-ag-ui','agent-framework-core','agent-framework-openai','openai','anyio','sse-starlette']}}

if __name__ == '__main__':
    import uvicorn
    # Own the model before starting the service. The outer finally covers failed startup too.
    model_thread.start()
    try:
        owned_server = uvicorn.Server(uvicorn.Config(server.app, host='127.0.0.1', port=int(os.environ['MAF_FIXTURE_PORT']), log_level='warning', timeout_graceful_shutdown=2))
        # Uvicorn's default capture_signals re-raises SIGTERM after shutdown, before
        # our final model receipt. Own the signal settlement explicitly instead.
        owned_server.capture_signals = nullcontext
        for name in (signal.SIGINT, signal.SIGTERM):
            signal.signal(name, lambda *_: setattr(owned_server, 'should_exit', True))
        owned_server.run()
    finally:
        model.closing.set(); model.shutdown(); model.server_close(); model_thread.join(timeout=3)
        print(json.dumps({'fixtureClosed':True,'model':model.stats(),'modelThreadClosed':not model_thread.is_alive()}),flush=True)
