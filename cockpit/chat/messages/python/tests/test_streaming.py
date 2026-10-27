"""Exercise real compiled graph callbacks and saved state without network IO."""

import importlib.util
import os
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from providers import ANSWER, TITLE, AuthoredClient, model_factory

SOURCE = Path(__file__).resolve().parents[1] / "src" / "graph.py"


class MessagesStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def observe(self, **kwargs):
        client = AuthoredClient(**kwargs)
        with patch.object(socket.socket, "connect", side_effect=AssertionError(
            "Graph tests must never connect to a remote service"
        )) as connect, patch("langchain_openai.ChatOpenAI", model_factory), patch(
            "langgraph_sdk.get_client", return_value=client,
        ):
            spec = importlib.util.spec_from_file_location("authored_messages_graph", SOURCE)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_messages_graph().builder.compile(checkpointer=InMemorySaver())
            config = {"configurable": {"thread_id": "authored-thread"}}
            callbacks = []
            async for event, value in graph.astream(
                {"messages": [HumanMessage(content="Show the code fence", id="authored-human")]},
                config, stream_mode=["messages", "values"],
            ):
                if event == "messages":
                    callbacks.append(value)
            state = graph.get_state(config)
            connect.assert_not_called()
        self.assertEqual([m.id for m in state.values["messages"]], ["authored-human", "authored-answer"])
        self.assertEqual(state.values["messages"][-1].content, ANSWER)
        self.assertEqual(state.next, ())
        answer_chunks = [m.content for m, meta in callbacks if meta["langgraph_node"] == "generate"]
        self.assertEqual("".join(answer_chunks), ANSWER)
        self.assertGreater(len(answer_chunks), 3)
        self.assertEqual({m.id for m, meta in callbacks if meta["langgraph_node"] == "generate"}, {"authored-answer"})
        self.assertTrue(all(len(chunk) <= 3 for chunk in answer_chunks))
        self.assertEqual([m.content for m, meta in callbacks if meta["langgraph_node"] == "generate_title"], [])
        return client

    async def test_absent_title_is_metadata_only(self):
        client = await self.observe()
        self.assertEqual(client.threads.updates, [("authored-thread", {"title": TITLE})])

    async def test_existing_title_is_preserved(self):
        client = await self.observe(title="Existing title")
        self.assertEqual(client.threads.updates, [])

    async def test_metadata_failure_does_not_block_answer(self):
        client = await self.observe(fail=True)
        self.assertEqual(client.threads.updates, [])


if __name__ == "__main__":
    unittest.main()
