import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from ag_ui.core.types import RunAgentInput
from ag_ui_langgraph import LangGraphAgent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableLambda

FIELDS = {
    'customer_id': 'cus_fictional',
    'amount': 47.5,
    'reason': 'Frozen duplicate-charge scenario',
}
VISIBLE = 'Your fictional refund is ready for review.'


class StructuredCallbackModel(BaseChatModel):
    extraction: bool = False
    extraction_mode: str = 'tool'

    @property
    def _llm_type(self):
        return 'frozen-refund-callback-model'

    def with_structured_output(self, schema, **kwargs):
        def parse(message):
            if self.extraction_mode == 'text':
                return schema.model_validate_json(message.content)
            return schema.model_validate(message.tool_calls[0]['args'])
        return self | RunnableLambda(parse)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if not self.extraction:
            message = AIMessage(content=VISIBLE)
        elif self.extraction_mode == 'text':
            message = AIMessage(content=json.dumps(FIELDS))
        else:
            message = AIMessage(content='', tool_calls=[{
                'id': 'internal-extraction', 'name': 'RefundDraft', 'args': FIELDS,
            }])
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        if self.extraction and self.extraction_mode == 'tool':
            yield ChatGenerationChunk(message=AIMessageChunk(content='', tool_call_chunks=[{
                'index': 0, 'id': 'internal-extraction', 'name': 'RefundDraft',
                'args': json.dumps(FIELDS),
            }]))
            return
        text = json.dumps(FIELDS) if self.extraction else VISIBLE
        for character in text:
            yield ChatGenerationChunk(message=AIMessageChunk(content=character))


def actual_graph(mode):
    """Replace only the provider; retain the real graph, callbacks and checkpoints."""
    calls = []

    def model(**kwargs):
        calls.append(kwargs)
        return StructuredCallbackModel(
            extraction=len(calls) == 2,
            extraction_mode=mode,
            tags=kwargs.get('tags'),
        )

    path = Path(__file__).resolve().parents[1] / 'src/graph.py'
    spec = importlib.util.spec_from_file_location(f'refund_callback_{uuid4().hex}', path)
    module = importlib.util.module_from_spec(spec)
    with patch('langchain_openai.ChatOpenAI', side_effect=model):
        spec.loader.exec_module(module)
    return module.graph, calls


def request(thread, run, messages, *, resume=None, legacy=None):
    body = {
        'threadId': thread, 'runId': run, 'protocolVersion': '1.0',
        'messages': messages, 'state': {}, 'tools': [], 'context': [],
        'forwardedProps': {'command': {'resume': legacy}} if legacy is not None else {},
    }
    if resume is not None:
        body['resume'] = resume
    return RunAgentInput.model_validate(body)


async def events(agent, value):
    return [
        event.model_dump(by_alias=True, exclude_none=True)
        async for event in agent.clone().run(value)
    ]


def final_messages(wire):
    return next(event['messages'] for event in reversed(wire) if event['type'] == 'MESSAGES_SNAPSHOT')


class RefundStreamTests(unittest.IsolatedAsyncioTestCase):
    async def assert_native_extraction_hidden(self, mode):
        graph, calls = actual_graph(mode)
        self.assertEqual(calls, [
            {'model': 'gpt-5-mini', 'streaming': True},
            {'model': 'gpt-5-mini'},
        ])
        agent = LangGraphAgent(
            name='interrupts', graph=graph,
            enable_legacy_on_interrupt_event=False, emit_interrupt_outcome=True,
        )
        human = {'id': 'current-human', 'role': 'user', 'content': 'Draft a fictional refund.'}
        paused = await events(agent, request('native-thread', 'native-run', [human]))
        self.assertFalse(
            any(event['type'].startswith('TOOL_CALL') for event in paused),
            'Internal structured extraction must not become native tool work',
        )
        chunks = [event['delta'] for event in paused if event['type'] == 'TEXT_MESSAGE_CONTENT']
        self.assertEqual(''.join(chunks), VISIBLE)
        self.assertGreater(len(chunks), 1, 'The visible acknowledgement must still stream')
        self.assertFalse(any(event.get('name') == 'on_interrupt' for event in paused))
        terminal = next(event for event in reversed(paused) if event['type'] == 'RUN_FINISHED')
        self.assertEqual(terminal['runId'], 'native-run')
        self.assertEqual(terminal['outcome']['type'], 'interrupt')
        interrupts = terminal['outcome']['interrupts']
        self.assertEqual(len(interrupts), 1)
        self.assertEqual(interrupts[0]['metadata']['langgraph']['raw'], {
            'kind': 'refund_approval', **FIELDS,
        })
        messages = final_messages(paused)
        self.assertEqual([message['content'] for message in messages], [human['content'], VISIBLE])
        self.assertEqual(messages[0]['id'], human['id'])
        self.assertEqual(len({message['id'] for message in messages}), 2)
        self.assertFalse(any(message.get('toolCalls') for message in messages))
        resumed = await events(agent, request('native-thread', 'resume-run', messages, resume=[{
            'interruptId': interrupts[0]['id'], 'status': 'resolved',
            'payload': {'approved': True, 'amount': 20},
        }]))
        completed = final_messages(resumed)
        self.assertEqual(completed[:2], messages)
        self.assertEqual(len({message['id'] for message in completed}), 3)
        self.assertIn('$20.00', completed[-1]['content'])
        finished = next(event for event in reversed(resumed) if event['type'] == 'RUN_FINISHED')
        self.assertEqual(finished['runId'], 'resume-run')
        self.assertNotIn('outcome', finished)

    async def test_native_tool_extraction_is_not_conversation_work(self):
        await self.assert_native_extraction_hidden('tool')

    async def test_native_text_extraction_is_not_conversation_text(self):
        await self.assert_native_extraction_hidden('text')

    async def assert_legacy_decision(self, approved):
        graph, _ = actual_graph('tool')
        agent = LangGraphAgent(name='interrupts', graph=graph)
        human = {'id': 'legacy-human', 'role': 'user', 'content': 'Draft a fictional refund.'}
        paused = await events(agent, request('legacy-thread', 'legacy-run', [human]))
        notice = next(event for event in paused if event.get('name') == 'on_interrupt')
        self.assertIsInstance(notice['value'], str)
        self.assertEqual(json.loads(notice['value']), {'kind': 'refund_approval', **FIELDS})
        terminal = next(event for event in reversed(paused) if event['type'] == 'RUN_FINISHED')
        self.assertEqual(terminal['runId'], 'legacy-run')
        self.assertNotIn('outcome', terminal)
        messages = final_messages(paused)
        resumed = await events(agent, request(
            'legacy-thread', 'legacy-resume', messages, legacy={'approved': approved},
        ))
        final = final_messages(resumed)
        self.assertEqual(final[:2], messages)
        self.assertEqual(len({message['id'] for message in final}), 3)
        self.assertIn('$47.50' if approved else 'Refund cancelled', final[-1]['content'])
        finish = next(event for event in reversed(resumed) if event['type'] == 'RUN_FINISHED')
        self.assertNotIn('outcome', finish)

    async def test_legacy_approve_retains_its_wire_contract(self):
        await self.assert_legacy_decision(True)

    async def test_legacy_cancel_retains_its_wire_contract(self):
        await self.assert_legacy_decision(False)


if __name__ == '__main__':
    unittest.main()
