"""Real compiled graph, deterministic model streams, tools and checkpoints."""
import importlib.util
import io
import json
import os
import socket
import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver

LAYOUT = {"elements": {"root": {"type": "Stack", "children": ["metric"]},
                       "metric": {"type": "Metric", "props": {"label": "Flights"}}}, "root": "root"}


def call(name, args=None, identity=None):
    return {"name": name, "args": args or {}, "id": identity or name, "type": "tool_call"}


class LocalModel(BaseChatModel):
    responses: list[AIMessage] = []
    cursor: int = 0
    fail: bool = False

    @property
    def _llm_type(self):
        return "local-dashboard"

    def bind_tools(self, tools, **kwargs):
        return self

    def answer(self):
        if self.fail:
            raise RuntimeError("Local title failure")
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
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", tool_call_chunks=[
                {"index": index, "id": tc["id"], "name": tc["name"], "args": args[:3]}]))
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", tool_call_chunks=[
                {"index": index, "id": None, "name": None, "args": args[3:]}]))
        yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content="", chunk_position="last"))


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    def setup_graph(self, *, fail_title=False, fail_read=False, fail_write=False):
        network = self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(network.assert_not_called)
        self.diagnostics = self.enterContext(redirect_stdout(io.StringIO()))
        self.threads = SimpleNamespace(
            get=AsyncMock(return_value={"metadata": {}}, side_effect=RuntimeError("Metadata read failure") if fail_read else None),
            update=AsyncMock(side_effect=RuntimeError("Metadata write failure") if fail_write else None))
        self.enterContext(patch("langgraph_sdk.get_client", return_value=SimpleNamespace(threads=self.threads)))
        self.agent_model = LocalModel()
        self.respond_model = LocalModel()
        self.enterContext(patch("langchain_openai.ChatOpenAI", side_effect=lambda **kw:
            (self.agent_model if kw["model"] == "gpt-5" else self.respond_model) if kw.get("streaming") else
            LocalModel(responses=[AIMessage(id="title", content="Local dashboard title")], tags=kw.get("tags", []), fail=fail_title)))
        spec = importlib.util.spec_from_file_location("local_dashboard", Path(__file__).parents[1] / "src/graph.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.graph = self.module.graph.builder.compile(checkpointer=InMemorySaver())
        self.config = {"configurable": {"thread_id": "dashboard"}}

    async def send(self, identity, batches=(), *, prose="", answer_id=None, messages=None, copy_events=True):
        self.agent_model.responses = [AIMessage(id=f"{identity}-agent-{i}", content=prose if i == 0 else "", tool_calls=batch)
                                      for i, batch in enumerate(batches)] + [AIMessage(id=f"{identity}-done", content="Ready.")]
        self.agent_model.cursor = 0
        self.respond_model.responses = [AIMessage(id=answer_id if answer_id is not None else f"{identity}-answer", content="Dashboard updated.")]
        self.respond_model.cursor = 0
        events = [(deepcopy(event) if copy_events else event) async for event in self.graph.astream(
            {"messages": messages or [HumanMessage(id=identity, content=identity)]}, self.config,
            stream_mode=["messages", "values", "updates", "custom", "checkpoints"])]
        saved = await self.graph.aget_state(self.config)
        self.assertFalse(saved.next)
        self.assertFalse(saved.tasks)
        values = [event for kind, event in events if kind == "values"]
        self.assertEqual(values[-1], saved.values)
        self.assertTrue([event for kind, event in events if kind == "checkpoints"])
        return saved, events

    def assert_completion(self, saved, identity):
        ids = [m.id for m in saved.values["messages"]]
        self.assertEqual(saved.values.get("completed_turn_id"), identity)
        self.assertEqual(saved.values.get("completed_answer_id"), ids[-1])
        self.assertEqual(saved.values.get("completed_message_ids"), ids)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertNotIn("run_id", saved.values)

    def patches(self, events):
        return [event["data"] for kind, event in events if kind == "custom" and event["name"] == "state_update"]

    async def test_initial_dashboard_persists_and_wrap_keeps_correlated_identity(self):
        self.setup_graph()
        batch = [call("render_spec", LAYOUT), *[call(t.name) for t in self.module._DATA_TOOLS]]
        saved, events = await self.send("initial", [batch])
        self.assertIn("dashboard", saved.values)
        self.assertEqual(saved.values["dashboard"]["on_time"]["value"], "84.2%")
        self.assertEqual(len(saved.values["dashboard"]["on_time_trend"]), 12)
        self.assertEqual(len(saved.values["dashboard"]["flights_by_airline"]), 4)
        self.assertEqual(len(saved.values["dashboard"]["recent_disruptions"]), 5)
        self.assert_completion(saved, "initial")
        observations = [v["messages"] for kind, v in events if kind == "values"]
        before = next(ms for ms in observations if any(m.type == "tool" and m.name == "render_spec" for m in ms))
        after = next(ms for ms in observations if any(m.type == "tool" and m.name == "render_spec" and m.content == "rendered" for m in ms))
        self.assertEqual([m.id for m in before], [m.id for m in after])
        raw = next(m for m in before if m.type == "tool" and m.name == "render_spec")
        parent = next(m for m in before if m.id == "initial-agent-0")
        rewritten = next(m for m in after if m.id == parent.id)
        self.assertEqual(parent.content, "")
        self.assertEqual(rewritten.content, raw.content)
        self.assertEqual(json.loads(raw.content), LAYOUT)
        self.assertEqual(rewritten.tool_calls, parent.tool_calls)
        rendered = next(m for m in after if m.id == raw.id)
        self.assertEqual((rendered.name, rendered.tool_call_id, rendered.status, rendered.content),
                         (raw.name, raw.tool_call_id, raw.status, "rendered"))
        for old, new in zip(before, after):
            if old.id not in (parent.id, raw.id):
                self.assertEqual(old, new)
        self.assertEqual(self.patches(events)[0]["/on_time/value"], "84.2%")
        terminal = [event for kind, event in events if kind == "checkpoints"][-1]
        self.assertEqual(terminal["values"], saved.values)
        self.assertFalse(terminal["next"])
        self.assertFalse(terminal["tasks"])
        callbacks = [event for kind, event in events if kind == "messages"]
        self.assertFalse([event for event in callbacks if event[1]["langgraph_node"] == "wrap_spec_into_ai"])
        self.assertTrue(any(chunk.get("name") is None and chunk.get("args") for message, _ in callbacks
                            for chunk in getattr(message, "tool_call_chunks", [])))

    async def test_same_tool_latest_result_wins_in_custom_patch(self):
        self.setup_graph()
        saved, events = await self.send("repeat", [[call("query_recent_disruptions", {"limit": 5}, "first")],
            [call("query_recent_disruptions", {"type": "cancelled"}, "last")]])
        result = self.patches(events)[0]["/recent_disruptions"]
        self.assertEqual([r["type"] for r in result], ["cancelled"] * 3)
        self.assertEqual(saved.values["dashboard"]["recent_disruptions"], result)

    async def test_followups_preserve_slots_and_prior_messages(self):
        self.setup_graph()
        initial, _ = await self.send("initial", [[call("render_spec", LAYOUT), call("query_airline_kpis"), call("query_recent_disruptions")]])
        filtered, events = await self.send("filter", [[call("query_recent_disruptions", {"type": "cancelled"})]])
        self.assertEqual(filtered.values.get("dashboard", {}).get("on_time"), {"value": "84.2%", "delta": "+1.4%"})
        self.assertEqual(filtered.values["messages"][:len(initial.values["messages"])], initial.values["messages"])
        self.assertEqual(len(self.patches(events)[0]), 1)
        layout = {"elements": {"new": {"type": "Stack"}}, "root": "new"}
        structural, _ = await self.send("structure", [[call("render_spec", layout)]])
        self.assertEqual(structural.values["dashboard"], filtered.values["dashboard"])
        self.assertEqual(json.loads(next(m.content for m in structural.values["messages"] if m.id == "structure-agent-0")), layout)
        prose, events = await self.send("prose")
        self.assertEqual(prose.values["dashboard"], filtered.values["dashboard"])
        self.assertEqual(self.patches(events), [])
        self.assert_completion(prose, "prose")
        self.assertEqual((await self.graph.aget_state(initial.config)).values, initial.values)

    async def test_nonempty_render_parent_remains_prose_and_raw_result(self):
        self.setup_graph()
        saved, _ = await self.send("prose-render", [[call("render_spec", LAYOUT)]], prose="Here is the layout.")
        self.assertEqual(saved.values["messages"][1].content, "Here is the layout.")
        raw = next(m for m in saved.values["messages"] if m.type == "tool")
        self.assertEqual(json.loads(raw.content), LAYOUT)

    async def test_repeated_rendering_preserves_each_pair(self):
        self.setup_graph()
        saved, _ = await self.send("layouts", [[call("render_spec", LAYOUT, "render-one")], [call("render_spec", LAYOUT, "render-two")]])
        parents = [m for m in saved.values["messages"] if m.type == "ai" and m.tool_calls]
        self.assertEqual(len(parents), 2)
        self.assertTrue(all(json.loads(m.content) == LAYOUT for m in parents))
        self.assertEqual([m.content for m in saved.values["messages"] if m.type == "tool"], ["rendered", "rendered"])

    async def test_iteration_cap_remains_bounded(self):
        self.setup_graph()
        saved, events = await self.send("cap", [[call("query_on_time_trend", {"months": 3}, f"call-{i}")] for i in range(8)])
        self.assertEqual(self.agent_model.cursor, self.module._MAX_TOOL_ITERATIONS)
        self.assertEqual(len([m for m in saved.values["messages"] if m.type == "tool"]), self.module._MAX_TOOL_ITERATIONS - 1)
        self.assertTrue(any(kind == "updates" and "finalize" in e for kind, e in events))
        self.assert_completion(saved, "cap")

    async def test_title_never_streams_and_failures_are_nonblocking(self):
        for failure in ({}, {"fail_title": True}, {"fail_read": True}, {"fail_write": True}):
            with self.subTest(failure=failure):
                self.setup_graph(**failure)
                saved, events = await self.send("title-test")
                callbacks = [e for k, e in events if k == "messages"]
                self.assertFalse([e for e in callbacks if e[1]["langgraph_node"] == "generate_title"])
                self.assert_completion(saved, "title-test")
                self.assertGreater(len([e for e in callbacks if e[1]["langgraph_node"] == "respond"]), 1)
                if not failure:
                    self.threads.update.assert_awaited_once_with("dashboard", metadata={"title": "Local dashboard title"})
                else:
                    self.assertIn("failed for thread dashboard", self.diagnostics.getvalue())

    async def test_invalid_final_identity_does_not_publish_completion(self):
        for answer_id in ("", "human", "human-done", "old-answer"):
            with self.subTest(answer_id=answer_id):
                self.setup_graph()
                # Chunk concatenation normalizes an empty ID to None, after which
                # BaseChatModel supplies an ID. Nonstreaming retains the invalid ID.
                self.respond_model.disable_streaming = answer_id == ""
                saved, _ = await self.send("human", answer_id=answer_id, messages=[
                    HumanMessage(id="old-human", content="old"), AIMessage(id="old-answer", content="old"), HumanMessage(id="human", content="new")])
                self.assertFalse(saved.values.get("completed_turn_id"))

    async def test_trailing_assistant_does_not_fabricate_completion(self):
        self.setup_graph()
        saved, _ = await self.send("new", messages=[HumanMessage(id="old-human", content="old"), AIMessage(id="old-answer", content="answered")])
        self.assertFalse(saved.values.get("completed_turn_id"))

    async def test_new_failed_turn_clears_stale_completion(self):
        self.setup_graph()
        confirmed, _ = await self.send("confirmed")
        self.assert_completion(confirmed, "confirmed")
        self.agent_model.fail = True
        with self.assertRaisesRegex(RuntimeError, "Local title failure"):
            await self.send("failed")
        saved = await self.graph.aget_state(self.config)
        self.assertEqual(saved.next, ("agent",))
        self.assertIsNone(saved.values["completed_turn_id"])
        self.assertIsNone(saved.values["completed_answer_id"])
        self.assertIsNone(saved.values["completed_message_ids"])
        self.assertEqual((await self.graph.aget_state(confirmed.config)).values, confirmed.values)

    async def test_prior_turn_results_are_not_replayed(self):
        self.setup_graph()
        saved, events = await self.send("new", messages=[HumanMessage(id="prior", content="old"),
            ToolMessage(id="old-result", name="query_airline_kpis", tool_call_id="old-call",
                        content='{"on_time":{"value":"999%","delta":"old"}}'), HumanMessage(id="new", content="new")])
        self.assertEqual(saved.values["dashboard"], {})
        self.assertEqual(self.patches(events), [])

    async def test_malformed_error_and_unknown_current_results_are_ignored(self):
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import ToolNode
        for name, content, status in [
                       ("query_airline_kpis", "[]", "success"), ("query_airline_kpis", "null", "success"),
                       ("query_airline_kpis", "not-json", "success"), ("query_airline_kpis", '{"error":"failed"}', "success"),
                       ("query_airline_kpis", '{"on_time":{"value":"999%","delta":"bad"}}', "error"),
                       ("query_on_time_trend", '{"error":"failed"}', "success"),
                       ("query_recent_disruptions", '"bad"', "success"), ("query_flights_by_airline", "[1]", "success"),
                       ("query_on_time_trend", '[{"month":"now","on_time_pct":NaN}]', "success"),
                       ("query_on_time_trend", json.dumps([{"month": "now", "on_time_pct": 10**400}]), "success"),
                       ("query_airline_kpis", '{"foreign":{"value":1,"delta":"x"}}', "success"),
                       ("unknown", '{"on_time":{"value":"999%"}}', "success")]:
            with self.subTest(name=name, content=content, status=status):
                self.setup_graph()
                def result():
                    return ToolMessage(name=name, tool_call_id=name, content=content, status=status)
                controlled = StructuredTool.from_function(result, name=name, description="Controlled observation")
                self.module.graph.builder.nodes["tools"].runnable = ToolNode([controlled])
                self.graph = self.module.graph.builder.compile(checkpointer=InMemorySaver())
                saved, events = await self.send("bad", [[call(name)]])
                self.assertEqual(saved.values["dashboard"], {})
                self.assertEqual(self.patches(events), [])

    async def test_custom_and_persisted_data_do_not_share_mutable_references(self):
        self.setup_graph()
        saved, events = await self.send("owned", [[call("query_recent_disruptions")]], copy_events=False)
        original = deepcopy(saved.values["dashboard"])
        self.patches(events)[0]["/recent_disruptions"][0]["type"] = "mutated"
        self.assertEqual(saved.values["dashboard"], original)
        terminal = [event for kind, event in events if kind == "values"][-1]
        self.assertEqual(terminal["dashboard"], original)
        saved.values["dashboard"]["recent_disruptions"][0]["type"] = "mutated"
        self.assertEqual((await self.graph.aget_state(self.config)).values["dashboard"], original)

    async def test_parallel_same_tool_results_follow_transcript_order(self):
        self.setup_graph()
        saved, events = await self.send("parallel", [[call("query_recent_disruptions", {"type": "delayed"}, "one"),
                                                      call("query_recent_disruptions", {"type": "cancelled"}, "two")]])
        self.assertEqual([row["type"] for row in saved.values["dashboard"]["recent_disruptions"]], ["cancelled"] * 3)
        self.assertEqual(self.patches(events)[0]["/recent_disruptions"], saved.values["dashboard"]["recent_disruptions"])

    async def test_newest_kpi_sections_preserve_other_prior_slots(self):
        self.setup_graph()
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import ToolNode
        outputs = iter([{"on_time": {"value": "10%", "delta": "old"}, "flights_today": {"value": 312, "delta": "+8"}},
                        {"on_time": {"value": "90%", "delta": "new"}}])
        def result():
            return next(outputs)
        controlled = StructuredTool.from_function(result, name="query_airline_kpis", description="Controlled KPI observation")
        self.module.graph.builder.nodes["tools"].runnable = ToolNode([controlled])
        self.graph = self.module.graph.builder.compile(checkpointer=InMemorySaver())
        saved, events = await self.send("kpis", [[call("query_airline_kpis", identity="first")], [call("query_airline_kpis", identity="last")]])
        self.assertEqual(saved.values["dashboard"], {"on_time": {"value": "90%", "delta": "new"}, "flights_today": {"value": 312, "delta": "+8"}})
        self.assertEqual(self.patches(events), [{"/on_time/value": "90%", "/on_time/delta": "new", "/flights_today/value": 312, "/flights_today/delta": "+8"}])


if __name__ == "__main__":
    unittest.main()
