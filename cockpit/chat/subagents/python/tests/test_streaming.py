"""Real compiled specialist graph; deterministic providers and no remote sockets."""
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
from providers import AuthoredClient, TITLE, model_factory


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, texts=("delegate sequential",), *, title=None, fail=False, child_failure=False):
        client = AuthoredClient(title=title, fail=fail)
        events, roots = [], []
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network, patch("langchain_openai.ChatOpenAI", model_factory), patch("langgraph_sdk.get_client", return_value=client), redirect_stdout(io.StringIO()) as diagnostics:
            path = Path(__file__).parents[1] / "src/graph.py"
            spec = importlib.util.spec_from_file_location("authored_subagents_graph", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_subagents_graph().builder.compile(checkpointer=InMemorySaver())
            config = {"configurable": {"thread_id": "authored-thread"}}
            async def turn(text, index):
                async for ns, kind, event in graph.astream({"messages": [HumanMessage(content=text, id="human-" + str(index))]}, config, stream_mode=["messages", "values", "custom"], subgraphs=True):
                    events.append((ns, kind, event))
            for index, text in enumerate(texts):
                if child_failure:
                    with self.assertRaisesRegex(RuntimeError, "PRIVATE_CHILD_DIAGNOSTIC"):
                        await turn(text, index)
                else:
                    await turn(text, index)
                    saved = graph.get_state(config)
                    self.assertFalse(saved.next)
                    self.assertFalse(saved.tasks)
                    messages = saved.values["messages"]
                    calls = {c["id"]: (i, c) for i, m in enumerate(messages) if m.type == "ai" for c in m.tool_calls}
                    results = [(i, m) for i, m in enumerate(messages) if m.type == "tool"]
                    self.assertEqual(len(calls), len(results))
                    for i, result in results:
                        owner, call = calls[result.tool_call_id]
                        self.assertLess(owner, i)
                        self.assertEqual(call["name"], result.name)
                    self.assertEqual(messages[-1].type, "ai")
                    self.assertTrue(messages[-1].content)
                    roots.append(messages)
            network.assert_not_called()
        return events, roots, client, diagnostics.getvalue()

    async def test_absent_title_has_no_title_message_callbacks(self):
        events, _, client, _ = await self.scenario()
        self.assertEqual(client.threads.updates, [("authored-thread", {"title": TITLE})])
        self.assertEqual([e for _, kind, e in events if kind == "messages" and e[1].get("langgraph_node") == "generate_title"], [])

    async def test_existing_title_skips_generation(self):
        _, _, client, _ = await self.scenario(title="Existing")
        self.assertFalse(client.threads.updates)

    async def test_metadata_failure_preserves_graph_answer(self):
        _, roots, _, diagnostics = await self.scenario(fail=True)
        self.assertEqual(len(roots[-1]), 8)
        self.assertIn("Authored metadata read failure", diagnostics)

    async def test_sequential_and_parallel_have_three_real_child_namespaces(self):
        for mode, length in [("sequential", 8), ("parallel", 6)]:
            events, roots, _, _ = await self.scenario(("delegate " + mode,), title="Existing")
            children = {ns for ns, _, _ in events if ns}
            self.assertEqual(len(children), 3)
            self.assertEqual(len(roots[-1]), length)
            bindings = [e for _, kind, e in events if kind == "custom"]
            self.assertEqual(len(bindings), 3)
            self.assertTrue(all(e["type"] == "threadplane.subagent_binding" for e in bindings))
            for ns, kind, event in events:
                if ns and kind == "messages":
                    self.assertFalse(getattr(event[0], "tool_calls", []))

    async def test_direct_answer_has_no_child_or_task(self):
        events, roots, _, _ = await self.scenario(("direct answer",), title="Existing")
        self.assertFalse([ns for ns, _, _ in events if ns])
        self.assertEqual([m.type for m in roots[-1]], ["human", "ai"])

    async def test_repeated_identical_tasks_have_distinct_namespaces(self):
        events, roots, _, _ = await self.scenario(("repeated task",), title="Existing")
        self.assertEqual(len({ns for ns, _, _ in events if ns}), 2)
        calls = roots[-1][1].tool_calls
        self.assertEqual(calls[0]["args"], calls[1]["args"])
        self.assertNotEqual(calls[0]["id"], calls[1]["id"])

    async def test_empty_child_remains_literal_root_result(self):
        events, roots, _, _ = await self.scenario(("empty-child",), title="Existing")
        results = [m.content for m in roots[-1] if m.type == "tool"]
        self.assertIn("(no subagent output)", results)
        self.assertEqual(len({ns for ns, _, _ in events if ns}), 3)

    async def test_child_failure_preserves_partial_observation(self):
        events, _, _, _ = await self.scenario(("fail-child",), title="Existing", child_failure=True)
        self.assertTrue(any(ns and kind == "messages" and event[0].content == "Authored partial child" for ns, kind, event in events))

    async def test_followup_preserves_canonical_root_prefix(self):
        _, roots, _, _ = await self.scenario(("first plan", "second plan"), title="Existing")
        self.assertEqual(len(roots[0]), 8)
        self.assertEqual(len(roots[1]), 16)
        self.assertEqual([m.model_dump() for m in roots[0]], [m.model_dump() for m in roots[1][:8]])

    async def test_malformed_task_is_literal_tool_validation_error(self):
        _, roots, _, _ = await self.scenario(("malformed task",), title="Existing")
        result = next(m for m in roots[-1] if m.type == "tool")
        self.assertEqual(result.status, "error")
        self.assertIn("Error invoking tool", result.content)


if __name__ == "__main__":
    unittest.main()
