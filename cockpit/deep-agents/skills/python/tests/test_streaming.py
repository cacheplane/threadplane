"""Offline contracts against the actual compiled Skills graph."""
from copy import deepcopy
import importlib.util
import os
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
import deepagents  # Resolve provider class checks before injecting the local model.

ROOT = Path(__file__).parents[1]
REFERENCE = '/skills/runway-analysis/reference/margins.md'
INSTRUCTIONS = '/skills/runway-analysis/SKILL.md'

class LocalModel(BaseChatModel):
    calls: list = []
    @property
    def _llm_type(self):
        return 'offline-skills-contract'
    def bind_tools(self, tools, **kwargs):
        return self
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        human = next(m for m in reversed(messages) if m.type == 'human')
        results = [m for m in messages[messages.index(human):] if m.type == 'tool']
        if len(results) < len(self.calls):
            name, args = self.calls[len(results)]
            answer = AIMessage(content='', tool_calls=[{'name': name, 'args': args, 'id': human.id+'-'+str(len(results)), 'type': 'tool_call'}])
        else:
            answer = AIMessage(content='Offline assessment complete.')
        return ChatResult(generations=[ChatGeneration(message=answer)])

def load(model, root=ROOT):
    with patch('langchain_openai.ChatOpenAI', return_value=model):
        spec = importlib.util.spec_from_file_location('offline_skills_graph', root/'src/graph.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module, module.build_skills_agent().builder.compile(checkpointer=InMemorySaver())

class SkillsStreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, 'connect', side_effect=AssertionError('Remote socket forbidden')))
        self.addCleanup(network.assert_not_called)
        self.model = LocalModel()
        self.module, self.graph = load(self.model)
    async def send(self, thread, calls):
        self.model.calls = calls
        config = {'configurable': {'thread_id': thread}}
        events = [deepcopy(e) async for e in self.graph.astream({'messages': [{'type': 'human', 'id':thread, 'content':'Offline dispatch request.'}]}, config, subgraphs=True, stream_mode=['values','custom','checkpoints'])]
        saved = await self.graph.aget_state(config)
        return saved, events
    async def test_edit_denied_and_distinct_thread_reads_unchanged_reference(self):
        original = (ROOT/'skills/runway-analysis/reference/margins.md').read_text()
        first, _ = await self.send('edit', [('edit_file', {'file_path':REFERENCE,'old_string':'4,800','new_string':'MUTATED','replace_all':True})])
        result = next(m for m in first.values['messages'] if m.type == 'tool')
        second, _ = await self.send('reader', [('read_file', {'file_path':REFERENCE})])
        read = next(m for m in second.values['messages'] if m.type == 'tool')
        self.assertIn('4,800', read.content)
        self.assertNotIn('MUTATED', read.content)
        self.assertEqual(result.status, 'error')
        self.assertIn('permission_denied', result.content)
        self.assertEqual((ROOT/'skills/runway-analysis/reference/margins.md').read_text(), original)
    async def test_write_denied_and_distinct_thread_cannot_read_added_skill(self):
        path = '/skills/new-skill/SKILL.md'
        first, _ = await self.send('writer', [('write_file', {'file_path':path,'content':'UNAUTHORIZED SKILL'})])
        second, _ = await self.send('reader', [('read_file', {'file_path':path})])
        result = next(m for m in first.values['messages'] if m.type == 'tool')
        read = next(m for m in second.values['messages'] if m.type == 'tool')
        self.assertEqual(read.status, 'error')
        self.assertEqual(result.status, 'error')
        self.assertIn('permission_denied', result.content)
    async def test_native_values_custom_checkpoints_and_progressive_reads(self):
        saved, events = await self.send('reads', [('read_file', {'file_path':INSTRUCTIONS}), ('read_file', {'file_path':REFERENCE}), ('write_file', {'file_path':'/notes.md','content':'Thread-local dispatch note'})])
        # PrivateStateAttr describes I/O schema exclusion, not root stream secrecy.
        for schema in (self.graph.get_input_jsonschema(), self.graph.get_output_jsonschema()):
            properties = schema.get('properties', {})
            self.assertNotIn('skills_metadata', properties)
            self.assertNotIn('skills_load_errors', properties)
        # Normal successful loads omit the optional raw key; custom visibility
        # supplies [] without rewriting the raw root/checkpoint state.
        self.assertNotIn('skills_load_errors', saved.values)
        metadata = saved.values['skills_metadata']
        self.assertIn('runway-analysis', [s['name'] for s in metadata])
        root = [d for ns,k,d in events if not ns and k == 'values']
        self.assertEqual(root[-1]['skills_metadata'], metadata)
        self.assertNotIn('skills_load_errors', root[-1])
        custom = [d for ns,k,d in events if not ns and k == 'custom' and d.get('name') == self.module.SKILLS_EVENT]
        self.assertEqual(custom[-1]['data']['skills_metadata'], metadata)
        self.assertEqual(custom[-1]['data']['skills_load_errors'], [])
        checkpoints = [d for ns,k,d in events if not ns and k == 'checkpoints']
        self.assertEqual(checkpoints[-1]['values']['skills_metadata'], metadata)
        self.assertNotIn('skills_load_errors', checkpoints[-1]['values'])
        exact = await self.graph.aget_state(saved.config)
        history = [s async for s in self.graph.aget_state_history(saved.config)]
        self.assertEqual(exact.values, saved.values)
        self.assertEqual(history[0].values, saved.values)
        results = [m for m in saved.values['messages'] if m.type == 'tool']
        self.assertTrue(all(m.status == 'success' for m in results))
        self.assertIn(REFERENCE, results[0].content)
        self.assertIn('4,800', results[1].content)
        self.assertIn('/notes.md', saved.values['files'])
        other, _ = await self.send('other-note-reader', [('read_file', {'file_path':'/notes.md'})])
        self.assertEqual(next(m for m in other.values['messages'] if m.type == 'tool').status, 'error')

if __name__ == '__main__':
    unittest.main()
