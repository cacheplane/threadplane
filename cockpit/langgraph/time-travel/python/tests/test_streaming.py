import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

ANSWER = 'Fictional checkpoint answer'


def graph_for_test(answer_id=None):
    class FixedIdentityAnswer(FakeListChatModel):
        async def ainvoke(self, *args, **kwargs):
            return AIMessage(id=answer_id, content=ANSWER)

    model = (FakeListChatModel if answer_id is None else FixedIdentityAnswer)(
        responses=[ANSWER],
    )
    spec = importlib.util.spec_from_file_location(
        'time_travel_stream_test_graph',
        Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', return_value=model):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver())


class TimeTravelStreamTests(unittest.IsolatedAsyncioTestCase):
    def assert_identity(self, values, human_id):
        ids = [message.id for message in values['messages']]
        self.assertEqual(values.get('completed_message_ids'), ids)
        self.assertEqual(values.get('completed_turn_id'), human_id)
        self.assertEqual(values.get('completed_answer_id'), ids[-1])
        self.assertEqual(ids[-2], human_id)
        self.assertEqual(len(ids), len(set(ids)))

    async def test_final_identity_preserves_canonical_history_and_incremental_stream(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'time-travel-stream'}}
        events = [event async for event in graph.astream(
            {'messages': [HumanMessage(id='human-A', content='Fictional A')]},
            config, stream_mode=['messages', 'values'],
        )]
        chunks = [payload[0].content for mode, payload in events if mode == 'messages']
        self.assertEqual(''.join(chunks), ANSWER)
        self.assertGreater(len(chunks), 1)
        first = (await graph.aget_state(config)).values
        self.assert_identity(first, 'human-A')
        second = [values async for values in graph.astream(
            {'messages': [HumanMessage(id='human-B', content='Fictional B')]},
            config, stream_mode='values',
        )]
        self.assertEqual(second[0]['completed_message_ids'], first['completed_message_ids'])
        self.assertEqual(second[0]['completed_turn_id'], 'human-A')
        self.assert_identity(second[-1], 'human-B')
        self.assertEqual(len(second[-1]['messages']), 4)

    async def test_fork_and_continuation_preserve_source_despite_competing_tip(self):
        graph = graph_for_test()
        tip = {'configurable': {'thread_id': 'time-travel-branches'}}
        async def send(human_id, config):
            await graph.ainvoke(
                {'messages': [HumanMessage(id=human_id, content=human_id)]}, config,
            )
            state = await graph.aget_state(tip)
            self.assert_identity(state.values, human_id)
            return state
        a = await send('human-A', tip)
        b = await send('human-B', tip)
        c = await send('human-C', a.config)
        await send('human-other', b.config)
        d = await send('human-D', c.config)
        self.assertEqual([message.id for message in d.values['messages']
                          if message.type == 'human'], ['human-A', 'human-C', 'human-D'])
        original = await graph.aget_state(b.config)
        self.assertEqual([message.id for message in original.values['messages']
                          if message.type == 'human'], ['human-A', 'human-B'])
        self.assertEqual(original.values['completed_message_ids'], b.values['completed_message_ids'])
        ancestor = c
        ancestors = []
        while ancestor.parent_config:
            ancestors.append(ancestor.parent_config)
            ancestor = await graph.aget_state(ancestor.parent_config)
        self.assertIn(a.config, ancestors)
        self.assertNotIn(b.config, ancestors)
        fresh = await graph.ainvoke(
            {'messages': [HumanMessage(id='human-new', content='Separate thread')]},
            {'configurable': {'thread_id': 'time-travel-new'}},
        )
        self.assert_identity(fresh, 'human-new')
        self.assertEqual(len(fresh['messages']), 2)

    async def test_missing_or_colliding_final_identity_cannot_publish_metadata(self):
        for answer_id in ['', 'human-A']:
            with self.subTest(answer_id=answer_id):
                graph = graph_for_test(answer_id)
                values = await graph.ainvoke(
                    {'messages': [HumanMessage(id='human-A', content='Fictional A')]},
                    {'configurable': {'thread_id': 'time-travel-invalid'}},
                )
                self.assertFalse(values.get('completed_turn_id'))
                self.assertFalse(values.get('completed_answer_id'))
                self.assertFalse(values.get('completed_message_ids'))

    async def test_no_human_or_trailing_assistant_cannot_fabricate_a_current_pair(self):
        for messages in [[], [HumanMessage(id='old-human', content='Old'),
                              AIMessage(id='old-answer', content='Already answered')]]:
            with self.subTest(messages=messages):
                graph = graph_for_test()
                values = await graph.ainvoke(
                    {'messages': messages},
                    {'configurable': {'thread_id': 'time-travel-no-current-human'}},
                )
                self.assertFalse(values.get('completed_turn_id'))
                self.assertFalse(values.get('completed_answer_id'))
                self.assertFalse(values.get('completed_message_ids'))

    async def test_collision_with_historical_answer_cannot_publish_a_truncated_history(self):
        graph = graph_for_test('old-answer')
        values = await graph.ainvoke(
            {'messages': [HumanMessage(id='old-human', content='Old question'),
                          AIMessage(id='old-answer', content='Old answer'),
                          HumanMessage(id='new-human', content='New question')]},
            {'configurable': {'thread_id': 'time-travel-historical-collision'}},
        )
        self.assertFalse(values.get('completed_turn_id'))
        self.assertFalse(values.get('completed_answer_id'))
        self.assertFalse(values.get('completed_message_ids'))


if __name__ == '__main__':
    unittest.main()
