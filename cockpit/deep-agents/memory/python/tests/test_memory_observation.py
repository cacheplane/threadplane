"""Actual compiled Memory graph contracts; no provider or remote sockets."""
import socket
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from importlib.metadata import version
import unittest
from unittest.mock import patch
from model_support import LocalModel, CountingStore, load, FILE, SCOPE, OTHER, ROOT
from deepagents.backends import StoreBackend
from langchain_core.messages import RemoveMessage
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from src.memory_observation import MEMORY_NAMESPACE, MemoryObservationError, memory_namespace
from types import SimpleNamespace

class MemoryGraphTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, 'connect', side_effect=AssertionError('Remote socket forbidden')))
        self.addCleanup(network.assert_not_called)
        self.model = LocalModel()
        self.store = CountingStore()
        self.module, self.graph = load(self.model, store=self.store)
    async def test_same_turn_store_write_is_terminal_snapshot_and_next_model_prompt(self):
        self.model.calls = [('write_file', {'file_path':FILE,'content':'Crew note\n\n  literal whitespace  \n'})]
        config = {'configurable': {'thread_id':'write'}}
        await self.graph.ainvoke({'messages':[{'type':'human','id':'write','content':'Write memory.'}]}, config, context={'memory_scope':SCOPE})
        saved = await self.graph.aget_state(config)
        self.assertEqual(saved.values['memory_contents'], {FILE:'Crew note\n\n  literal whitespace  \n'})
        self.assertIn('Crew note', self.model.prompts[-1])

    async def send(self, thread, scope=SCOPE, extra=None, asynchronous=True):
        config = {'configurable':{'thread_id':thread}}
        data = {'messages':[{'type':'human','id':str(len(self.model.prompts)),'content':'Offline request.'}]}
        data.update(extra or {})
        if asynchronous:
            events = [e async for e in self.graph.astream(data, config, context=scope, stream_mode=['values','custom'])]
        else:
            events = list(self.graph.stream(data, config, context=scope, stream_mode=['values','custom']))
        saved = self.graph.get_state(config)
        return saved.values, events

    def backend(self, scope=SCOPE):
        return StoreBackend(store=self.store, namespace=lambda _: (*MEMORY_NAMESPACE, scope))

    async def test_sync_async_freshness_isolation_events_and_private_inputs(self):
        for asynchronous in (False, True):
            with self.subTest(asynchronous=asynchronous):
                self.model = LocalModel()
                self.store = CountingStore()
                self.module, self.graph = load(self.model, store=self.store)
                self.model.calls = [('write_file', {'file_path':FILE,'content':'Literal\n\n  Ω  \n'})]
                state, events = await self.send('a', {'memory_scope':SCOPE}, asynchronous=asynchronous)
                expected = {FILE:'Literal\n\n  Ω  \n'}
                self.assertEqual(state['memory_contents'], expected)
                self.assertEqual(state['memory_scope_owner'], SCOPE)
                self.assertIn('Literal', self.model.prompts[-1])
                custom = [d['data'] for kind,d in events if kind == 'custom' and d.get('name') == 'deep_agents.memory']
                self.assertEqual([d['phase'] for d in custom], ['initial','model','model','terminal'])
                self.assertEqual(custom[0]['memory_contents'], {})
                self.assertEqual(custom[-1]['memory_contents'], expected)
                self.assertTrue(all(d['memory_scope_owner'] == SCOPE for d in custom))
                # Four observations, plus the write's existence check and put.
                self.assertEqual(len(self.model.prompts), 2)
                self.assertEqual(sum(type(op).__name__ == 'GetOp' for op in self.store.operations), 5)
                self.assertEqual([d for kind,d in events if kind == 'values'][-1]['memory_contents'], expected)
                self.model.calls = []
                edges={(e.source,e.target) for e in self.graph.get_graph().edges}
                self.assertTrue({
                    ('PatchToolCallsMiddleware.before_agent','MemoryObservationMiddleware.before_agent'),
                    ('MemoryObservationMiddleware.before_agent','MemoryMiddleware.before_agent'),
                    ('MemoryMiddleware.before_agent','MemoryObservationMiddleware.before_model'),
                } <= edges)
                for thread in ('a','b'):
                    state,_ = await self.send(thread, {'memory_scope':SCOPE}, {
                        'memory_scope_owner':OTHER,'memory_contents':{FILE:'Injected'}}, asynchronous)
                    self.assertEqual(state['memory_contents'], expected)
                    self.assertEqual(state['memory_scope_owner'], SCOPE)
                for attempted_owner in (None,'',OTHER):
                    state,_=await self.send('a',{'memory_scope':SCOPE},{'memory_scope_owner':attempted_owner,'memory_contents':None},asynchronous)
                    self.assertEqual(state['memory_scope_owner'],SCOPE)
                    self.assertEqual(state['memory_contents'],expected)
                self.backend().edit(FILE,'Literal','Updated external')
                expected={FILE:'Updated external\n\n  Ω  \n'}
                state,_=await self.send('a',{'memory_scope':SCOPE},asynchronous=asynchronous)
                self.assertEqual(state['memory_contents'],expected)
                self.assertIn('Updated external',self.model.prompts[-1])
                state,_ = await self.send('c', {'memory_scope':OTHER}, asynchronous=asynchronous)
                self.assertEqual(state['memory_contents'], {})
                # Removing public transcript messages cannot remove private ownership.
                state,_ = await self.send('a', {'memory_scope':SCOPE}, {'messages':[
                    RemoveMessage(id=REMOVE_ALL_MESSAGES), {'type':'human','id':'removed','content':'Offline'}]}, asynchronous)
                self.assertEqual(state['memory_scope_owner'], SCOPE)
                for schema in (self.graph.get_input_jsonschema(),self.graph.get_output_jsonschema()):
                    self.assertNotIn('memory_scope_owner',schema['properties'])
                    self.assertNotIn('memory_contents',schema['properties'])
                self.assertTrue(self.store.operations)
                self.assertTrue(all(getattr(op,'namespace',(*MEMORY_NAMESPACE,SCOPE))[:3] == MEMORY_NAMESPACE for op in self.store.operations))

    async def test_denied_admission_has_zero_model_store_and_namespace_calls(self):
        await self.send('bound', {'memory_scope':SCOPE})
        for asynchronous in (False,True):
            for context in (None,{}, {'memory_scope':SCOPE.upper()}, {'memory_scope':'bad'}, {'memory_scope':OTHER}, {'memory_scope':SCOPE,'extra':1}, {'memory_scope':'00000000-0000-1000-8000-000000000000'}):
                with self.subTest(asynchronous=asynchronous,context=context):
                    self.store.operations.clear()
                    self.model.prompts.clear()
                    with patch.object(StoreBackend,'_get_namespace',side_effect=AssertionError('Denied namespace work')) as factory:
                        with self.assertRaises(ValueError):
                            await self.send('bound', context, {'memory_scope_owner':OTHER}, asynchronous)
                        factory.assert_not_called()
                    self.assertEqual(self.store.operations, [])
                    self.assertEqual(self.model.prompts, [])

    async def test_historic_unbound_checkpoint_replaces_stale_snapshot_without_global_read(self):
        self.backend().write(FILE,'Scoped fresh')
        for asynchronous in (False,True):
            thread='historic-'+str(asynchronous)
            config={'configurable':{'thread_id':thread}}
            self.graph.update_state(config, {'messages':[{'type':'human','content':'Old transcript'}], 'memory_contents':{FILE:'Legacy'}},as_node='MemoryObservationMiddleware.before_agent')
            before=self.graph.get_state(config).values
            self.assertEqual(before['memory_contents'],{FILE:'Legacy'})
            self.assertNotIn('memory_scope_owner',before)
            self.store.operations.clear()
            state,_ = await self.send(thread, {'memory_scope':SCOPE},asynchronous=asynchronous)
            self.assertEqual(state['memory_contents'], {FILE:'Scoped fresh'})
            self.assertEqual(state['memory_scope_owner'], SCOPE)
            self.assertTrue(all(op.namespace == (*MEMORY_NAMESPACE,SCOPE) for op in self.store.operations))

    async def test_literal_missing_empty_multibyte_boundary_and_failed_reads_all_phases(self):
        for asynchronous in (False, True):
            for content in (None,'','\n\n  Ω  \n','Ω'*32768):
                self.store = CountingStore()
                self.module,self.graph=load(self.model,store=self.store)
                if content is not None:
                    self.backend().write(FILE,content)
                state,_=await self.send('literal',{'memory_scope':SCOPE},asynchronous=asynchronous)
                self.assertEqual(state['memory_contents'], {} if content is None else {FILE:content})
            for payload in (b'x'*65537,b'\xff','backend_failure'):
                for phase_read in (1,2,3):
                    self.store=CountingStore()
                    self.module,self.graph=load(self.model,store=self.store)
                    self.model.prompts.clear()
                    original = self.store.get
                    reads=[]
                    def failing_get(namespace,key,**kwargs):
                        reads.append((namespace,key))
                        if len(reads)==phase_read:
                            if payload=='backend_failure':
                                raise RuntimeError('private backend diagnostic')
                            # StoreBackend actually materializes/decode these bytes.
                            self.backend().upload_files([(FILE,payload)])
                        return original(namespace,key,**kwargs)
                    with patch.object(self.store,'get',side_effect=failing_get):
                        with self.assertRaisesRegex(MemoryObservationError,'^Memory observation unavailable$'):
                            await self.send('fail',{'memory_scope':SCOPE},asynchronous=asynchronous)
                    self.assertEqual(len(self.model.prompts), 1 if phase_read==3 else 0)

    async def test_post_write_terminal_failure_preserves_write_without_confirmation(self):
        for asynchronous in (False,True):
            self.store=CountingStore()
            self.model=LocalModel(calls=[('write_file',{'file_path':FILE,'content':'Persisted despite failure'})])
            self.module,self.graph=load(self.model,store=self.store)
            # Count actual observation downloads, without disrupting write checks.
            original=StoreBackend.download_files
            downloads=[]
            def fail_terminal(backend, paths):
                downloads.append(paths)
                if len(downloads)==4:
                    raise RuntimeError('private terminal diagnostic')
                return original(backend, paths)
            with patch.object(StoreBackend,'download_files',fail_terminal):
                observed=[]
                with self.assertRaises(MemoryObservationError):
                    config={'configurable':{'thread_id':'terminal'}}
                    data={'messages':[{'type':'human','id':'terminal','content':'Write offline'}]}
                    if asynchronous:
                        async for event in self.graph.astream(data,config,context={'memory_scope':SCOPE},stream_mode=['values','custom']):
                            observed.append(event)
                    else:
                        for event in self.graph.stream(data,config,context={'memory_scope':SCOPE},stream_mode=['values','custom']):
                            observed.append(event)
                self.assertNotIn('terminal',[d['data']['phase'] for kind,d in observed if kind=='custom' and d.get('name')=='deep_agents.memory'])
                tools=[m for m in self.graph.get_state(config).values['messages'] if m.type=='tool']
                self.assertEqual(tools[-1].status,'success')
            self.assertEqual(self.backend().download_files([FILE])[0].content,b'Persisted despite failure')
            self.assertEqual(len(self.model.prompts),2)

    async def test_present_falsey_checkpoint_owner_cannot_be_rebound_by_input(self):
        for owner in (None,''):
            config={'configurable':{'thread_id':'falsey-'+str(owner)}}
            self.graph.update_state(config, {'memory_scope_owner':owner,'messages':[]},as_node='MemoryObservationMiddleware.before_agent')
            self.assertIn('memory_scope_owner',self.graph.get_state(config).values)
            self.assertEqual(self.graph.get_state(config).values['memory_scope_owner'],owner)
            self.store.operations.clear()
            with self.assertRaises(ValueError):
                await self.send('falsey-'+str(owner), {'memory_scope':SCOPE}, {'memory_scope_owner':SCOPE})
            self.assertEqual(self.store.operations, [])
            self.assertEqual(self.model.prompts, [])

    def test_namespace_factory_independently_rejects_invalid_context(self):
        self.assertEqual(memory_namespace(SimpleNamespace(context={'memory_scope':SCOPE})),(*MEMORY_NAMESPACE,SCOPE))
        for context in (None,{}, {'memory_scope':OTHER.upper()}, {'memory_scope':SCOPE,'extra':1}):
            with self.assertRaises(ValueError):
                memory_namespace(SimpleNamespace(context=context))

class DeploymentImportTests(unittest.TestCase):
    def test_pinned_versions_and_staged_shared_deployment_namespace_import(self):
        self.assertEqual({name:version(name) for name in ('deepagents','langchain','langgraph','langgraph-sdk')},
                         {'deepagents':'0.7.11','langchain':'1.3.18','langgraph':'1.2.11','langgraph-sdk':'0.4.4'})
        self.assertFalse((ROOT/'src/__init__.py').exists())
        repo=ROOT.parents[3]
        self.assertIn('cpSync(sourceDir, stagedDir, { recursive: true })',
                      (repo/'scripts/generate-shared-deployment-config.ts').read_text())
        manifest=__import__('json').loads((ROOT/'langgraph.json').read_text())
        self.assertEqual(manifest['graphs']['da-memory'],'./src/graph.py:graph')
        with tempfile.TemporaryDirectory() as temp:
            staged=Path(temp)/'deps/da-memory'
            shutil.copytree(ROOT,staged,ignore=shutil.ignore_patterns('.venv','__pycache__'))
            other=Path(temp)/'deps/other/src'
            other.mkdir(parents=True)
            (other/'other_capability.py').write_text('VALUE = 42\n')
            script='''
import pathlib, socket, sys
from unittest.mock import patch
sys.path[:0] = [sys.argv[1],sys.argv[2],sys.argv[3]]
from model_support import LocalModel, load
from src.other_capability import VALUE
from src.memory_observation import MemoryObservationMiddleware
assert VALUE == 42
assert pathlib.Path(__import__('src.memory_observation',fromlist=['x']).__file__).resolve() == pathlib.Path(sys.argv[1],'src/memory_observation.py').resolve()
with patch.object(socket.socket,'connect',side_effect=AssertionError('Remote socket forbidden')) as network:
    module,graph=load(LocalModel(),pathlib.Path(sys.argv[1]))
    assert module.MemoryObservationMiddleware is MemoryObservationMiddleware
    state=graph.invoke({'messages':[{'type':'human','content':'Offline'}]}, {'configurable':{'thread_id':'stage'}}, context={'memory_scope':'b110fa66-41bb-4f89-8b8e-577cefd8a770'})
    assert state['messages'][-1].content == 'Offline completion.'
    network.assert_not_called()
'''
            result=subprocess.run([sys.executable,'-c',script,str(staged),str(other.parent),str(staged/'tests')],cwd=temp,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__ == '__main__':
    unittest.main()
