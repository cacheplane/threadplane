import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables import RunnableLambda
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

EXTRACTED = '{"customer_id":"cus_demo","amount":47.5,"reason":"Duplicate charge"}'
VISIBLE = 'Your refund is ready for review.'


class StructuredFake(FakeListChatModel):
    def with_structured_output(self, schema, **kwargs):
        return self | RunnableLambda(lambda message: schema.model_validate_json(message.content))


def graph_for_test():
    """Replace only the provider; exercise real graph streaming and checkpoints."""
    calls = []

    def model(**kwargs):
        calls.append(kwargs)
        return StructuredFake(
            responses=[VISIBLE if len(calls) == 1 else EXTRACTED],
            tags=kwargs.get('tags'),
        )

    path = Path(__file__).resolve().parents[1] / 'src/graph.py'
    spec = importlib.util.spec_from_file_location('refund_stream_test_graph', path)
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', side_effect=model):
        spec.loader.exec_module(module)
    return module.graph.builder.compile(checkpointer=MemorySaver())


class RefundStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_internal_extraction_is_not_a_conversation_stream(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'refund-stream-test'}}
        events = [
            event async for event in graph.astream(
                {'messages': [{'role': 'user', 'content': 'Refund duplicate charge'}]},
                config,
                stream_mode=['messages', 'values'],
            )
        ]
        chunks = [payload[0].content for mode, payload in events if mode == 'messages']
        self.assertEqual(''.join(chunks), VISIBLE)
        self.assertGreater(len(chunks), 1, 'Visible response must still stream incrementally')
        state = (await graph.aget_state(config)).values
        self.assertEqual(
            [message.content for message in state['messages']],
            ['Refund duplicate charge', VISIBLE],
        )
        interrupt = (await graph.aget_state(config)).tasks[0].interrupts[0].value
        self.assertEqual(interrupt, {
            'kind': 'refund_approval', 'customer_id': 'cus_demo',
            'amount': 47.5, 'reason': 'Duplicate charge',
        })
        await graph.ainvoke(Command(resume={'approved': True, 'amount': 20}), config)
        final = (await graph.aget_state(config)).values
        self.assertEqual(final['amount'], 20)
        self.assertEqual(final['refund_id'], 're_demo_s_demo')
        self.assertIn('$20.00', final['messages'][-1].content)

    async def test_decline_keeps_refund_unissued(self):
        graph = graph_for_test()
        config = {'configurable': {'thread_id': 'decline-stream-test'}}
        await graph.ainvoke(
            {'messages': [{'role': 'user', 'content': 'Refund duplicate charge'}]}, config,
        )
        final = await graph.ainvoke(Command(resume={'approved': False}), config)
        self.assertFalse(final['decision_approved'])
        self.assertNotIn('refund_id', final)
        self.assertIn('Refund cancelled', final['messages'][-1].content)


if __name__ == '__main__':
    unittest.main()
