"""Real graph callbacks and independent saved threads, without remote sockets."""
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
from providers import AuthoredClient, TITLE, answer_for, model_factory


class ThreadsStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stream_failure_keeps_partial_callbacks_and_pending_checkpoint(self):
        client = AuthoredClient()
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network, patch("langchain_openai.ChatOpenAI", model_factory), patch("langgraph_sdk.get_client", return_value=client):
            spec = importlib.util.spec_from_file_location("authored_threads_failure", Path(__file__).parents[1] / "src/graph.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_threads_graph().builder.compile(checkpointer=InMemorySaver())
            config = {"configurable": {"thread_id": "failure"}}
            chunks = []
            with self.assertRaisesRegex(RuntimeError, "Authored stream failure"):
                async for kind, event in graph.astream({"messages": [HumanMessage(content="fail-stream", id="failure-human")]}, config, stream_mode=["messages", "values"]):
                    if kind == "messages":
                        chunks.append(event[0].content)
            self.assertTrue("".join(chunks))
            saved = graph.get_state(config)
            self.assertEqual(saved.next, ("generate",))
            self.assertEqual([m.type for m in saved.values["messages"]], ["human"])
            self.assertEqual(client.threads.updates, [])
            network.assert_not_called()

    async def scenario(self, turns=(("a", "human-a", "Show the code fence"),), **kwargs):
        client = AuthoredClient(**kwargs)
        snapshots, histories, callbacks = [], {}, []
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network, patch("langchain_openai.ChatOpenAI", model_factory), patch("langgraph_sdk.get_client", return_value=client), redirect_stdout(io.StringIO()) as diagnostics:
            spec = importlib.util.spec_from_file_location("authored_threads_graph", Path(__file__).parents[1] / "src/graph.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_threads_graph().builder.compile(checkpointer=InMemorySaver())
            for thread_id, human_id, text in turns:
                config = {"configurable": {"thread_id": thread_id}}
                human = HumanMessage(content=text, id=human_id)
                previous = histories.get(thread_id, [])
                current = []
                async for kind, event in graph.astream({"messages": [human]}, config, stream_mode=["messages", "values"]):
                    if kind == "messages":
                        current.append(event)
                callbacks.extend(current)
                saved = graph.get_state(config)
                messages = saved.values["messages"]
                self.assertFalse(saved.next)
                self.assertFalse(saved.tasks)
                self.assertEqual(saved.config["configurable"]["thread_id"], thread_id)
                self.assertEqual(saved.config["configurable"]["checkpoint_ns"], "")
                self.assertTrue(saved.config["configurable"]["checkpoint_id"])
                self.assertEqual([m.model_dump() for m in messages[:-2]], previous)
                self.assertEqual([m.type for m in messages[-2:]], ["human", "ai"])
                self.assertEqual(messages[-2].id, human_id)
                self.assertEqual(messages[-2].content, text)
                expected = answer_for([human])
                self.assertEqual(messages[-1].id, expected.id)
                self.assertEqual(messages[-1].content, expected.content)
                chunks = [m for m, meta in current if meta["langgraph_node"] == "generate"]
                self.assertEqual("".join(m.content for m in chunks), expected.content)
                self.assertEqual({m.id for m in chunks}, {expected.id})
                self.assertGreater(len(chunks), 3)
                histories[thread_id] = [m.model_dump() for m in messages]
                snapshots.append((thread_id, histories[thread_id]))
            for thread_id, history in histories.items():
                self.assertEqual([m.model_dump() for m in graph.get_state({"configurable": {"thread_id": thread_id}}).values["messages"]], history)
            network.assert_not_called()
        self.assertEqual([m.content for m, meta in callbacks if meta["langgraph_node"] == "generate_title"], [])
        return snapshots, client, diagnostics.getvalue()

    async def test_absent_title_is_metadata_only(self):
        _, client, _ = await self.scenario()
        self.assertEqual(client.threads.updates, [("a", {"title": TITLE})])

    async def test_existing_title_skips_generation(self):
        _, client, _ = await self.scenario(titles={"a": "Existing"})
        self.assertEqual(client.threads.updates, [])
        self.assertEqual(client.threads.titles["a"], "Existing")

    async def test_metadata_read_failure_preserves_answer(self):
        _, client, diagnostic = await self.scenario(fail_read=True)
        self.assertEqual(client.threads.updates, [])
        self.assertIn("Authored metadata read failure", diagnostic)

    async def test_metadata_write_failure_preserves_answer(self):
        _, client, diagnostic = await self.scenario(fail_write=True)
        self.assertEqual(client.threads.updates, [])
        self.assertIn("Authored metadata write failure", diagnostic)

    async def test_action_like_text_does_not_generate_title(self):
        _, client, _ = await self.scenario((("a", "human-action", ' {"action":"test"}'),))
        self.assertEqual(client.threads.updates, [])

    async def test_threads_have_independent_metadata_and_saved_messages(self):
        snapshots, client, _ = await self.scenario((("a", "a1", "Same text"), ("b", "b1", "Same text"), ("a", "a2", "Follow up")))
        self.assertEqual([len(messages) for _, messages in snapshots], [2, 2, 4])
        self.assertEqual(client.threads.updates, [("a", {"title": TITLE}), ("b", {"title": TITLE})])
        self.assertEqual(client.threads.reads, ["a", "b", "a"])
        self.assertNotEqual(snapshots[0][1][-1]["id"], snapshots[1][1][-1]["id"])

    async def test_followup_keeps_prefix_and_unique_answer_identity(self):
        snapshots, client, _ = await self.scenario((("a", "a1", "Same text"), ("a", "a2", "Same text")))
        self.assertEqual(snapshots[1][1][:2], snapshots[0][1])
        self.assertEqual(len({m["id"] for m in snapshots[1][1]}), 4)
        self.assertEqual(client.threads.updates, [("a", {"title": TITLE})])


if __name__ == "__main__":
    unittest.main()
