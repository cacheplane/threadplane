"""Typed backend outcomes, real composite routing, and namespace deployment imports."""
from pathlib import Path
import shutil
import socket
from unittest.mock import patch
import subprocess
import sys
import tempfile
import unittest

from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from deepagents.backends.protocol import DeleteResult, EditResult, FileUploadResponse, WriteResult, SandboxBackendProtocol
from langgraph.store.memory import InMemoryStore
from test_streaming import LocalModel, ROOT, load

from src.skills_readonly import ReadOnlySkillsBackend

class ReadonlyBackendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, 'connect', side_effect=AssertionError('Remote socket forbidden')))
        self.addCleanup(network.assert_not_called)
        self.store = InMemoryStore()
        self.namespace = ('offline', 'skills')
        self.writable = StoreBackend(namespace=lambda _: self.namespace, store=self.store)
        self.writable.write('/runway/SKILL.md', 'Bundled instructions')
        self.writable.write('/runway/reference.md', 'Original reference')
        self.readonly = ReadOnlySkillsBackend(namespace=lambda _: self.namespace, store=self.store)
        self.composite = CompositeBackend(default=StateBackend(), routes={'/skills/': self.readonly})
    def unchanged(self):
        self.assertEqual(self.writable.read('/runway/reference.md').file_data['content'], 'Original reference')
        self.assertEqual(sorted(e['path'] for e in self.writable.glob('**', '/').matches), ['/runway/SKILL.md', '/runway/reference.md'])
        self.assertEqual(self.writable.read('/runway/SKILL.md').file_data['content'], 'Bundled instructions')
    def assert_denied(self, result, expected):
        self.assertIsInstance(result, expected)
        self.assertEqual(result.error, 'permission_denied')
        self.assertIsNone(result.path)
        self.unchanged()
    async def test_all_sync_and_async_mutation_entrypoints_are_typed_denials(self):
        for backend, prefix in ((self.readonly, ''), (self.composite, '/skills')):
            with self.subTest(prefix=prefix):
                self.assert_denied(backend.write(prefix+'/new.md', 'forbidden'), WriteResult)
                self.assert_denied(await backend.awrite(prefix+'/new.md', 'forbidden'), WriteResult)
                self.assert_denied(backend.edit(prefix+'/runway/reference.md', 'Original', 'Changed'), EditResult)
                self.assert_denied(await backend.aedit(prefix+'/runway/reference.md', 'Original', 'Changed', True), EditResult)
                self.assert_denied(backend.delete(prefix+'/runway'), DeleteResult)
                self.assert_denied(await backend.adelete(prefix+'/runway'), DeleteResult)
                files = [(prefix+'/runway/reference.md', b'changed'), (prefix+'/new.md', b'new')]
                for results in (backend.upload_files(files), await backend.aupload_files(files)):
                    self.assertEqual([r.path for r in results], [p for p,_ in files])
                    self.assertTrue(all(isinstance(r, FileUploadResponse) and r.error == 'permission_denied' for r in results))
                    self.unchanged()
                self.assertEqual(backend.upload_files([]), [])
                self.assertEqual(await backend.aupload_files([]), [])
    async def test_reads_listing_grep_glob_and_download_delegate(self):
        path = '/skills/runway/reference.md'
        self.assertFalse(isinstance(self.readonly, SandboxBackendProtocol))
        self.assertEqual(self.composite.read(path).file_data['content'], 'Original reference')
        self.assertEqual((await self.composite.aread(path)).file_data['content'], 'Original reference')
        self.assertEqual(self.composite.ls('/skills/runway/').entries, (await self.composite.als('/skills/runway/')).entries)
        self.assertEqual(self.composite.grep('Original', '/skills/').matches, (await self.composite.agrep('Original', '/skills/')).matches)
        self.assertTrue(self.composite.grep('Original', '/skills/').matches)
        self.assertEqual(self.composite.glob('**/*.md','/skills/').matches, (await self.composite.aglob('**/*.md','/skills/')).matches)
        for results in (self.composite.download_files([path, '/skills/missing']), await self.composite.adownload_files([path, '/skills/missing'])):
            self.assertEqual(results[0].path, path)
            self.assertEqual(results[0].content, b'Original reference')
            self.assertEqual(results[1].error, 'file_not_found')
    async def test_mixed_batch_preserves_skill_and_writes_thread_state(self):
        # StateBackend deliberately resolves the real graph's current runtime.
        model = LocalModel()
        module, graph = load(model)
        before = module.SKILLS_STORE.search(module.SKILLS_NAMESPACE)
        model.calls = [('write_file', {'file_path':'/notes.md','content':'Private note'})]
        config = {'configurable': {'thread_id': 'note'}}
        state = await graph.ainvoke({'messages':[{'type':'human','id':'note','content':'Write notes.'}]}, config)
        self.assertIn('/notes.md', state['files'])
        self.assertEqual(module.SKILLS_STORE.search(module.SKILLS_NAMESPACE), before)
        # Invoke the actual mixed batch inside a LangGraph node so the default
        # StateBackend uses real channel reads/writes, without mocking runtime.
        from langgraph.graph import StateGraph, START, END
        from typing import TypedDict
        class FileState(TypedDict):
            files: dict
        files = [('/skills/runway/reference.md', b'forbidden'), ('/notes.md', b'allowed'), ('/skills/new.md', b'forbidden')]
        def check(results):
            self.assertEqual([r.path for r in results], [p for p,_ in files])
            self.assertEqual([r.error for r in results], ['permission_denied', None, 'permission_denied'])
            self.unchanged()
        def sync_batch(state):
            check(self.composite.upload_files(files))
            return {}
        async def async_batch(state):
            check(await self.composite.aupload_files(files))
            return {}
        for node in (sync_batch, async_batch):
            builder = StateGraph(FileState)
            builder.add_node('batch', node)
            builder.add_edge(START, 'batch')
            builder.add_edge('batch', END)
            state = await builder.compile().ainvoke({'files': {}})
            self.assertEqual(state['files']['/notes.md']['content'], 'allowed')


class DeploymentImportTests(unittest.TestCase):
    def test_unique_module_import_from_staged_namespace_portions(self):
        self.assertFalse((ROOT/'src/__init__.py').exists())
        repo = ROOT.parents[3]
        generator = (repo/'scripts/generate-shared-deployment-config.ts').read_text()
        self.assertIn('cpSync(sourceDir, stagedDir, { recursive: true })', generator)
        manifest = __import__('json').loads((ROOT/'langgraph.json').read_text())
        self.assertEqual(manifest['graphs']['da-skills'], './src/graph.py:graph')
        with tempfile.TemporaryDirectory() as temp:
            staged = Path(temp)/'deps/da-skills'
            # Same root-copy convention; omit runtime caches, which are not
            # source or dependencies and are unnecessary for import routing.
            shutil.copytree(ROOT, staged, ignore=shutil.ignore_patterns('.venv','__pycache__'))
            other = Path(temp)/'deps/other/src'
            other.mkdir(parents=True)
            (other/'other_capability.py').write_text('VALUE = 42\n')
            script = """
import importlib.util, pathlib, socket, sys
from unittest.mock import patch
sys.path[:0] = [sys.argv[1], sys.argv[2], sys.argv[3]]
from test_streaming import LocalModel, load
from src.other_capability import VALUE
from src.skills_readonly import ReadOnlySkillsBackend
assert VALUE == 42
assert pathlib.Path(__import__('src.skills_readonly', fromlist=['x']).__file__).resolve() == pathlib.Path(sys.argv[1], 'src/skills_readonly.py').resolve()
with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')) as network:
    module, graph = load(LocalModel(), pathlib.Path(sys.argv[1]))
    assert module.ReadOnlySkillsBackend is ReadOnlySkillsBackend
    network.assert_not_called()
"""
            result = subprocess.run([sys.executable, '-c', script, str(staged), str(other.parent), str(ROOT/'tests')], cwd=temp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__':
    unittest.main()
