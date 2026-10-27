import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langgraph.checkpoint.memory import MemorySaver

VISIBLE = 'I will remember your preference.'


def graph_for_test():
    """Replace only the provider; exercise real graph streaming and checkpoints."""
    models = []

    def model(**kwargs):
        fake = FakeListChatModel(
            responses=[VISIBLE] if not models else [
                '{"user_name":"Demo Avery","favorite_color":"blue"}',
                '{"favorite_color":"green"}',
                '{}',
            ],
            tags=kwargs.get('tags'),
            disable_streaming=kwargs.get('streaming') is False,
        )
        models.append(fake)
        return fake

    spec = importlib.util.spec_from_file_location(
        'memory_stream_test_graph', Path(__file__).resolve().parents[1] / 'src/graph.py',
    )
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', side_effect=model):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver())


class MemoryStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_internal_extraction_is_not_a_conversation_stream(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'memory-stream-test'}}
        events = [
            event async for event in graph.astream(
                {'messages': [{'role': 'user', 'content': 'Demo Avery likes blue'}]},
                config,
                stream_mode=['messages', 'values'],
            )
        ]
        chunks = [payload[0].content for mode, payload in events if mode == 'messages']
        self.assertEqual(''.join(chunks), VISIBLE)
        self.assertGreater(len(chunks), 1, 'Visible response must still stream incrementally')
        state = (await graph.aget_state(config)).values
        self.assertEqual(state['memory'], {'user_name': 'Demo Avery', 'favorite_color': 'blue'})
        self.assertEqual(
            [message.content for message in state['messages']],
            ['Demo Avery likes blue', VISIBLE],
        )

    async def test_same_thread_correction_and_new_thread_isolation(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'memory-correction-test'}}
        await graph.ainvoke(
            {'messages': [{'role': 'user', 'content': 'Demo Avery likes blue'}]}, config,
        )
        state = await graph.ainvoke(
            {'messages': [{'role': 'user', 'content': 'Actually green'}]}, config,
        )
        self.assertEqual(state['memory'], {'user_name': 'Demo Avery', 'favorite_color': 'green'})
        self.assertEqual(len(state['messages']), 4)
        fresh = await graph.ainvoke(
            {'messages': [{'role': 'user', 'content': 'Hello'}]},
            {'configurable': {'thread_id': 'memory-fresh-test'}},
        )
        self.assertEqual(fresh.get('memory', {}), {})
        self.assertEqual([message.content for message in fresh['messages']], ['Hello', VISIBLE])


if __name__ == '__main__':
    unittest.main()
