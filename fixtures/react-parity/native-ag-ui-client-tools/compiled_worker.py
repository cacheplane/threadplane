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

class CockpitModel(ScriptedModel):
    """History-driven BaseChatModel only; canonical graph/adapter author all events."""
    sequence: int = 0

    def answer(self, messages):
        self.sequence += 1
        identity = f'cockpit-assistant-{self.sequence}'
        last = messages[-1]
        if isinstance(last, ToolMessage):
            latest_human = next((m for m in reversed(messages) if m.type == 'human'), None)
            if latest_human and 'Rounds' in str(latest_human.content):
                after_human = messages[messages.index(latest_human) + 1:]
                if len([m for m in after_human if isinstance(m, ToolMessage)]) == 1:
                    return AIMessage(id=identity, content='', tool_calls=[{'id': f'cockpit-call-{self.sequence}-0', 'name': 'weather_card', 'args': {'location': 'San Francisco', 'temperatureF': 68, 'conditions': 'Sunny', 'humidity': 55, 'windMph': 8}, 'type': 'tool_call'}])
            receipts = [m.content for m in messages if isinstance(m, ToolMessage)]
            return AIMessage(id=identity, content='Canonical local results received: ' + json.dumps(receipts))
        text = str(last.content)
        reading = {'location': 'San Francisco', 'temperatureF': 68, 'conditions': 'Sunny', 'humidity': 55, 'windMph': 8}
        if 'Literal' in text:
            reading['location'] = '<script>San Francisco</script>'
        if 'Malformed' in text:
            names = [('weather_card', {**reading, 'humidity': 101})]
        elif 'Unknown' in text:
            names = [('unknown_weather', {})]
        elif 'Mixed' in text:
            names = [('weather_snapshot', reading), ('get_weather', {'location': 'San Francisco'})]
        elif 'Bookings' in text:
            names = [('confirm_booking', {'summary': 'Fictional dinner A'}), ('confirm_booking', {'summary': 'Fictional dinner B'})]
        elif 'confirm_booking' in text:
            names = [('confirm_booking', {'summary': 'Fictional dinner booking'})]
        elif 'slow_status_check' in text:
            names = [('slow_status_check', {'label': 'demo check'})]
        elif 'weather_snapshot' in text:
            names = [('weather_snapshot', reading)]
        elif 'weather_card' in text:
            names = [('weather_card', reading)]
        elif 'get_weather' in text:
            names = [('get_weather', {'location': 'San Francisco'})]
        else:
            return AIMessage(id=identity, content='Canonical plain answer: ' + text)
        return AIMessage(id=identity, content='', tool_calls=[{'id': f'cockpit-call-{self.sequence}-{index}', 'name': name, 'args': args, 'type': 'tool_call'} for index, (name, args) in enumerate(names)])

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed_messages.append([m.model_dump(mode='json') for m in messages])
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

class CockpitStreamingModel(CockpitModel):
    streaming: bool = False
    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed_messages.append([m.model_dump(mode='json') for m in messages])
        answer = self.answer(messages)
        if not answer.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content=answer.content))
            return
        for index, call in enumerate(answer.tool_calls):
            arguments = json.dumps(call['args'])
            split = max(1, len(arguments) // 2)
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content='', tool_call_chunks=[{'id': call['id'], 'name': call['name'], 'args': '', 'index': index}]))
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content='', tool_call_chunks=[{'id': None, 'name': None, 'args': arguments[:split], 'index': index}]))
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content='', tool_call_chunks=[{'id': None, 'name': None, 'args': arguments[split:], 'index': index}]))
        yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content='', response_metadata={'finish_reason': 'tool_calls'}))

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
    scenario = sys.argv[2] if len(sys.argv) > 2 else None
    assert scenario in [None, 'cockpit']
    if scenario == 'cockpit':
        model = CockpitStreamingModel(streaming=True) if mode == 'stream' else CockpitModel()
    module._base_llm = model
    graph = module.build_client_tools_graph()
    agent = LangGraphAgent(name='offline-canonical-client-tools', graph=graph)
    paths = [Path(__file__), ROOT / 'cockpit/ag-ui/client-tools/python/src/graph.py', ROOT / 'cockpit/ag-ui/client-tools/python/prompts/client-tools.md', ROOT / 'cockpit/ag-ui/client-tools/python/uv.lock', ROOT / 'cockpit/ag-ui/client-tools/python/pyproject.toml']
    modules = {name: str(Path(sys.modules[name].__file__).resolve()) for name in ['src.graph', 'ag_ui_langgraph.agent', 'threadplane.middleware.langgraph.middleware']}
    paths.extend(Path(value) for value in modules.values())
    identity = {'pid': os.getpid(), 'python': sys.version.split()[0], 'mode': mode, 'scenario': scenario, 'environment': sys.prefix, 'modules': modules, 'socketAttempts': socket_attempts, 'blockedSocketConstructions': blocked_socket_constructions, 'versions': {name: importlib.metadata.version(name) for name in ['ag-ui-langgraph', 'ag-ui-protocol', 'langgraph', 'langchain-core']}, 'sources': [{'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in dict.fromkeys(paths)]}
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
