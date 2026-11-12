import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver


class ScriptedModel:
    """Returns scripted responses; binding client tools returns the same model."""

    def __init__(self, responses):
        self.responses = list(responses)

    def bind_tools(self, *args, **kwargs):
        return self

    async def ainvoke(self, messages, *args, **kwargs):
        return self.responses.pop(0)


def load_graph_module(model):
    spec = importlib.util.spec_from_file_location(
        'client_tools_plan_test_graph', Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', return_value=model):
        spec.loader.exec_module(module)
    return module


TRIP_CALLS = AIMessage(content='', id='ai-trip', tool_calls=[
    {'id': 'w', 'name': 'get_weather', 'args': {'location': 'Portland'}},
    {'id': 'b', 'name': 'confirm_booking', 'args': {'summary': 'Fictional trip to Portland'}},
])


class PlanTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_trip_declares_a_plan_completes_it_and_a_new_turn_clears_it(self):
        module = load_graph_module(ScriptedModel([
            TRIP_CALLS,
            AIMessage(content='Mild in Portland and booked.', id='ai-summary'),
            AIMessage(content='Hello.', id='ai-hello'),
        ]))
        graph = module.graph.builder.compile(checkpointer=MemorySaver())
        config = {'configurable': {'thread_id': 'trip'}}

        state = await graph.ainvoke({'messages': [HumanMessage(content='Plan a trip to Portland', id='h1')]}, config)
        self.assertEqual(state['todos'], [
            {'content': 'Check the weather for Portland', 'status': 'in_progress'},
            {'content': 'Confirm the booking with you', 'status': 'in_progress'},
            {'content': 'Summarize the results', 'status': 'pending'},
        ])

        state = await graph.ainvoke({'messages': [
            ToolMessage(content='{"temperatureF":61}', tool_call_id='w', id='t1'),
            ToolMessage(content='{"confirmed":true}', tool_call_id='b', id='t2'),
        ]}, config)
        self.assertEqual([todo['status'] for todo in state['todos']], ['completed'] * 3)

        state = await graph.ainvoke({'messages': [HumanMessage(content='Hi', id='h2')]}, config)
        self.assertEqual(state['todos'], [])

    async def test_a_single_tool_writes_no_plan(self):
        module = load_graph_module(ScriptedModel([
            AIMessage(content='', id='ai-weather', tool_calls=[
                {'id': 'w', 'name': 'get_weather', 'args': {'location': 'Oslo'}},
            ]),
        ]))
        graph = module.graph.builder.compile(checkpointer=MemorySaver())
        state = await graph.ainvoke(
            {'messages': [HumanMessage(content='Weather in Oslo?', id='h1')]},
            {'configurable': {'thread_id': 'single'}},
        )
        self.assertNotIn('todos', state)

    def test_step_labels_fall_back_to_the_tool_name(self):
        module = load_graph_module(ScriptedModel([]))
        self.assertEqual(module.step_label({'name': 'weather_card', 'args': {}}), 'Show the weather card')
        self.assertEqual(module.step_label({'name': 'look_up_hotel', 'args': {}}), 'Look up hotel')


if __name__ == '__main__':
    unittest.main()
