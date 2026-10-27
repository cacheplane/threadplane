import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

ANSWER = 'Fictional deployment answer'


def graph_for_test(answer_id=None):
    class FixedIdentityAnswer(FakeListChatModel):
        async def ainvoke(self, *args, **kwargs):
            return AIMessage(id=answer_id, content=ANSWER)

    model = (FakeListChatModel if answer_id is None else FixedIdentityAnswer)(
        responses=[ANSWER],
    )
    spec = importlib.util.spec_from_file_location(
        'deployment_runtime_completion_test_graph',
        Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', return_value=model):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver())


class DeploymentCompletionTests(unittest.IsolatedAsyncioTestCase):
    def assert_identity(self, values, human_id):
        ids = [message.id for message in values['messages']]
        self.assertEqual(values.get('completed_message_ids'), ids)
        self.assertEqual(values.get('completed_turn_id'), human_id)
        self.assertEqual(values.get('completed_answer_id'), ids[-1])
        self.assertEqual(ids[-2], human_id)
        self.assertEqual(len(ids), len(set(ids)))

    async def test_final_identity_preserves_canonical_history_and_incremental_stream(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'deployment-runtime-stream'}}
        events = [event async for event in graph.astream(
            {'messages': [HumanMessage(id='human-A', content='Fictional A')]},
            config, stream_mode=['messages', 'values'],
        )]
        chunks = [payload[0].content for mode, payload in events if mode == 'messages']
        self.assertEqual(''.join(chunks), ANSWER)
        self.assertGreater(len(chunks), 1)
        initial = [values for mode, values in events if mode == 'values'][0]
        self.assertNotIn('completed_turn_id', initial)
        self.assertNotIn('completed_answer_id', initial)
        self.assertNotIn('completed_message_ids', initial)
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

    async def test_separate_confirmed_threads_do_not_share_canonical_history(self):
        graph = graph_for_test()
        first = await graph.ainvoke(
            {'messages': [HumanMessage(id='first-human', content='Fictional first')]},
            {'configurable': {'thread_id': 'deployment-first'}},
        )
        second = await graph.ainvoke(
            {'messages': [HumanMessage(id='second-human', content='Fictional second')]},
            {'configurable': {'thread_id': 'deployment-second'}},
        )
        self.assert_identity(first, 'first-human')
        self.assert_identity(second, 'second-human')
        self.assertEqual(len(first['messages']), 2)
        self.assertEqual(len(second['messages']), 2)
        self.assertNotIn('first-human', second['completed_message_ids'])

    async def test_actual_sdk_json_messages_are_normalized_before_canonical_confirmation(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'deployment-runtime-wire'}}
        first = await graph.ainvoke(
            {'messages': [{'type': 'human', 'id': 'wire-human-A', 'content': 'Fictional wire A'}]}, config,
        )
        second = await graph.ainvoke(
            {'messages': [{'type': 'human', 'id': 'wire-human-B', 'content': 'Fictional wire B'}]}, config,
        )
        self.assert_identity(first, 'wire-human-A')
        self.assert_identity(second, 'wire-human-B')
        self.assertEqual(second['completed_message_ids'][:2], first['completed_message_ids'])
        self.assertEqual(len(second['messages']), 4)

    async def test_missing_or_colliding_final_identity_cannot_publish_metadata(self):
        for answer_id in ['', 'human-A']:
            with self.subTest(answer_id=answer_id):
                graph = graph_for_test(answer_id)
                values = await graph.ainvoke(
                    {'messages': [HumanMessage(id='human-A', content='Fictional A')]},
                    {'configurable': {'thread_id': 'deployment-runtime-invalid'}},
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
                    {'configurable': {'thread_id': 'deployment-runtime-no-current-human'}},
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
            {'configurable': {'thread_id': 'deployment-runtime-historical-collision'}},
        )
        self.assertFalse(values.get('completed_turn_id'))
        self.assertFalse(values.get('completed_answer_id'))
        self.assertFalse(values.get('completed_message_ids'))


if __name__ == '__main__':
    unittest.main()
