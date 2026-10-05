"""Actual compiled graph, real checkpoints and callbacks; no remote providers."""
import importlib.util
import io
import os
from pathlib import Path
import socket
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from providers import AuthoredClient, TITLE, model_factory


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, *, text="Book UA123.", decision="confirm", title=None, fail=False):
        client = AuthoredClient(title=title, fail=fail)
        callbacks = []
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as connect, patch(
            "langchain_openai.ChatOpenAI", model_factory,
        ), patch("langgraph_sdk.get_client", return_value=client), redirect_stdout(io.StringIO()) as diagnostics:
            path = Path(__file__).parents[1] / "src/graph.py"
            spec = importlib.util.spec_from_file_location("authored_interrupts_graph", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_interrupts_graph().builder.compile(checkpointer=InMemorySaver())
            config = {"configurable": {"thread_id": "authored-thread"}}
            async def stream(value):
                async for kind, event in graph.astream(value, config, stream_mode=["messages", "values"]):
                    if kind == "messages":
                        callbacks.append(event)
            await stream({"messages": [HumanMessage(content=text, id="authored-human")]})
            paused = graph.get_state(config)
            self.assertEqual(paused.next, ("tools",))
            self.assertEqual(len(paused.tasks[0].interrupts), 1)
            self.assertEqual(paused.tasks[0].interrupts[0].value["type"], "approval_request")
            await stream(Command(resume=decision))
            saved = graph.get_state(config)
            self.assertFalse(saved.next)
            self.assertFalse(saved.tasks)
            messages = saved.values["messages"]
            tool = next(message for message in messages if message.type == "tool" and message.name == "book_flight")
            call = next(call for message in messages if message.type == "ai" for call in message.tool_calls if call["name"] == "book_flight")
            self.assertEqual(tool.tool_call_id, call["id"])
            self.assertEqual(next(message.id for message, _ in callbacks if message.type == "tool" and message.name == "book_flight"), tool.id)
            self.assertIn("Booked" if decision == "confirm" else "Booking cancelled.", messages[-1].content)
            connect.assert_not_called()
        return callbacks, client, diagnostics.getvalue()

    async def test_absent_title_preserves_real_confirm_stream_without_title_callbacks(self):
        callbacks, client, _ = await self.scenario()
        self.assertEqual(client.threads.updates, [("authored-thread", {"title": TITLE})])
        self.assertEqual([message for message, metadata in callbacks if metadata.get("langgraph_node") == "generate_title"], [])

    async def test_existing_title_preserves_cancel_and_canonical_tool_identity(self):
        callbacks, client, _ = await self.scenario(decision="cancel", title="Existing")
        self.assertFalse(client.threads.updates)
        self.assertFalse([message for message, metadata in callbacks if metadata.get("langgraph_node") == "generate_title"])

    async def test_metadata_failure_does_not_fail_canonical_answer(self):
        callbacks, client, diagnostics = await self.scenario(fail=True)
        self.assertFalse(client.threads.updates)
        self.assertIn("Authored metadata read failure", diagnostics)
        self.assertFalse([message for message, metadata in callbacks if metadata.get("langgraph_node") == "generate_title"])

    async def test_read_tool_and_normalized_booking_keep_causal_results(self):
        callbacks, _, _ = await self.scenario(text="Read then book padded flight.", title="Existing")
        self.assertEqual([message.name for message, _ in callbacks if message.type == "tool"], ["lookup_flight", "book_flight"])


if __name__ == "__main__":
    unittest.main()
