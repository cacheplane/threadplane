"""Frozen models exercise the authored graph, callbacks and actual bridge."""
import importlib.util
import json
from pathlib import Path
import sys
import types
from unittest.mock import patch
from uuid import uuid4

from ag_ui.core import RunAgentInput
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
import pytest


class FrozenSubagentModel(BaseChatModel):
    orchestrator: bool = False
    streaming: bool = False

    @property
    def _llm_type(self):
        return 'frozen-subagent-callback-model'

    def bind_tools(self, tools, **kwargs):
        assert [tool.name for tool in tools] == ['task']
        assert set(tools[0].tool_call_schema.model_json_schema()['properties']) == {'role', 'task_description'}
        self.orchestrator = True
        return self

    def selection(self, messages):
        if not self.orchestrator:
            if messages[-1].content.startswith('failure:') and 'Booking Agent' in messages[0].content:
                raise ValueError('private-provider-marker-14')
            if messages[-1].content.startswith('empty:'):
                return [], ''
            return [], 'A fictional specialist observation.'
        index = max(i for i, message in enumerate(messages) if isinstance(message, HumanMessage))
        human = messages[index]
        results = [message for message in messages[index + 1:] if isinstance(message, ToolMessage)]
        mode = human.content
        if mode == 'direct' or len(results) >= (6 if mode == 'rounds' else 3):
            return [], 'A fictional parent summary.'
        roles = ['research', 'booking', 'itinerary']
        selected = roles if mode == 'batch' else [roles[len(results) % 3]]
        return [{
            'id': f'specialist-{human.id}-{len(results)}-{role}', 'name': 'task',
            'args': {'role': role, 'task_description': f'{mode}: a fictional LAX to JFK trip.'},
        } for role in selected], ''

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        calls, text = self.selection(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text, tool_calls=calls))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        calls, text = self.selection(messages)
        if calls:
            for index, call in enumerate(calls):
                yield ChatGenerationChunk(message=AIMessageChunk(content='', tool_call_chunks=[{
                    'index': index, 'id': call['id'], 'name': call['name'], 'args': json.dumps(call['args']),
                }]))
        else:
            if not text:
                yield ChatGenerationChunk(message=AIMessageChunk(content=''))
            for character in text:
                yield ChatGenerationChunk(message=AIMessageChunk(content=character))


class FrozenThreads:
    async def get(self, *args, **kwargs):
        return {'metadata': {'title': 'Already titled'}}


def actual_modules():
    source = Path(__file__).resolve().parents[1] / 'src'
    name = f'frozen_subagents_{uuid4().hex}'
    package = types.ModuleType(name)
    package.__path__ = [str(source)]
    sys.modules[name] = package

    def load(suffix, path):
        spec = importlib.util.spec_from_file_location(name + suffix, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name + suffix] = module
        spec.loader.exec_module(module)
        return module

    client = types.SimpleNamespace(threads=FrozenThreads())
    with patch('langchain_openai.ChatOpenAI', side_effect=lambda **kw: FrozenSubagentModel(
        streaming=kw.get('streaming', False),
    )) as provider, patch('langgraph_sdk.get_client', return_value=client):
        module = load('.graph', source / 'graph.py')
        emitter = load('.streaming.subagent_emitting_agent', source / 'streaming/subagent_emitting_agent.py')
    assert provider.call_args_list[0].kwargs == {'model': 'gpt-5-mini', 'streaming': True}
    return module, emitter, name


def request(thread, run, messages):
    return RunAgentInput.model_validate({
        'threadId': thread, 'runId': run, 'protocolVersion': '1.0',
        'messages': messages, 'state': {}, 'tools': [], 'context': [], 'forwardedProps': {},
    })


async def run_actual(agent, body, captured=None):
    with patch('langchain_openai.ChatOpenAI', side_effect=lambda **kw: FrozenSubagentModel(
        streaming=kw.get('streaming', False),
    )), patch('langgraph_sdk.get_client', return_value=types.SimpleNamespace(threads=FrozenThreads())):
        events = [] if captured is None else captured
        async for event in agent.run(body):
            events.append(event.model_dump(mode='json', by_alias=True, exclude_none=True))
    return events


def final_messages(events):
    return next(event['messages'] for event in reversed(events) if event['type'] == 'MESSAGES_SNAPSHOT')


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['sequential', 'batch'])
async def test_actual_specialists_keep_stable_causal_results_and_child_lifecycle(mode):
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    body = request(str(uuid4()), str(uuid4()), [{'id': 'human-' + uuid4().hex, 'role': 'user', 'content': mode}])
    events = await run_actual(agent, body)
    assert events[0]['protocolVersion'] == '1.0'
    assert events[-1] == {'type': 'RUN_FINISHED', 'threadId': body.thread_id, 'runId': body.run_id}
    started = [event for event in events if event['type'] == 'SUBAGENT_STARTED']
    finished = [event for event in events if event['type'] == 'SUBAGENT_FINISHED']
    assert [event['name'] for event in started] == ['research', 'booking', 'itinerary']
    assert len(finished) == 3
    final = final_messages(events)
    results = [message for message in final if message['role'] == 'tool']
    assert len(results) == 3
    streamed = {event['toolCallId']: event['messageId'] for event in events if event['type'] == 'TOOL_CALL_RESULT'}
    for child in started:
        call = child['parentToolCallId']
        child_id = child['subagentRunId']
        assert child_id == call + '-sub'
        assert next(event for event in finished if event['subagentRunId'] == child_id)['outcome'] == {'type': 'success'}
        text = ''.join(event['delta'] for event in events if event['type'] == 'TEXT_MESSAGE_CONTENT' and event.get('subagentRunId') == child_id)
        result = next(message for message in results if message['toolCallId'] == call)
        assert text == result['content'] == 'A fictional specialist observation.'
        assert result['id'] == streamed[call] == call
    assert not any(message.get('subagentRunId') for message in final)
    assert final[-1]['role'] == 'assistant' and final[-1]['content'] == 'A fictional parent summary.'


@pytest.mark.asyncio
async def test_actual_direct_reply_has_no_delegation():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    body = request(str(uuid4()), str(uuid4()), [{'id': 'direct-human', 'role': 'user', 'content': 'direct'}])
    events = await run_actual(agent, body)
    assert not any(event['type'].startswith('SUBAGENT_') for event in events)
    final = final_messages(events)
    assert [message['role'] for message in final] == ['user', 'assistant']
    assert final[-1]['content'] == 'A fictional parent summary.'


@pytest.mark.asyncio
async def test_actual_followup_preserves_full_parent_history_without_child_injection():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    thread = str(uuid4())
    first = await run_actual(agent, request(thread, str(uuid4()), [{'id': 'first-human', 'role': 'user', 'content': 'sequential'}]))
    prefix = final_messages(first)
    second = await run_actual(agent, request(thread, str(uuid4()), prefix + [{'id': 'second-human', 'role': 'user', 'content': 'direct'}]))
    final = final_messages(second)
    assert final[:len(prefix)] == prefix
    assert len(final) == len(prefix) + 2
    assert not any(message.get('subagentRunId') for message in final)


@pytest.mark.asyncio
async def test_actual_multiple_rounds_keep_each_child_and_parent_call_distinct():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    events = await run_actual(agent, request(str(uuid4()), str(uuid4()), [{'id': 'rounds-human', 'role': 'user', 'content': 'rounds'}]))
    children = [event for event in events if event['type'] == 'SUBAGENT_STARTED']
    results = [message for message in final_messages(events) if message['role'] == 'tool']
    assert len(children) == len(results) == 6
    assert len({child['subagentRunId'] for child in children}) == 6
    assert {child['parentToolCallId'] for child in children} == {message['id'] for message in results}
    assert all(message['id'] == message['toolCallId'] for message in results)


@pytest.mark.asyncio
async def test_actual_nonstreaming_child_still_has_lifecycle_and_full_parent_result():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    # The graph captures its provider symbol at import. Replace that selected
    # symbol, retaining actual constructor arguments while the frozen provider
    # deliberately returns a nonstreaming completion.
    with patch.object(module, 'ChatOpenAI', side_effect=lambda **kw: FrozenSubagentModel(disable_streaming=True)) as provider:
        events = await run_actual(agent, request(str(uuid4()), str(uuid4()), [{'id': 'silent-human', 'role': 'user', 'content': 'sequential'}]))
    assert all(call.kwargs == {'model': 'gpt-5-mini', 'streaming': True} for call in provider.call_args_list)
    assert len([event for event in events if event['type'] == 'SUBAGENT_FINISHED']) == 3
    assert not any(event['type'] == 'TEXT_MESSAGE_CONTENT' and event.get('subagentRunId') for event in events)
    results = [message for message in final_messages(events) if message['role'] == 'tool']
    assert len(results) == 3 and all(message['content'] == 'A fictional specialist observation.' for message in results)


@pytest.mark.asyncio
async def test_actual_child_failure_retains_native_evidence_for_authored_error_projection():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    events = []
    with pytest.raises(ValueError, match='private-provider-marker-14'):
        await run_actual(agent, request(str(uuid4()), str(uuid4()), [{'id': 'failed-human', 'role': 'user', 'content': 'failure'}]), captured=events)
    failures = [event for event in events if event['type'] == 'SUBAGENT_ERROR']
    assert len(failures) == 1
    assert 'private-provider-marker-14' in failures[0]['message']
    assert failures[0]['subagentRunId'].endswith('-booking-sub')
    # The existing bridge propagates this provider exception after child error;
    # no root terminal is invented by the producer or its test fixture.
    assert not any(event['type'] == 'RUN_FINISHED' for event in events)


@pytest.mark.asyncio
async def test_actual_empty_child_answer_keeps_empty_evidence_without_invented_text():
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    events = await run_actual(agent, request(str(uuid4()), str(uuid4()), [{'id': 'empty-human', 'role': 'user', 'content': 'empty'}]))
    results = [message for message in final_messages(events) if message['role'] == 'tool']
    assert len(results) == 3 and all(message['content'] == '' for message in results)
    assert len([event for event in events if event['type'] == 'SUBAGENT_FINISHED']) == 3
    assert not any(event['type'] == 'TEXT_MESSAGE_CONTENT' and event.get('subagentRunId') for event in events)
