"""Local InMemorySaver proof of the actual Debug graph, not SDK/server IO."""

from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib.util
import os
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

# Set before importing LangChain, LangGraph, providers, or the production module.
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langchain_core.messages import AIMessageChunk, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from providers import TITLE, AuthoredClient, AuthoredProvider

SOURCE = Path(__file__).resolve().parents[1] / "src" / "graph.py"
THREAD = "authored-debug-thread"


class DebugStreamingTests(unittest.IsolatedAsyncioTestCase):
    @contextmanager
    def session(self, **kwargs):
        provider = AuthoredProvider()
        client = AuthoredClient(**kwargs)
        attempts = []

        def reject_network(*args, **kwargs):
            attempts.append("network attempt")
            raise AssertionError("Debug graph tests must never use network IO")

        with ExitStack() as stack:
            for owner, name in (
                (socket.socket, "connect"), (socket.socket, "connect_ex"),
                (socket, "getaddrinfo"), (socket, "gethostbyname"),
                (socket, "gethostbyname_ex"),
            ):
                stack.enter_context(patch.object(owner, name, reject_network))
            stack.enter_context(patch("langchain_openai.ChatOpenAI", provider.model_factory))
            stack.enter_context(patch("langgraph_sdk.get_client", return_value=client))
            try:
                spec = importlib.util.spec_from_file_location("authored_debug_graph", SOURCE)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                # Use the production builder and actual reducers/nodes/order.
                graph = module.build_debug_graph().builder.compile(checkpointer=InMemorySaver())
                yield graph, provider, client
            finally:
                # The title node swallows exceptions, so a successful run alone
                # cannot demonstrate that no connection was attempted.
                self.assertEqual(attempts, [], "A network attempt was caught, possibly swallowed")

    async def observe_turn(self, graph, provider, turn):
        config = {"configurable": {"thread_id": THREAD}}
        calls_before = len(provider.calls)
        prior = deepcopy(graph.get_state(config).values.get("messages", []))
        callbacks, values, updates = [], [], []
        human = HumanMessage(content=f"Explain aviation topic {turn}", id=f"authored-human-{turn}")
        async for mode, value in graph.astream(
            {"messages": [human]}, config, stream_mode=["messages", "values", "updates"],
        ):
            if mode == "messages":
                callbacks.append(value)
            elif mode == "values":
                values.append(deepcopy(value))
            elif mode == "updates":
                updates.append(deepcopy(value))
        state = graph.get_state(config)
        calls = provider.calls[calls_before:]
        self.assertEqual([call.node for call in calls if call.node != "generate_title"],
                         ["generate", "summarize"])
        answer, summary = [call for call in calls if call.node != "generate_title"]
        messages = state.values["messages"]
        self.assertEqual(messages[:len(prior)], prior)
        current = messages[len(prior):]
        self.assertEqual(len(current), 4)
        self.assertEqual([m.type for m in current], ["human", "ai", "ai", "ai"])
        self.assertEqual(current[0], human)
        self.assertEqual((current[1].id, current[1].content), (answer.id, answer.content))
        self.assertEqual((current[3].id, current[3].content), (summary.id, summary.content))
        self.assertTrue(all(m.id for m in messages))
        self.assertEqual(len({m.id for m in messages}), len(messages))
        analysis = {"characters": len(answer.content), "words": answer.content.count(" ") + 1}
        self.assertEqual(state.values["analysis"], analysis)
        self.assertEqual(current[2].content,
                         f"[Processing] Analyzed {analysis['characters']} characters. "
                         f"Found {analysis['words']} words. Processing complete.")
        self.assertEqual(state.next, ())
        self.assertEqual(values[-1], state.values)
        self.assertEqual([next(iter(update)) for update in updates],
                         ["generate", "process", "summarize", "generate_title"])
        self.assertEqual(updates[-1], {"generate_title": None})
        # Process returns a finalized AIMessage; assert its real assigned ID,
        # without imposing a model chunk or terminal-marker contract on it.
        process = [m for m, meta in callbacks if meta["langgraph_node"] == "process"]
        self.assertEqual([(m.id, m.content) for m in process], [(current[2].id, current[2].content)])
        self.assertEqual(updates[1]["process"]["messages"][0].content, current[2].content)
        for call in (answer, summary):
            chunks = [m for m, meta in callbacks if meta["langgraph_node"] == call.node]
            self.assertGreater(len(chunks), 3)
            self.assertTrue(all(isinstance(m, AIMessageChunk) for m in chunks))
            self.assertEqual("".join(m.content for m in chunks), call.content)
            self.assertEqual({m.id for m in chunks}, {call.id})
            self.assertEqual([m.content for m in chunks[:-1]],
                             [call.content[i:i + 3] for i in range(0, len(call.content), 3)])
            self.assertEqual(chunks[-1].chunk_position, "last")
            self.assertEqual(chunks[-1].content, "")
            self.assertEqual(chunks[-1].response_metadata["finish_reason"], "stop")
        # No title messages may enter either callbacks or any observed state.
        self.assertEqual([m for m, meta in callbacks if meta["langgraph_node"] == "generate_title"], [])
        self.assertEqual({meta["langgraph_node"] for _, meta in callbacks},
                         {"generate", "process", "summarize"})
        for observed in values + [state.values]:
            self.assertFalse(any(m.content == TITLE or m.id.startswith("authored-generate_title-")
                                 for m in observed["messages"]))
        for update in updates:
            for node_values in update.values():
                self.assertFalse(any(m.content == TITLE for m in (node_values or {}).get("messages", [])))
        return state

    async def test_absent_title_is_metadata_only(self):
        with self.session() as (graph, provider, client):
            await self.observe_turn(graph, provider, 1)
            self.assertEqual([c.node for c in provider.calls], ["generate", "summarize", "generate_title"])
            self.assertEqual(client.threads.reads, [THREAD])
            self.assertEqual(client.threads.updates, [(THREAD, {"title": TITLE})])
            self.assertEqual(client.threads.title, TITLE)

    async def test_existing_title_skips_model_and_preserves_metadata(self):
        with self.session(title="Existing debug title") as (graph, provider, client):
            await self.observe_turn(graph, provider, 1)
            self.assertEqual([c.node for c in provider.calls], ["generate", "summarize"])
            self.assertEqual(client.threads.reads, [THREAD])
            self.assertEqual(client.threads.updates, [])
            self.assertEqual(client.threads.title, "Existing debug title")

    async def test_metadata_read_failure_keeps_three_assistant_pipeline(self):
        with self.session(fail_read=True) as (graph, provider, client):
            await self.observe_turn(graph, provider, 1)
            self.assertEqual([c.node for c in provider.calls], ["generate", "summarize"])
            self.assertEqual(client.threads.reads, [THREAD])
            self.assertEqual(client.threads.updates, [])
            self.assertIsNone(client.threads.title)

    async def test_metadata_update_failure_keeps_three_assistant_pipeline(self):
        with self.session(fail_update=True) as (graph, provider, client):
            await self.observe_turn(graph, provider, 1)
            self.assertEqual([c.node for c in provider.calls], ["generate", "summarize", "generate_title"])
            self.assertEqual(client.threads.reads, [THREAD])
            self.assertEqual(client.threads.updates, [(THREAD, {"title": TITLE})])
            self.assertIsNone(client.threads.title)

    async def test_repeat_turn_preserves_prefix_and_exact_prior_checkpoint(self):
        with self.session() as (graph, provider, client):
            first = await self.observe_turn(graph, provider, 1)
            first_config = deepcopy(first.config)
            first_values = deepcopy(first.values)
            self.assertTrue(first_config["configurable"]["checkpoint_id"])
            second = await self.observe_turn(graph, provider, 2)
            self.assertEqual(len(second.values["messages"]), 8)
            self.assertEqual(second.values["messages"][:4], first_values["messages"])
            self.assertNotEqual(first_config["configurable"]["checkpoint_id"],
                                second.config["configurable"]["checkpoint_id"])
            old = graph.get_state(first_config)
            self.assertEqual(old.config, first_config)
            self.assertEqual(old.values, first_values)
            self.assertEqual(old.next, ())
            self.assertEqual([c.node for c in provider.calls],
                             ["generate", "summarize", "generate_title", "generate", "summarize"])
            self.assertEqual(client.threads.reads, [THREAD, THREAD])
            self.assertEqual(client.threads.updates, [(THREAD, {"title": TITLE})])
            self.assertEqual(client.threads.title, TITLE)


if __name__ == "__main__":
    unittest.main()
