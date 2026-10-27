"""Contracts of the actual Filesystem builder and pinned StateBackend/HITL."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import unittest
from copy import deepcopy
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
# Load provider type checks before the construction-only patch below.
import deepagents


def call(name, args, identity="tool"):
    return {"name": name, "args": args, "id": identity, "type": "tool_call"}


def write(path, content, identity="write"):
    return call("write_file", {"file_path": path, "content": content}, identity)


class LocalModel(BaseChatModel):
    responses: list[AIMessage] = []
    cursor: int = 0

    @property
    def _llm_type(self):
        return "local-filesystem-contract"

    def bind_tools(self, tools, **kwargs):
        return self

    def answer(self):
        answer = self.responses[self.cursor]
        self.cursor += 1
        return answer

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer())])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        answer = self.answer()
        for start in range(0, len(answer.content), 4):
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content=answer.content[start:start + 4]))
        for index, tc in enumerate(answer.tool_calls):
            args = json.dumps(tc["args"])
            for part, fragment in enumerate((args[:3], args[3:])):
                yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", tool_call_chunks=[
                    {"index": index, "id": tc["id"] if part == 0 else None,
                     "name": tc["name"] if part == 0 else None, "args": fragment}]))
        yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", chunk_position="last"))


def build(model):
    """Patch only model construction; recompile the actual builder with persistence."""
    path = Path(__file__).parents[1] / "src/graph.py"
    with patch("langchain_openai.ChatOpenAI", return_value=model):
        spec = importlib.util.spec_from_file_location("local_filesystem_contract", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.build_filesystem_agent().builder.compile(checkpointer=InMemorySaver())


def responses(batches, identity="turn"):
    return [AIMessage(id=f"{identity}-model-{i}", content="", tool_calls=batch)
            for i, batch in enumerate(batches)] + [AIMessage(id=f"{identity}-answer", content="Flight assessment ready.")]


class FilesystemStreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(network.assert_not_called)
        self.model = LocalModel()
        self.graph = build(self.model)
        self.config = {"configurable": {"thread_id": "filesystem-contract"}}

    async def send(self, batches, identity="turn"):
        self.model.responses = responses(batches, identity)
        self.model.cursor = 0
        return await self.stream_graph({"messages": [{"type": "human", "id": identity, "content": identity}]})

    async def stream_graph(self, value):
        events = [deepcopy(e) async for e in self.graph.astream(value, self.config,
            stream_mode=["messages", "values", "updates", "checkpoints"])]
        saved = await self.graph.aget_state(self.config)
        exact = await self.graph.aget_state(saved.config)
        self.assertEqual(exact.values, saved.values)
        self.assertEqual({k:v for k,v in [v for k,v in events if k == "values"][-1].items() if k != "__interrupt__"}, saved.values)
        return saved, events

    def batch(self, state):
        interrupts = [i for t in state.tasks for i in t.interrupts]
        self.assertEqual(len(interrupts), 1)
        return interrupts[0].value

    async def resume(self, decisions):
        from langgraph.types import Command
        return await self.stream_graph(Command(resume={"decisions": [{"type": d} for d in decisions]}))

    async def test_real_note_report_pause_approve_and_exact_history(self):
        saved, events = await self.send([[write("/notes/kase.txt", "KASE 7820 ft", "note")],
                                       [write("/reports/kase.md", "Assessment ready", "report")]])
        self.assertEqual(saved.values["files"]["/notes/kase.txt"]["content"], "KASE 7820 ft")
        self.assertNotIn("/reports/kase.md", saved.values["files"])
        batch = self.batch(saved)
        self.assertEqual([a["name"] for a in batch["action_requests"]], ["write_file"])
        self.assertEqual(batch["action_requests"][0]["args"], {"file_path":"/reports/kase.md", "content":"Assessment ready"})
        self.assertIn("approve", batch["review_configs"][0]["allowed_decisions"])
        self.assertTrue(saved.next)
        terminal,_ = await self.resume(["approve"])
        self.assertEqual(terminal.values["files"]["/reports/kase.md"]["content"], "Assessment ready")
        self.assertFalse(terminal.next)
        self.assertFalse(terminal.tasks)
        history = [s async for s in self.graph.aget_state_history(self.config)]
        self.assertEqual(history[0].config, terminal.config)
        self.assertTrue(any(t.interrupts for s in history for t in s.tasks))

    async def test_reject_retains_note_and_can_repropose(self):
        await self.send([[write("/notes/a.txt","retain","note")], [write("/reports/a.txt","first","first")], [write("/reports/a.txt","second","second")]])
        paused,_ = await self.resume(["reject"])
        self.assertNotIn("/reports/a.txt", paused.values["files"])
        rejected = next(m for m in paused.values["messages"] if isinstance(m,ToolMessage) and m.tool_call_id == "first")
        self.assertEqual(rejected.status,"error")
        self.assertEqual(self.batch(paused)["action_requests"][0]["args"]["content"], "second")
        terminal,_ = await self.resume(["approve"])
        self.assertEqual(terminal.values["files"]["/reports/a.txt"]["content"],"second")

    async def test_reject_terminal_has_no_optimistic_report(self):
        await self.send([[write("/reports/a.txt","first")]])
        terminal,_ = await self.resume(["reject"])
        self.assertFalse(terminal.next)
        self.assertNotIn("/reports/a.txt", terminal.values.get("files",{}))
        self.assertEqual(next(m for m in terminal.values["messages"] if isinstance(m,ToolMessage)).status,"error")

    async def test_ordered_batch_including_duplicate_paths(self):
        for paths in (("/reports/a.txt","/reports/b.txt"),("/reports/a.txt","/reports/a.txt")):
            with self.subTest(paths=paths):
                self.setUp()
                saved,_ = await self.send([[write(paths[0],"first","a"),write(paths[1],"second","b")]])
                batch=self.batch(saved)
                self.assertEqual([a["args"]["file_path"] for a in batch["action_requests"]],list(paths))
                self.assertEqual(len(batch["review_configs"]),2)
                terminal,_=await self.resume(["reject","reject"])
                self.assertFalse(terminal.next)
                self.assertFalse(terminal.values.get("files",{}))

    async def test_existing_write_overwrites_and_edit_replace_all(self):
        await self.send([[write("/notes/a.txt","old old")]])
        saved,_=await self.send([[write("/notes/a.txt","overwrite","overwrite")]],"overwrite-turn")
        self.assertEqual(saved.values["files"]["/notes/a.txt"]["content"],"overwrite")
        result=next(m for m in saved.values["messages"] if isinstance(m,ToolMessage) and m.tool_call_id=="overwrite")
        self.assertEqual(result.status,"success")
        await self.send([[write("/notes/a.txt","old old","restore")]],"restore-turn")
        saved,_=await self.send([[call("edit_file",{"file_path":"/notes/a.txt","old_string":"old","new_string":"new","replace_all":True},"edit")]],"edit-turn")
        self.assertEqual(saved.values["files"]["/notes/a.txt"]["content"],"new new")

    async def test_recursive_delete_permissions_and_read_only_unchanged(self):
        await self.send([[write("/reports/sub/a.txt","report")]])
        await self.resume(["approve"])
        saved,_=await self.send([[call("read_file",{"file_path":"/reports/sub/a.txt"},"read")]],"read-turn")
        self.assertFalse(saved.next)
        self.assertEqual(saved.values["files"]["/reports/sub/a.txt"]["content"],"report")
        saved,_=await self.send([[call("delete",{"file_path":"/reports"},"delete")]],"delete-turn")
        self.assertEqual(self.batch(saved)["action_requests"][0]["name"],"delete")
        saved,_=await self.resume(["approve"])
        self.assertEqual(saved.values["files"],{})
        unchanged,_=await self.send([],"unchanged")
        self.assertEqual(unchanged.values["files"],{})

    async def test_no_files_and_empty_utf8_file(self):
        saved,_=await self.send([])
        self.assertEqual(saved.values.get("files",{}),{})
        saved,_=await self.send([[write("/notes/empty.txt","")]],"empty-turn")
        self.assertEqual(saved.values["files"]["/notes/empty.txt"]["content"],"")

    async def test_write_schema_error_retains_files(self):
        await self.send([[write("/notes/a.txt","retain")]])
        saved,_=await self.send([[call("write_file",{"file_path":"/notes/b.txt","content":42},"invalid")]],"invalid-turn")
        self.assertNotIn("/notes/b.txt",saved.values["files"])
        result=next(m for m in saved.values["messages"] if isinstance(m,ToolMessage) and m.tool_call_id=="invalid")
        self.assertEqual(result.status,"error")

    async def protected_overwrite(self, choice):
        old="Prior report"; new="Replacement report"
        await self.send([[write("/reports/existing.md",old,"initial")],
                         [write("/reports/existing.md",new,"replacement")]])
        paused,_=await self.resume(["approve"])
        self.assertEqual(paused.values["files"]["/reports/existing.md"]["content"],old)
        action=self.batch(paused)["action_requests"][0]
        self.assertEqual(action["name"],"write_file")
        self.assertEqual(action["args"],{"file_path":"/reports/existing.md","content":new})
        exact=await self.graph.aget_state(paused.config)
        self.assertEqual(exact.values,paused.values)
        terminal,_=await self.resume([choice])
        self.assertEqual(terminal.values["files"]["/reports/existing.md"]["content"],new if choice=="approve" else old)
        result=next(m for m in terminal.values["messages"] if isinstance(m,ToolMessage) and m.tool_call_id=="replacement")
        self.assertEqual(result.status,"success" if choice=="approve" else "error")
        self.assertFalse(terminal.next); self.assertFalse(terminal.tasks)

    async def test_protected_overwrite_approve_replaces_old_saved_text(self):
        await self.protected_overwrite("approve")

    async def test_protected_overwrite_reject_retains_old_saved_text(self):
        await self.protected_overwrite("reject")

    async def test_report_edit_permission_and_exact_arguments(self):
        await self.send([[write("/reports/a.txt","old old")]])
        await self.resume(["approve"])
        args={"file_path":"/reports/a.txt","old_string":"old","new_string":"new","replace_all":True}
        saved,_=await self.send([[call("edit_file",args,"edit")]],"edit-turn")
        self.assertEqual(self.batch(saved)["action_requests"][0]["args"],args)
        self.assertEqual(saved.values["files"]["/reports/a.txt"]["content"],"old old")
        saved,_=await self.resume(["approve"])
        self.assertEqual(saved.values["files"]["/reports/a.txt"]["content"],"new new")

    async def test_legacy_and_unsupported_records_are_explicit_seed_evidence(self):
        # Synthetic input records, separately identified from backend-produced UTF8 records.
        seeded={"/legacy.txt":{"content":["first","second"]},"/binary.bin":{"content":"aGVsbG8=","encoding":"base64"}}
        self.model.responses=responses([],"synthetic-records"); self.model.cursor=0
        saved,_=await self.stream_graph({"messages":[{"type":"human","id":"synthetic-records","content":"Inspect records"}],"files":seeded})
        self.assertEqual(saved.values["files"],seeded)
        from deepagents.backends.utils import file_data_to_string
        self.assertEqual(file_data_to_string(seeded["/legacy.txt"]),"first\nsecond")

    async def test_mixed_pending_batch_pauses_before_unrestricted_note_and_report(self):
        saved,_=await self.send([[write("/notes/a.txt","note","note"),write("/reports/a.txt","report","report"),call("read_file",{"file_path":"/notes/a.txt"},"read")]])
        self.assertFalse(saved.values.get("files",{}))
        batch=self.batch(saved)
        self.assertEqual([a["args"]["file_path"] for a in batch["action_requests"]],["/reports/a.txt"])
        from langgraph.types import Command
        # Parallel tool event order may differ from persisted canonical order.
        events=[deepcopy(e) async for e in self.graph.astream(Command(resume={"decisions":[{"type":"approve"}]}),self.config,stream_mode=["messages","values","updates","checkpoints"])]
        terminal=await self.graph.aget_state(self.config)
        exact=await self.graph.aget_state(terminal.config)
        self.assertEqual(exact.values,terminal.values)
        self.assertTrue(events)
        results=[m for m in terminal.values["messages"] if isinstance(m,ToolMessage)]
        self.assertEqual({m.tool_call_id for m in results},{"note","report","read"})
        self.assertEqual(len([m for m in terminal.values["messages"] if m.type=="human"]),1)
        self.assertEqual(terminal.values["files"]["/notes/a.txt"]["content"],"note")
        self.assertEqual(terminal.values["files"]["/reports/a.txt"]["content"],"report")
        self.assertFalse(terminal.next)

    def test_worker_contract_exists(self):
        self.assertTrue((Path(__file__).parents[5]/"scripts/react-cockpit/deep-agents-filesystem-wire.py").is_file(), "Filesystem worker missing")

if __name__ == "__main__":
    unittest.main()
