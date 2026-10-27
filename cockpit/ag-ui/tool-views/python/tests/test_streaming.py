"""Frozen provider responses through the real compiled graph and AG-UI bridge."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from ag_ui.core.types import RunAgentInput
from ag_ui_langgraph import LangGraphAgent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult


class FrozenWeatherModel(BaseChatModel):
    @property
    def _llm_type(self):
        return 'frozen-weather-callback-model'

    def bind_tools(self, tools, **kwargs):
        if [tool.name for tool in tools] != ['weather_card']:
            raise AssertionError('The actual graph must bind its server weather tool')
        if set(tools[0].tool_call_schema.model_json_schema()['properties']) != {'location'}:
            raise AssertionError('Runtime identity injection must not change the model tool catalog')
        return self

    def selection(self, messages):
        human_index = max(i for i, message in enumerate(messages) if isinstance(message, HumanMessage))
        human = messages[human_index]
        current_results = [message for message in messages[human_index + 1:] if isinstance(message, ToolMessage)]
        mode = human.content
        if mode == 'zero' or current_results and (mode != 'rounds' or len(current_results) >= 2):
            return [], 'The frozen weather reply is ready.'
        locations = ['San Francisco', 'Denver'] if mode == 'batch' else ['Denver' if current_results else 'San Francisco']
        return [
            {'id': f'weather-{human.id}-{len(current_results) + index}',
             'name': 'weather_card', 'args': {'location': location}}
            for index, location in enumerate(locations)
        ], ''

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
            for character in text:
                yield ChatGenerationChunk(message=AIMessageChunk(content=character))


def actual_graph():
    path = Path(__file__).resolve().parents[1] / 'src/graph.py'
    spec = importlib.util.spec_from_file_location(f'frozen_weather_{uuid4().hex}', path)
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', return_value=FrozenWeatherModel()) as provider:
        spec.loader.exec_module(module)
    if provider.call_args.kwargs != {'model': 'gpt-5-mini', 'streaming': True}:
        raise AssertionError('Provider replacement must retain the graph configuration')
    return module.graph


def request(thread, run, messages):
    return RunAgentInput.model_validate({
        'threadId': thread, 'runId': run, 'protocolVersion': '1.0',
        'messages': messages, 'state': {}, 'tools': [], 'context': [], 'forwardedProps': {},
    })


async def events(agent, value):
    return [event.model_dump(by_alias=True, exclude_none=True) async for event in agent.clone().run(value)]


def final_messages(wire):
    return next(event['messages'] for event in reversed(wire) if event['type'] == 'MESSAGES_SNAPSHOT')


class WeatherStreamTests(unittest.IsolatedAsyncioTestCase):
    async def assert_turn(self, agent, mode, prefix, turn):
        human = {'id': f'human-{turn}', 'role': 'user', 'content': mode}
        wire = await events(agent, request('weather-thread', f'run-{turn}', prefix + [human]))
        terminal = wire[-1]
        self.assertEqual(terminal['type'], 'RUN_FINISHED')
        self.assertEqual((terminal['threadId'], terminal['runId']), ('weather-thread', f'run-{turn}'))
        self.assertFalse(terminal.get('outcome', {}).get('pendingToolCallIds'))
        self.assertFalse(any(event['type'] == 'RUN_ERROR' for event in wire))
        final = final_messages(wire)
        self.assertEqual(final[:len(prefix)], prefix)
        self.assertEqual(final[len(prefix)], human)
        self.assertEqual(len({message['id'] for message in final}), len(final))
        current = final[len(prefix):]
        self.assertEqual(current[-1]['role'], 'assistant')
        self.assertEqual(current[-1]['content'], 'The frozen weather reply is ready.')
        owners = [message for message in current if message.get('toolCalls')]
        calls = [call for owner in owners for call in owner['toolCalls']]
        results = [message for message in current if message['role'] == 'tool']
        count = {'zero': 0, 'one': 1, 'batch': 2, 'rounds': 2}[mode]
        self.assertEqual(len(calls), count)
        self.assertEqual(len(results), count)
        self.assertEqual(len(owners), 2 if mode == 'rounds' else int(count > 0))
        self.assertEqual(len({call['id'] for call in calls}), count)
        for call in calls:
            self.assertEqual(call['function']['name'], 'weather_card')
            location = json.loads(call['function']['arguments'])['location']
            selected = [message for message in results if message['toolCallId'] == call['id']]
            self.assertEqual(len(selected), 1)
            result = selected[0]
            self.assertEqual(json.loads(result['content']), {
                'location': location, 'temperatureF': 68, 'conditions': 'Sunny', 'humidity': 55, 'windMph': 8,
            })
            incremental = [event for event in wire if event['type'] == 'TOOL_CALL_RESULT' and event['toolCallId'] == call['id']]
            self.assertEqual(len(incremental), 1)
            self.assertEqual(incremental[0]['messageId'], call['id'])
            self.assertEqual(
                result['id'], incremental[0]['messageId'],
                'Stable result IDs preserve causal native request history across the final snapshot',
            )
            self.assertEqual(result['content'], incremental[0]['content'])
        self.assertEqual(len([event for event in wire if event['type'] == 'TOOL_CALL_START']), count)
        self.assertEqual(len([event for event in wire if event['type'] == 'TOOL_CALL_END']), count)
        return final

    async def test_zero_tool_text_reply(self):
        await self.assert_turn(LangGraphAgent(name='tool-views', graph=actual_graph()), 'zero', [], 0)

    async def test_one_server_tool_and_full_followup_history(self):
        agent = LangGraphAgent(name='tool-views', graph=actual_graph())
        first = await self.assert_turn(agent, 'one', [], 0)
        self.assertEqual(len(first), 4)
        second = await self.assert_turn(agent, 'one', first, 1)
        self.assertEqual(len(second), 8)

    async def test_batch_on_one_assistant_message(self):
        final = await self.assert_turn(LangGraphAgent(name='tool-views', graph=actual_graph()), 'batch', [], 0)
        self.assertEqual(len(final), 5)

    async def test_two_server_tool_rounds_in_one_run(self):
        final = await self.assert_turn(LangGraphAgent(name='tool-views', graph=actual_graph()), 'rounds', [], 0)
        self.assertEqual(len(final), 6)


if __name__ == '__main__':
    unittest.main()
