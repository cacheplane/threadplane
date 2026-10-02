import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver


def graph_for_test(model=None):
    spec = importlib.util.spec_from_file_location(
        'durable_completion_test_graph', Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', return_value=model or FakeListChatModel(
        responses=['Analysis draft', 'Plan draft', 'Final answer'],
    )):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver())


class DurableCompletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_json_wire_input_keeps_current_human_and_final_identity_across_two_runs(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'durable-wire-two-turns'}}
        for turn in ['first', 'second']:
            events = [state async for state in graph.astream(
                {'messages': [{'type': 'human', 'id': 'wire-human-' + turn, 'content': 'Fictional ' + turn}]},
                config, stream_mode='values',
            )]
            self.assertEqual(events[0]['messages'][0]['id'], 'wire-human-' + turn)
            self.assertEqual([state['step'] for state in events if state.get('step') in ['analyze', 'plan']][-2:], ['analyze', 'plan'])
            final = events[-1]
            self.assertEqual(final['step'], 'generate')
            self.assertEqual(final['completed_turn_id'], 'wire-human-' + turn)
            self.assertEqual(final['completed_answer_id'], final['messages'][-1].id)
            self.assertEqual([message.content for message in final['messages']], ['Fictional ' + turn, 'Final answer'])
            self.assertEqual(final['messages'][0].id, 'wire-human-' + turn)

    async def test_json_wire_input_without_identity_cannot_fabricate_authority(self):
        for identity in [None, '']:
            question = {'type': 'human', 'content': 'Fictional request without identity'}
            if identity is not None:
                question['id'] = identity
            graph = graph_for_test()
            final = await graph.ainvoke({'messages': [question]}, {'configurable': {'thread_id': 'durable-wire-missing-' + str(identity)}})
            self.assertFalse(final.get('completed_turn_id'))
            self.assertFalse(final.get('completed_answer_id'))

    async def test_completion_marker_identifies_only_the_current_final_checkpoint(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'durable-two-turns'}}
        first = await graph.ainvoke(
            {'messages': [HumanMessage(id='human-first', content='First fictional request')]}, config,
        )
        self.assertEqual(first['completed_turn_id'], 'human-first')
        self.assertEqual(first['completed_answer_id'], first['messages'][-1].id)
        self.assertTrue(first['completed_answer_id'])
        self.assertEqual(first['step'], 'generate')
        self.assertEqual([message.content for message in first['messages']], ['First fictional request', 'Final answer'])
        events = [state async for state in graph.astream(
            {'messages': [HumanMessage(id='human-second', content='Second fictional request')]},
            config, stream_mode='values',
        )]
        for step in ['analyze', 'plan']:
            intermediate = next(state for state in events if state['step'] == step)
            self.assertEqual(intermediate['completed_turn_id'], 'human-first')
            self.assertEqual(intermediate['completed_answer_id'], first['completed_answer_id'])
        final = events[-1]
        self.assertEqual(final['step'], 'generate')
        self.assertEqual(final['completed_turn_id'], 'human-second')
        self.assertEqual(final['completed_answer_id'], final['messages'][-1].id)
        self.assertNotEqual(final['completed_answer_id'], first['completed_answer_id'])
        self.assertEqual([message.id for message in final['messages'][:1]], ['human-second'])
        self.assertEqual([message.content for message in final['messages']], ['Second fictional request', 'Final answer'])

    async def test_missing_question_identity_cannot_fabricate_completion_authority(self):
        for question in [HumanMessage(content='No ID'), HumanMessage(id='', content='Empty ID')]:
            with self.subTest(id=question.id):
                graph = graph_for_test()
                state = await graph.ainvoke(
                    {'messages': [question]}, {'configurable': {'thread_id': 'durable-no-identity'}},
                )
                self.assertEqual(state['step'], 'generate')
                self.assertFalse(state.get('completed_turn_id'))
                self.assertFalse(state.get('completed_answer_id'))

    async def test_missing_answer_identity_cannot_publish_a_completion_pair(self):
        class MissingIdentityModel(FakeListChatModel):
            async def ainvoke(self, *args, **kwargs):
                return AIMessage(id='', content='Unidentified answer')
        graph = graph_for_test(MissingIdentityModel(responses=['unused']))
        state = await graph.ainvoke(
            {'messages': [HumanMessage(id='known-human', content='Fictional request')]},
            {'configurable': {'thread_id': 'durable-no-answer-identity'}},
        )
        self.assertEqual(state['step'], 'generate')
        self.assertFalse(state.get('completed_turn_id'))
        self.assertFalse(state.get('completed_answer_id'))


if __name__ == '__main__':
    unittest.main()
