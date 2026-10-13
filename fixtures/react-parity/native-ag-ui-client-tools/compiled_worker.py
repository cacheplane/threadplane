"""Bounded offline oracle: actual canonical graph, middleware and locked adapter.

Only the canonical module's _base_llm is replaced. This worker never generates
AG-UI events itself: every event is normalized from LangGraphAgent.run.
"""
import asyncio
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import traceback

ROOT = Path(__file__).resolve().parents[3]
MAX_BYTES = 2_000_000
MAX_REQUESTS = 12
os.environ['OPENAI_API_KEY'] = 'local-scripted-model-unused'
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'
for key in list(os.environ):
    if key.endswith('_API_KEY') and key != 'OPENAI_API_KEY' or key in ['LANGSMITH_ENDPOINT', 'LANGCHAIN_ENDPOINT']:
        os.environ.pop(key, None)
socket_attempts = []
blocked_socket_constructions = []

def deny_socket(self, address, *args):
    socket_attempts.append(str(address))
    raise RuntimeError('External sockets forbidden in offline canonical worker')

socket.socket.connect = deny_socket
socket.socket.connect_ex = deny_socket
socket.socket.sendto = deny_socket
def audit_network(event, args):
    if event == 'socket.__new__' and args[1] in [socket.AF_INET, socket.AF_INET6]:
        blocked_socket_constructions.append({'event': event, 'family': int(args[1]), 'stack': [f'{frame.filename}:{frame.lineno}:{frame.name}' for frame in traceback.extract_stack(limit=8)]})
        raise RuntimeError('Internet socket construction forbidden in offline canonical worker')
    if event in ['socket.connect', 'socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyaddr', 'socket.getnameinfo', 'socket.sendto', 'socket.sendmsg']:
        socket_attempts.append(event)
        raise RuntimeError('External socket operations and DNS forbidden in offline canonical worker')

sys.addaudithook(audit_network)
sys.path.insert(0, str(ROOT / 'packages/threadplane-middleware/src'))
sys.path.insert(0, str(ROOT / 'cockpit/ag-ui/client-tools/python'))

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field
from ag_ui.core import RunAgentInput
from ag_ui_langgraph import LangGraphAgent

class ScriptedModel(BaseChatModel):
    catalogs: list = Field(default_factory=list)
    observed_messages: list = Field(default_factory=list)
    call_name: str = 'get_weather'

    @property
    def _llm_type(self):
        return 'offline-canonical-client-tools-fixture'

    def bind_tools(self, tools, **kwargs):
        self.catalogs.append(tools)
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed_messages.append([m.model_dump(mode='json') for m in messages])
        answer = AIMessage(id='scripted-final-answer', content='Scripted weather receipt received.') if any(isinstance(m, ToolMessage) for m in messages) else AIMessage(id='scripted-weather-call', content='', tool_calls=[{'id': 'scripted-weather-call-id', 'name': self.call_name, 'args': {'location': 'KASE'}, 'type': 'tool_call'}])
        return ChatResult(generations=[ChatGeneration(message=answer)])

class ScriptedStreamingModel(ScriptedModel):
    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed_messages.append([m.model_dump(mode='json') for m in messages])
        if any(isinstance(m, ToolMessage) for m in messages):
            yield ChatGenerationChunk(message=AIMessageChunk(id='scripted-final-answer', content='Scripted weather receipt received.'))
        else:
            yield ChatGenerationChunk(message=AIMessageChunk(id='scripted-weather-call', content='', tool_call_chunks=[{'id': 'scripted-weather-call-id', 'name': self.call_name, 'args': '{"location":', 'index': 0}]))
            yield ChatGenerationChunk(message=AIMessageChunk(id='scripted-weather-call', content='', tool_call_chunks=[{'id': None, 'name': None, 'args': '"KASE"}', 'index': 0}]))
            yield ChatGenerationChunk(message=AIMessageChunk(id='scripted-weather-call', content='', response_metadata={'finish_reason': 'tool_calls'}))

def emit(value):
    encoded = json.dumps(value, separators=(',', ':'))
    if len(encoded.encode()) > MAX_BYTES:
        raise RuntimeError('worker output bound exceeded')
    print(encoded, flush=True)

async def main():
    assert sys.version_info[:2] == (3, 12), 'Canonical fixture requires actual Python 3.12'
    mode = sys.argv[1] if len(sys.argv) > 1 else 'nonstream'
    assert mode in ['nonstream', 'stream', 'unknown']
    module = importlib.import_module('src.graph')
    model = ScriptedStreamingModel() if mode == 'stream' else ScriptedModel(call_name='unknown_weather' if mode == 'unknown' else 'get_weather')
    module._base_llm = model
    graph = module.build_client_tools_graph()
    agent = LangGraphAgent(name='offline-canonical-client-tools', graph=graph)
    paths = [Path(__file__), ROOT / 'cockpit/ag-ui/client-tools/python/src/graph.py', ROOT / 'cockpit/ag-ui/client-tools/python/prompts/client-tools.md', ROOT / 'cockpit/ag-ui/client-tools/python/uv.lock', ROOT / 'cockpit/ag-ui/client-tools/python/pyproject.toml']
    modules = {name: str(Path(sys.modules[name].__file__).resolve()) for name in ['src.graph', 'ag_ui_langgraph.agent', 'threadplane.middleware.langgraph.middleware']}
    paths.extend(Path(value) for value in modules.values())
    identity = {'pid': os.getpid(), 'python': sys.version.split()[0], 'mode': mode, 'modules': modules, 'socketAttempts': socket_attempts, 'blockedSocketConstructions': blocked_socket_constructions, 'versions': {name: importlib.metadata.version(name) for name in ['ag-ui-langgraph', 'ag-ui-protocol', 'langgraph', 'langchain-core']}, 'sources': [{'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in dict.fromkeys(paths)]}
    emit({'ready': identity})
    count = 0
    while True:
        line = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_BYTES + 1)
        if not line:
            break
        count += 1
        try:
            if len(line) > MAX_BYTES or not line.endswith(b'\n') or count > MAX_REQUESTS:
                raise RuntimeError('worker request bound exceeded')
            input = RunAgentInput.model_validate(json.loads(line))
            async def collect():
                events = []
                async for event in agent.run(input):
                    if len(events) >= 256:
                        raise RuntimeError('worker event bound exceeded')
                    events.append(event.model_dump(mode='json', by_alias=True, exclude_none=True))
                return events
            events = await asyncio.wait_for(collect(), timeout=15)
            emit({'events': events, 'observations': {'requestCount': count, 'workerPid': os.getpid(), 'graphIdentity': id(graph), 'checkpointerIdentity': id(graph.checkpointer), 'modelIdentity': id(model), 'modelCatalogs': model.catalogs, 'modelMessages': model.observed_messages, 'socketAttempts': socket_attempts}})
        except Exception as error:
            emit({'error': str(error), 'socketAttempts': socket_attempts})
            break

if __name__ == '__main__':
    asyncio.run(main())
