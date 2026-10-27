import importlib
import importlib.util
import unittest

from test_streaming import actual_graph, events, final_messages, request


class NativeRefundAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_counterpart_retains_flags_when_endpoint_clones_it(self):
        self.assertIsNotNone(
            importlib.util.find_spec('src.native_agent'),
            'A separate native counterpart must preserve the existing legacy agent',
        )
        agent_type = importlib.import_module('src.native_agent').NativeRefundAgent
        graph, _ = actual_graph('tool')
        agent = agent_type(name='interrupts', graph=graph)
        cloned = agent.clone()
        self.assertIsInstance(cloned, agent_type)
        self.assertFalse(cloned.enable_legacy_on_interrupt_event)
        self.assertTrue(cloned.emit_interrupt_outcome)
        self.assertIs(cloned.graph, graph)
        human = {'id': 'counterpart-human', 'role': 'user', 'content': 'Draft a fictional refund.'}
        paused = await events(agent, request('counterpart-thread', 'counterpart-run', [human]))
        self.assertFalse(any(event.get('name') == 'on_interrupt' for event in paused))
        terminal = next(event for event in reversed(paused) if event['type'] == 'RUN_FINISHED')
        self.assertEqual(terminal['runId'], 'counterpart-run')
        self.assertEqual(terminal['outcome']['type'], 'interrupt')
        selected = terminal['outcome']['interrupts'][0]
        resumed = await events(agent, request(
            'counterpart-thread', 'counterpart-resume', final_messages(paused),
            resume=[{'interruptId': selected['id'], 'status': 'resolved', 'payload': {'approved': False}}],
        ))
        self.assertIn('Refund cancelled', final_messages(resumed)[-1]['content'])


if __name__ == '__main__':
    unittest.main()
