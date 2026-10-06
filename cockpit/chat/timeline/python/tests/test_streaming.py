"""Exercise the deployed graph with local model callbacks and real checkpoints."""
import importlib.util
import io
import os
from pathlib import Path
import socket
from contextlib import redirect_stdout
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver


class LocalModel(BaseChatModel):
    title: bool = False
    fail_title: bool = False
    answer_id: str | None = None

    @property
    def _llm_type(self):
        return "local-timeline"

    def answer(self, messages):
        human = next((m for m in reversed(messages) if m.type == "human"), None)
        identity = self.answer_id if self.answer_id is not None else "answer-" + ((human.id or "none") if human else "none")
        return AIMessage(id="title" if self.title else identity,
                         content="Local timeline title" if self.title else "Answer: " + (human.content if human else "empty"))

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if self.title and self.fail_title:
            raise RuntimeError("Local title failure")
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        answer = self.answer(messages)
        for start in range(0, len(answer.content), 3):
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content=answer.content[start:start + 3]))
            if self.title and self.fail_title:
                raise RuntimeError("Local title failure")
            if not self.title and any(m.content == "fail-stream" for m in messages):
                raise RuntimeError("Local main failure")
        yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", chunk_position="last"))


class TimelineTests(unittest.IsolatedAsyncioTestCase):
    def setup_graph(self, *, fail_title=False, answer_id=None, existing_title=None, fail_read=False, fail_write=False):
        self.network = self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(self.network.assert_not_called)
        self.diagnostics = self.enterContext(redirect_stdout(io.StringIO()))
        self.threads = SimpleNamespace(
            get=AsyncMock(return_value={"metadata": {"title": existing_title} if existing_title else {}},
                          side_effect=RuntimeError("Metadata read failure") if fail_read else None),
            update=AsyncMock(side_effect=RuntimeError("Metadata write failure") if fail_write else None),
        )
        self.enterContext(patch("langgraph_sdk.get_client", return_value=SimpleNamespace(threads=self.threads)))
        self.enterContext(patch("langchain_openai.ChatOpenAI", side_effect=lambda **kw: LocalModel(
            title=not kw.get("streaming", False), tags=kw.get("tags", []), fail_title=fail_title, answer_id=answer_id)))
        spec = importlib.util.spec_from_file_location("local_timeline", Path(__file__).parents[1] / "src/graph.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.graph = module.graph.builder.compile(checkpointer=InMemorySaver())
        self.tip = {"configurable": {"thread_id": "timeline"}}

    def assert_identity(self, values, human_id):
        ids = [m.id for m in values["messages"]]
        self.assertEqual(values.get("completed_message_ids"), ids)
        self.assertEqual(values.get("completed_turn_id"), human_id)
        self.assertEqual(values.get("completed_answer_id"), ids[-1])
        self.assertEqual(ids[-2], human_id)
        self.assertEqual(len(ids), len(set(ids)))

    async def send(self, identity, config=None):
        events = [event async for event in self.graph.astream(
            {"messages": [HumanMessage(id=identity, content=identity)]}, config or self.tip,
            stream_mode=["messages", "values"])]
        saved = await self.graph.aget_state(self.tip)
        self.assertFalse(saved.next)
        self.assertFalse(saved.tasks)
        callbacks = [event for kind, event in events if kind == "messages"]
        self.assertFalse([event for event in callbacks if event[1]["langgraph_node"] == "generate_title"])
        self.assert_identity(saved.values, identity)
        chunks = [message for message, meta in callbacks if meta["langgraph_node"] == "generate"]
        self.assertGreater(len(chunks), 1)
        self.assertEqual("".join(m.content for m in chunks), saved.values["messages"][-1].content)
        self.assertEqual({m.id for m in chunks}, {saved.values["completed_answer_id"]})
        return saved

    async def test_title_success_has_no_message_callbacks(self):
        self.setup_graph()
        await self.send("human-a")
        self.threads.update.assert_awaited_once_with("timeline", metadata={"title": "Local timeline title"})

    async def test_title_model_failure_has_no_message_callbacks_and_preserves_answer(self):
        self.setup_graph(fail_title=True)
        await self.send("human-a")
        self.threads.update.assert_not_awaited()
        self.assertIn("Local title failure", self.diagnostics.getvalue())

    async def test_existing_title_skips_metadata_update(self):
        self.setup_graph(existing_title="Existing")
        await self.send("human-a")
        self.threads.update.assert_not_awaited()

    async def test_metadata_read_failure_preserves_answer(self):
        self.setup_graph(fail_read=True)
        await self.send("human-a")
        self.assertIn("Metadata read failure", self.diagnostics.getvalue())

    async def test_metadata_write_failure_preserves_answer(self):
        self.setup_graph(fail_write=True)
        await self.send("human-a")
        self.assertIn("Metadata write failure", self.diagnostics.getvalue())

    async def test_main_failure_propagates_with_partial_callbacks_and_pending_checkpoint(self):
        self.setup_graph()
        chunks = []
        with self.assertRaisesRegex(RuntimeError, "Local main failure"):
            async for kind, event in self.graph.astream(
                {"messages": [HumanMessage(id="failure", content="fail-stream")]}, self.tip,
                stream_mode=["messages", "values"]):
                if kind == "messages":
                    chunks.append(event[0].content)
        self.assertTrue("".join(chunks))
        saved = await self.graph.aget_state(self.tip)
        self.assertEqual(saved.next, ("generate",))
        self.assertEqual([m.type for m in saved.values["messages"]], ["human"])
        self.assertNotIn("completed_turn_id", saved.values)
        self.threads.get.assert_not_awaited()

    async def test_completed_source_fork_excludes_later_tip_and_followup_extends_fork(self):
        self.setup_graph(existing_title="Existing")
        a = await self.send("human-a")
        b = await self.send("human-b")
        c = await self.send("human-c")
        fork = await self.send("human-fork", a.config)
        self.assertEqual([m.id for m in fork.values["messages"] if m.type == "human"],
                         ["human-a", "human-fork"])
        await self.send("human-competing", b.config)
        followup = await self.send("human-followup", fork.config)
        self.assertEqual([m.id for m in followup.values["messages"] if m.type == "human"],
                         ["human-a", "human-fork", "human-followup"])
        self.assertEqual(followup.values["messages"][:4], fork.values["messages"])
        self.assertEqual((await self.graph.aget_state(b.config)).values, b.values)
        self.assertEqual((await self.graph.aget_state(c.config)).values, c.values)
        self.assertEqual((await self.graph.aget_state(a.config)).values, a.values)
        ancestors = []
        ancestor = fork
        while ancestor.parent_config:
            ancestors.append(ancestor.parent_config)
            ancestor = await self.graph.aget_state(ancestor.parent_config)
        self.assertIn(a.config, ancestors)
        self.assertNotIn(b.config, ancestors)
        self.assertNotIn(c.config, ancestors)

    async def test_invalid_answer_identity_does_not_publish_completion(self):
        self.setup_graph(answer_id="human-a", existing_title="Existing")
        values = await self.graph.ainvoke({"messages": [HumanMessage(id="human-a", content="Question")]}, self.tip)
        for key in ["completed_turn_id", "completed_answer_id", "completed_message_ids"]:
            self.assertNotIn(key, values)

    async def test_empty_answer_identity_does_not_publish_completion(self):
        self.setup_graph(answer_id="", existing_title="Existing")
        values = await self.graph.ainvoke({"messages": [HumanMessage(id="human-a", content="Question")]}, self.tip)
        self.assertNotIn("completed_message_ids", values)

    async def test_historical_collision_does_not_publish_completion(self):
        self.setup_graph(answer_id="old-answer", existing_title="Existing")
        values = await self.graph.ainvoke({"messages": [HumanMessage(id="old-human", content="Old"),
            AIMessage(id="old-answer", content="Old answer"), HumanMessage(id="new-human", content="New")]}, self.tip)
        self.assertNotIn("completed_message_ids", values)

    async def test_trailing_assistant_does_not_fabricate_turn_identity(self):
        self.setup_graph(existing_title="Existing")
        values = await self.graph.ainvoke({"messages": [HumanMessage(id="old-human", content="Old"),
            AIMessage(id="old-answer", content="Already answered")]}, self.tip)
        self.assertNotIn("completed_turn_id", values)


if __name__ == "__main__":
    unittest.main()
