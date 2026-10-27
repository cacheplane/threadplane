import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda
from langgraph.checkpoint.memory import MemorySaver

ANSWER = 'The parent answers the fictional request.'
BRIEF = 'CHILD-ONLY: one state snapshot per super-step'
TOPIC = 'Fictional checkpoint topic'


class Router(FakeListChatModel):
    def with_structured_output(self, schema, **kwargs):
        return self | RunnableLambda(
            lambda message: schema.model_validate_json(message.content),
        )


class Researcher(FakeListChatModel):
    captured_inputs: list = []

    async def ainvoke(self, messages, config=None, **kwargs):
        self.captured_inputs.append(messages)
        return await super().ainvoke(messages, config, **kwargs)


def graph_for_test(answer_id=None):
    models = []

    class FixedIdentityAnswer(FakeListChatModel):
        async def ainvoke(self, *args, **kwargs):
            return AIMessage(id=answer_id, content=ANSWER)

    def model(**kwargs):
        index = len(models)
        if index == 0:
            cls = FakeListChatModel if answer_id is None else FixedIdentityAnswer
            responses = [ANSWER]
        elif index == 1:
            cls = Router
            responses = [
                '{"needs_research":true,"topic":"' + TOPIC + '"}',
                '{"needs_research":false,"topic":""}',
                '{"needs_research":true,"topic":"' + TOPIC + '"}',
            ]
        else:
            cls = Researcher
            responses = [BRIEF]
        fake = cls(
            responses=responses,
            tags=kwargs.get('tags'),
            disable_streaming=kwargs.get('streaming') is False,
        )
        models.append(fake)
        return fake

    spec = importlib.util.spec_from_file_location(
        'subgraphs_stream_test_graph',
        Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', side_effect=model):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver()), models[2]


class SubgraphsStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_router_output_stays_internal_and_child_stream_has_a_boundary(self):
        graph, researcher = graph_for_test()
        config = {'configurable': {'thread_id': 'subgraphs-boundary'}}
        question = HumanMessage(id='human-first', content='PRIVATE PARENT: explain checkpoints')
        events = [event async for event in graph.astream(
            {'messages': [question]}, config,
            stream_mode=['messages', 'values'], subgraphs=True,
        )]
        root_chunks = [payload[0].content for namespace, mode, payload in events
                       if not namespace and mode == 'messages']
        self.assertEqual(''.join(root_chunks), ANSWER)
        self.assertGreater(len(root_chunks), 1)
        child_chunks = [payload[0].content for namespace, mode, payload in events
                        if namespace and mode == 'messages']
        self.assertEqual(''.join(child_chunks), BRIEF)
        child_values = [(namespace, payload) for namespace, mode, payload in events
                        if namespace and mode == 'values']
        self.assertTrue(child_values)
        self.assertTrue(all(len(namespace) == 1 and namespace[0].startswith('research:')
                            for namespace, _ in child_values))
        self.assertTrue(all(set(values) == {'research_topic', 'research_brief'}
                            for _, values in child_values))
        self.assertEqual(child_values[-1][1]['research_brief'], BRIEF)
        self.assertEqual([message.type for message in researcher.captured_inputs[0]],
                         ['system', 'human'])
        self.assertEqual(researcher.captured_inputs[0][-1].content, 'Topic: ' + TOPIC)
        final = (await graph.aget_state(config)).values
        self.assertEqual([message.content for message in final['messages']],
                         [question.content, ANSWER])
        self.assertNotIn(BRIEF, ''.join(message.content for message in final['messages']))

    async def test_current_final_pair_changes_only_after_answer_and_direct_resets_child(self):
        graph, _ = graph_for_test()
        config = {'configurable': {'thread_id': 'subgraphs-three-turns'}}
        first = await graph.ainvoke(
            {'messages': [HumanMessage(id='human-first', content='Explain checkpoints')]}, config,
        )
        self.assertEqual(first.get('completed_turn_id'), 'human-first')
        self.assertEqual(first['completed_answer_id'], first['messages'][-1].id)
        events = [event async for event in graph.astream(
            {'messages': [HumanMessage(id='human-second', content='Hi there')]}, config,
            stream_mode='values', subgraphs=True,
        )]
        self.assertTrue(all(not namespace for namespace, _ in events))
        states = [state for _, state in events]
        self.assertEqual(states[0]['research_brief'], BRIEF)
        self.assertTrue(any(state['research_topic'] == '' and state['research_brief'] == ''
                            and state['completed_turn_id'] == 'human-first' for state in states[:-1]))
        final = states[-1]
        self.assertEqual(final['research_topic'], '')
        self.assertEqual(final['research_brief'], '')
        self.assertEqual(final['completed_turn_id'], 'human-second')
        self.assertEqual(final['completed_answer_id'], final['messages'][-1].id)
        self.assertNotEqual(final['completed_answer_id'], first['completed_answer_id'])
        self.assertEqual([message.content for message in final['messages']],
                         ['Explain checkpoints', ANSWER, 'Hi there', ANSWER])
        third = [event async for event in graph.astream(
            {'messages': [HumanMessage(id='human-third', content='Compare checkpoints')]}, config,
            stream_mode='values', subgraphs=True,
        )]
        self.assertTrue(any(namespace for namespace, _ in third))
        third_final = [state for namespace, state in third if not namespace][-1]
        self.assertEqual(third_final['completed_turn_id'], 'human-third')
        self.assertEqual(len(third_final['messages']), 6)
        fresh = await graph.ainvoke(
            {'messages': [HumanMessage(id='human-fresh', content='Separate thread')]},
            {'configurable': {'thread_id': 'subgraphs-fresh'}},
        )
        self.assertEqual(len(fresh['messages']), 2)
        self.assertEqual(fresh['completed_turn_id'], 'human-fresh')

    async def test_missing_or_colliding_final_identity_cannot_publish_a_pair(self):
        for answer_id in ['', 'same-human']:
            with self.subTest(answer_id=answer_id):
                graph, _ = graph_for_test(answer_id)
                state = await graph.ainvoke(
                    {'messages': [HumanMessage(id='same-human', content='Fictional question')]},
                    {'configurable': {'thread_id': 'subgraphs-invalid-answer'}},
                )
                self.assertFalse(state.get('completed_turn_id'))
                self.assertFalse(state.get('completed_answer_id'))

    async def test_no_human_input_cannot_fabricate_current_turn_binding(self):
        graph, _ = graph_for_test()
        state = await graph.ainvoke(
            {'messages': []}, {'configurable': {'thread_id': 'subgraphs-no-human'}},
        )
        self.assertFalse(state.get('completed_turn_id'))
        self.assertFalse(state.get('completed_answer_id'))


if __name__ == '__main__':
    unittest.main()
