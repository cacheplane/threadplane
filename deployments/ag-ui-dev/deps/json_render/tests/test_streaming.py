"""Frozen providers through the actual dashboard graph and AG-UI bridge."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from uuid import uuid4

from ag_ui.core.types import RunAgentInput
from ag_ui_langgraph import LangGraphAgent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult


def dashboard_spec(structural=False):
    if structural:
        return {"root": "new-card", "elements": {"new-card": {
            "type": "stat_card", "props": {"label": "Updated flights", "value": {"$state": "/flights_today/value"}},
        }}}
    return {"root": "dashboard", "elements": {
        "dashboard": {"type": "dashboard_grid", "children": ["row", "table"]},
        "row": {"type": "container", "props": {"direction": "row"}, "children": ["card", "trend", "airlines"]},
        "card": {"type": "stat_card", "props": {"label": "On time", "value": {"$state": "/on_time/value"}, "delta": {"$state": "/on_time/delta"}}},
        "trend": {"type": "line_chart", "props": {"title": "Trend", "data": {"$state": "/on_time_trend"}, "xKey": "month", "yKey": "on_time_pct"}},
        "airlines": {"type": "bar_chart", "props": {"title": "Airlines", "data": {"$state": "/flights_by_airline"}, "labelKey": "airline", "valueKey": "count"}},
        "table": {"type": "data_grid", "props": {"title": "Disruptions", "rows": {"$state": "/recent_disruptions"}, "columns": ["flight_number", "type", "minutes", "route", "date"]}},
    }}


class FrozenDashboardModel(BaseChatModel):
    kind: str = 'agent'

    @property
    def _llm_type(self):
        return 'frozen-dashboard-callback-model'

    def bind_tools(self, tools, **kwargs):
        expected = {
            'render_spec': {'elements', 'root'}, 'query_airline_kpis': set(),
            'query_on_time_trend': {'months'}, 'query_flights_by_airline': {'airlines'},
            'query_recent_disruptions': {'limit', 'type'},
        }
        if [tool.name for tool in tools] != list(expected):
            raise AssertionError('The actual dashboard must bind all five server tools')
        for tool in tools:
            if set(tool.tool_call_schema.model_json_schema()['properties']) != expected[tool.name]:
                raise AssertionError('Runtime identity injection changed the model tool catalog')
        return self

    def selection(self, messages):
        if self.kind == 'summary':
            return [], 'The fictional dashboard is ready.'
        index = max(i for i, message in enumerate(messages) if isinstance(message, HumanMessage))
        human = messages[index]
        results = [message for message in messages[index + 1:] if isinstance(message, ToolMessage)]
        mode = human.content
        if mode == 'zero' or (results and mode not in ('rounds', 'cap')) or (mode == 'rounds' and len(results) >= 2):
            return [], 'Dashboard prepared.'
        if mode in ('rounds', 'cap'):
            choices = [('query_airline_kpis', {})]
        elif mode == 'filter':
            choices = [('query_recent_disruptions', {'type': 'cancelled', 'limit': 5})]
        elif mode == 'all-airlines':
            choices = [('query_flights_by_airline', {'airlines': []})]
        elif mode == 'structural':
            choices = [('render_spec', dashboard_spec(True))]
        else:
            choices = [
                ('render_spec', dashboard_spec()), ('query_airline_kpis', {}),
                ('query_on_time_trend', {'months': 6}), ('query_flights_by_airline', {'airlines': ['United', 'Delta']}),
                ('query_recent_disruptions', {'limit': 5}),
            ]
        calls = [{'id': f'dashboard-{human.id}-{len(results) + i}', 'name': name, 'args': args}
                 for i, (name, args) in enumerate(choices)]
        return calls, 'Preparing a fictional dashboard.' if mode == 'prose' else ''

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        calls, text = self.selection(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text, tool_calls=calls))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        calls, text = self.selection(messages)
        if calls:
            for index, call in enumerate(calls):
                yield ChatGenerationChunk(message=AIMessageChunk(content=text if index == 0 else '', tool_call_chunks=[{
                    'index': index, 'id': call['id'], 'name': call['name'], 'args': json.dumps(call['args']),
                }]))
        else:
            for character in text:
                yield ChatGenerationChunk(message=AIMessageChunk(content=character))


class FrozenThreads:
    async def get(self, *args, **kwargs):
        return {'metadata': {'title': 'Already titled'}}


def actual_graph():
    source = Path(__file__).resolve().parents[1] / 'src'
    name = f'frozen_dashboard_{uuid4().hex}'
    package = types.ModuleType(name)
    package.__path__ = [str(source)]
    sys.modules[name] = package
    spec = importlib.util.spec_from_file_location(name + '.graph', source / 'graph.py')
    module = importlib.util.module_from_spec(spec)
    client = types.SimpleNamespace(threads=FrozenThreads())
    with patch('langchain_openai.ChatOpenAI', side_effect=lambda **kw: FrozenDashboardModel(
        kind='agent' if kw['model'] == 'gpt-5' else 'summary',
    )) as provider, patch('langgraph_sdk.get_client', return_value=client):
        spec.loader.exec_module(module)
    if [call.kwargs for call in provider.call_args_list] != [
        {'model': 'gpt-5', 'temperature': 0, 'streaming': True, 'reasoning_effort': 'minimal'},
        {'model': 'gpt-5-mini', 'temperature': 0, 'streaming': True},
    ]:
        raise AssertionError('Provider replacement must retain the actual graph configuration')
    return module.graph


def request(thread, run, messages):
    return RunAgentInput.model_validate({
        'threadId': thread, 'runId': run, 'protocolVersion': '1.0',
        'messages': messages, 'state': {}, 'tools': [], 'context': [], 'forwardedProps': {},
    })


class DashboardStreamTests(unittest.IsolatedAsyncioTestCase):
    async def turn(self, agent, mode, prefix=(), number=0, thread='dashboard-thread'):
        human = {'id': f'human-{thread}-{number}', 'role': 'user', 'content': mode}
        wire = [event.model_dump(mode='json', by_alias=True, exclude_none=True)
                async for event in agent.clone().run(request(thread, f'run-{number}', [*prefix, human]))]
        self.assertEqual(wire[-1]['type'], 'RUN_FINISHED')
        self.assertEqual((wire[-1]['threadId'], wire[-1]['runId']), (thread, f'run-{number}'))
        self.assertFalse(any(event['type'] == 'RUN_ERROR' for event in wire))
        final = next(event['messages'] for event in reversed(wire) if event['type'] == 'MESSAGES_SNAPSHOT')
        self.assertEqual(final[:len(prefix)], list(prefix))
        self.assertEqual(final[len(prefix)], human)
        self.assertEqual(len({message['id'] for message in final}), len(final))
        self.assertEqual(final[-1]['content'], 'The fictional dashboard is ready.')
        current = final[len(prefix):]
        calls = [call for message in current if message['role'] == 'assistant' for call in message.get('toolCalls', [])]
        results = [message for message in current if message['role'] == 'tool']
        self.assertEqual(len(calls), len(results))
        for call in calls:
            result = next(message for message in results if message['toolCallId'] == call['id'])
            incremental = next(event for event in wire if event['type'] == 'TOOL_CALL_RESULT' and event['toolCallId'] == call['id'])
            self.assertEqual(result['id'], incremental['messageId'], 'Stable result IDs retain causal native history')
            self.assertEqual(result['id'], call['id'])
            if call['function']['name'] == 'render_spec':
                decoded = json.loads(incremental['content'])
                self.assertIsInstance(decoded, dict, 'Render JSON must be serialized exactly once')
                self.assertEqual(decoded, json.loads(call['function']['arguments']))
                self.assertEqual(result['content'], incremental['content'] if mode == 'prose' else 'rendered')
            else:
                self.assertEqual(result['content'], incremental['content'])
                self.assertIsInstance(json.loads(result['content']), (dict, list))
        return final, wire

    async def test_full_catalog_and_all_five_server_tools(self):
        final, wire = await self.turn(LangGraphAgent(name='json-render', graph=actual_graph()), 'full')
        self.assertEqual(len(final), 9)
        owner = final[1]
        self.assertEqual(json.loads(owner['content']), dashboard_spec())
        state = next(event['snapshot'] for event in reversed(wire) if event['type'] == 'STATE_SNAPSHOT')
        self.assertEqual(state['on_time'], {'value': '84.2%', 'delta': '+1.4%'})
        self.assertEqual(state['flights_today']['value'], 312)
        self.assertEqual(len(state['on_time_trend']), 6)
        self.assertEqual([row['airline'] for row in state['flights_by_airline']], ['United', 'Delta'])
        self.assertEqual(len(state['recent_disruptions']), 5)

    async def test_nonempty_assistant_prose_retains_original_render_result(self):
        final, _ = await self.turn(LangGraphAgent(name='json-render', graph=actual_graph()), 'prose')
        self.assertEqual(final[1]['content'], 'Preparing a fictional dashboard.')

    async def test_data_only_followup_preserves_layout_and_exact_history(self):
        agent = LangGraphAgent(name='json-render', graph=actual_graph())
        first, _ = await self.turn(agent, 'full')
        final, wire = await self.turn(agent, 'filter', first, 1)
        self.assertEqual(len(final), len(first) + 5)
        self.assertEqual([event['toolCallName'] for event in wire if event['type'] == 'TOOL_CALL_START'], ['query_recent_disruptions'])
        state = next(event['snapshot'] for event in reversed(wire) if event['type'] == 'STATE_SNAPSHOT')
        self.assertEqual([row['type'] for row in state['recent_disruptions']], ['cancelled'] * 3)
        self.assertEqual([row['flight_number'] for row in state['recent_disruptions']], ['AA456', 'UA204', 'UA640'])
        self.assertEqual(state['on_time']['value'], '84.2%')

    async def test_structural_followup_replaces_only_current_layout(self):
        agent = LangGraphAgent(name='json-render', graph=actual_graph())
        first, _ = await self.turn(agent, 'full')
        final, _ = await self.turn(agent, 'structural', first, 1)
        self.assertEqual(json.loads(final[len(first) + 1]['content']), dashboard_spec(True))

    async def test_plain_reply_without_tools(self):
        final, _ = await self.turn(LangGraphAgent(name='json-render', graph=actual_graph()), 'zero')
        self.assertEqual([message['role'] for message in final], ['user', 'assistant', 'assistant'])

    async def test_empty_airline_filter_returns_all_existing_demo_airlines(self):
        _, wire = await self.turn(LangGraphAgent(name='json-render', graph=actual_graph()), 'all-airlines')
        state = next(event['snapshot'] for event in reversed(wire) if event['type'] == 'STATE_SNAPSHOT')
        self.assertEqual([row['airline'] for row in state['flights_by_airline']], ['American','United','Delta','JetBlue'])

    async def test_multiple_rounds_and_iteration_cap(self):
        agent = LangGraphAgent(name='json-render', graph=actual_graph())
        rounds, _ = await self.turn(agent, 'rounds')
        self.assertEqual(len([message for message in rounds if message['role'] == 'tool']), 2)
        capped, _ = await self.turn(agent, 'cap', thread='capped-thread')
        self.assertEqual(len([message for message in capped if message['role'] == 'tool']), 5)
        self.assertFalse(capped[-2].get('toolCalls'))


if __name__ == '__main__':
    unittest.main()
