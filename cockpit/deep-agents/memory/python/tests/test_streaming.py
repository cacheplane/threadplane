"""Offline real compiled Memory stream, using the API's public output filter."""
import os
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'
import socket
import unittest
from unittest.mock import patch
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from deepagents.backends import StoreBackend
from model_support import LocalModel, CountingStore, load, FILE, SCOPE, OTHER

LITERAL = 'Fleet note\n\n  Ω literal whitespace  \n'
UPDATED = 'Updated fleet note\n\n  Ω literal whitespace  \n'
SCENARIOS = {
    'teach': [('write_file', {'file_path': FILE, 'content': LITERAL})],
    'edit': [('edit_file', {'file_path': FILE, 'old_string': 'Fleet note', 'new_string': 'Updated fleet note'})],
    'recall': [],
    'read': [('read_file', {'file_path': FILE})],
    'empty': [('write_file', {'file_path': FILE, 'content': ''})],
    'boundary': [('write_file', {'file_path': FILE, 'content': 'Ω' * 32768})],
    'oversize': [('write_file', {'file_path': FILE, 'content': 'Ω' * 32769})],
}

class MemoryModel(LocalModel):
    """The final response reflects the actual prompt, never a persistence oracle."""
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        result = super()._generate(messages, stop, run_manager, **kwargs)
        if not result.generations[0].message.tool_calls:
            prompt = messages[0].text
            start = prompt.find('<agent_memory>')
            end = prompt.find('</agent_memory>', start)
            # Capturing all prompts also proves the pinned middleware read.
            result = ChatResult(generations=[ChatGeneration(message=AIMessage(
                content='Offline prompt observation: ' + (prompt[start + len('<agent_memory>'):end] if start >= 0 and end >= 0 else '')
            ))])
        return result

class MemoryStreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, 'connect', side_effect=AssertionError('Remote socket forbidden')))
        self.addCleanup(network.assert_not_called)
        self.model = MemoryModel()
        self.store = CountingStore()
        _, self.graph = load(self.model, store=self.store)

    async def stream(self, thread, scope=SCOPE, scenario='recall'):
        self.model.calls = SCENARIOS[scenario]
        config = {'configurable': {'thread_id': thread}}
        events = [e async for e in self.graph.astream(
            {'messages': [{'type': 'human', 'id': str(len(self.model.prompts)), 'content': scenario}]},
            config, context={'memory_scope': scope}, output_keys=self.graph.output_channels,
            subgraphs=True, stream_mode=['messages', 'values', 'updates', 'checkpoints', 'custom'])]
        return events, await self.graph.aget_state(config)

    async def test_filtered_live_values_custom_and_raw_root_checkpoint_after_genuine_writes(self):
        events, state = await self.stream('a', scenario='teach')
        expected = {FILE: LITERAL}
        self.assertEqual(state.values['memory_contents'], expected)
        custom = [data['data'] for ns, kind, data in events if kind == 'custom']
        self.assertEqual([e['phase'] for e in custom], ['initial', 'model', 'model', 'terminal'])
        self.assertEqual(custom[0]['memory_contents'], {})
        self.assertEqual(custom[-1]['memory_contents'], expected)
        self.assertTrue(all(e['memory_scope_owner'] == SCOPE for e in custom))
        values = [data for ns, kind, data in events if kind == 'values']
        self.assertTrue(values)
        self.assertTrue(all('memory_contents' not in e and 'memory_scope_owner' not in e for e in values))
        checkpoints = [data for ns, kind, data in events if kind == 'checkpoints']
        self.assertEqual(checkpoints[-1]['values']['memory_contents'], expected)
        self.assertEqual(checkpoints[-1]['values']['memory_scope_owner'], SCOPE)
        self.assertIn("Fleet note", self.model.prompts[-1])
        tools = [m for m in state.values['messages'] if m.type == 'tool']
        self.assertEqual([m.status for m in tools], ['success'])
        self.assertTrue(any(type(op).__name__ == 'PutOp' for op in self.store.operations))
        _, state = await self.stream('a', scenario='edit')
        self.assertEqual(state.values['memory_contents'], {FILE: UPDATED})
        _, recalled = await self.stream('b')
        self.assertEqual(recalled.values['memory_contents'], {FILE: UPDATED})
        self.assertIn("Updated fleet note", self.model.prompts[-1])
        _, isolated = await self.stream('c', OTHER)
        self.assertEqual(isolated.values['memory_contents'], {})
        self.assertNotIn(UPDATED, self.model.prompts[-1])

    async def test_filtered_terminal_failure_has_partial_actual_events_and_persistent_write(self):
        original = StoreBackend.download_files
        reads = []
        def fail_terminal(backend, paths):
            reads.append(paths)
            if len(reads) == 4:
                raise RuntimeError('Private failure')
            return original(backend, paths)
        self.model.calls = SCENARIOS['teach']
        events = []
        with patch.object(StoreBackend, 'download_files', fail_terminal):
            with self.assertRaisesRegex(RuntimeError, '^Memory observation unavailable$'):
                async for e in self.graph.astream(
                    {'messages': [{'type': 'human', 'id': 'failure', 'content': 'teach'}]},
                    {'configurable': {'thread_id': 'failure'}}, context={'memory_scope': SCOPE},
                    output_keys=self.graph.output_channels, subgraphs=True,
                    stream_mode=['values', 'custom', 'checkpoints']):
                    events.append(e)
        phases = [data['data']['phase'] for ns, kind, data in events if kind == 'custom']
        self.assertEqual(phases, ['initial', 'model', 'model'])
        backend = StoreBackend(store=self.store, namespace=lambda _: ('cockpit', 'deep-agents-memory', 'browser-v1', SCOPE))
        self.assertEqual(backend.download_files([FILE])[0].content.decode(), LITERAL)
        _, state = await self.stream('new')
        self.assertEqual(state.values['memory_contents'], {FILE: LITERAL})

if __name__ == '__main__':
    unittest.main()
