"""Contracts of the actual Planning builder and installed TodoListMiddleware."""
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


def todo(content, status="pending"):
    return {"content": content, "status": status}


def call(todos, identity="write"):
    return {"name": "write_todos", "args": {"todos": todos}, "id": identity, "type": "tool_call"}


class LocalModel(BaseChatModel):
    responses: list[AIMessage] = []
    cursor: int = 0

    @property
    def _llm_type(self):
        return "local-planning-contract"

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
        spec = importlib.util.spec_from_file_location("local_planning_contract", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.build_planning_agent().builder.compile(checkpointer=InMemorySaver())


def responses(batches, identity="turn"):
    return [AIMessage(id=f"{identity}-model-{i}", content="", tool_calls=batch)
            for i, batch in enumerate(batches)] + [AIMessage(id=f"{identity}-answer", content="Flight assessment ready.")]


class PlanningStreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network = self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(network.assert_not_called)
        self.model = LocalModel()
        self.graph = build(self.model)
        self.config = {"configurable": {"thread_id": "planning-contract"}}

    async def send(self, batches, identity="turn"):
        self.model.responses = responses(batches, identity)
        self.model.cursor = 0
        events = [deepcopy(e) async for e in self.graph.astream(
            {"messages": [{"type": "human", "id": identity, "content": identity}]},
            self.config, stream_mode=["messages", "values", "updates", "checkpoints"])]
        saved = await self.graph.aget_state(self.config)
        self.assertFalse(saved.next)
        self.assertFalse(saved.tasks)
        self.assertEqual([v for k, v in events if k == "values"][-1], saved.values)
        checkpoints = [v for k, v in events if k == "checkpoints"]
        self.assertEqual(checkpoints[-1]["config"]["configurable"]["checkpoint_id"], saved.config["configurable"]["checkpoint_id"])
        self.assertEqual(checkpoints[-1]["values"], saved.values)
        self.assertTrue(all(not task.interrupts for task in saved.tasks))
        return saved, events

    async def test_whole_list_replacement_preserves_order_duplicates_and_empty(self):
        first = [todo("Old"), todo("Removed")]
        replacement = [todo("Duplicate", "completed"), todo("Duplicate", "in_progress"), todo("First", "pending")]
        saved, events = await self.send([[call(first, "first")], [call(replacement, "replacement")]])
        self.assertEqual(saved.values["todos"], replacement)
        observed = [v.get("todos") for k, v in events if k == "values"]
        self.assertIn(first, observed)
        self.assertIn(replacement, observed)
        tools = [m for m in saved.values["messages"] if isinstance(m, ToolMessage)]
        self.assertEqual([(m.tool_call_id, m.name, m.status) for m in tools], [("first", "write_todos", "success"), ("replacement", "write_todos", "success")])
        self.assertTrue(tools[-1].content.startswith("Updated todo list to ["))
        cleared, _ = await self.send([[call([], "clear")]], "clear-turn")
        self.assertEqual(cleared.values["todos"], [])

    async def test_parallel_rejection_retains_prior_plan_and_later_valid_write_recovers(self):
        prior = [todo("Retain")]
        await self.send([[call(prior, "seed")]], "seed")
        rejected, _ = await self.send([[call([todo("Wrong A")], "a"), call([todo("Wrong B")], "b")]], "rejected")
        self.assertEqual(rejected.values["todos"], prior)
        errors = [m for m in rejected.values["messages"] if isinstance(m, ToolMessage) and m.tool_call_id in ("a", "b")]
        self.assertEqual([(m.tool_call_id, m.name, m.status) for m in errors], [("a", None, "error"), ("b", None, "error")])
        self.assertTrue(all("multiple times in parallel" in m.content for m in errors))
        valid = [todo("Recovered", "in_progress")]
        saved, events = await self.send([[call(prior, "c"), call(prior, "d")], [call(valid, "recover")]], "recovery")
        self.assertEqual(saved.values["todos"], valid)
        self.assertEqual(saved.values["messages"][-1].content, "Flight assessment ready.")
        self.assertEqual(saved.values["todos"][0]["status"], "in_progress")
        tools = [m for m in saved.values["messages"] if isinstance(m, ToolMessage)]
        self.assertEqual(tools[-1].status, "success")

    async def test_invalid_tool_schema_rejected_without_replacing_plan(self):
        prior = [todo("Safe", "completed")]
        await self.send([[call(prior, "seed")]], "seed")
        for identity, args in (("bad-status", {"todos": [todo("Bad", "invented")]}), ("missing-todos", {})):
            malformed = {"name": "write_todos", "args": args, "id": identity, "type": "tool_call"}
            saved, _ = await self.send([[malformed]], identity)
            self.assertEqual(saved.values["todos"], prior)
            result = next(m for m in saved.values["messages"] if isinstance(m, ToolMessage) and m.tool_call_id == identity)
            self.assertEqual((result.name, result.status), ("write_todos", "error"))
            self.assertIn("Error", result.content)

    async def test_saved_checkpoint_history_correlates_canonical_messages_without_run_metadata(self):
        saved, events = await self.send([[call([todo("Work", "in_progress")])]])
        checkpoints = [e for k, e in events if k == "checkpoints"]
        terminal = checkpoints[-1]
        self.assertEqual(terminal["config"]["configurable"]["thread_id"], "planning-contract")
        exact = await self.graph.aget_state(terminal["config"])
        self.assertEqual(exact.values, saved.values)
        self.assertEqual(terminal["next"], [])
        self.assertEqual(terminal["tasks"], [])
        self.assertNotIn("run_id", exact.metadata)
        self.assertEqual(exact.values["messages"][0].id, "turn")
        history = [s async for s in self.graph.aget_state_history(self.config)]
        self.assertEqual(history[0].config, saved.config)
        self.assertTrue(any(s.next for s in history))
        self.assertTrue(any(s.tasks for s in history))
        self.assertFalse(any(t.interrupts for s in history for t in s.tasks))
        self.assertNotIn("completed_turn_id", saved.values)
        self.assertNotIn("operation_receipt", saved.values)


if __name__ == "__main__":
    unittest.main()
