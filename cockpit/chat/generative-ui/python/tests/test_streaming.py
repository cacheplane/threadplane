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



from tests.test_operations import SPEC
LAYOUT = SPEC


def decision(kind, calls=(), interpretation=""):
    return call("plan_dashboard_operation", {"kind": kind, "calls": [
        {"name": c["name"], "args": c["args"]} for c in calls], "interpretation": interpretation}, "model-decision")


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    def setup_graph(self, *, fail_title=False, fail_read=False, fail_write=False):
        network = self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(network.assert_not_called)
        self.diagnostics = self.enterContext(redirect_stdout(io.StringIO()))
        self.threads = SimpleNamespace(
            get=AsyncMock(return_value={"metadata": {}}, side_effect=RuntimeError("Metadata read failure") if fail_read else None),
            update=AsyncMock(side_effect=RuntimeError("Metadata write failure") if fail_write else None))
        self.enterContext(patch("langgraph_sdk.get_client", return_value=SimpleNamespace(threads=self.threads)))
        self.agent_model = LocalModel(tags=["nostream"])
        self.respond_model = LocalModel()
        self.enterContext(patch("langchain_openai.ChatOpenAI", side_effect=lambda **kw:
            (self.agent_model if kw["model"] == "gpt-5" else self.respond_model) if kw.get("streaming") else
            LocalModel(responses=[AIMessage(id="title", content="Local dashboard title")], tags=kw.get("tags", []), fail=fail_title)))
        spec = importlib.util.spec_from_file_location("local_dashboard", Path(__file__).parents[1] / "src/graph.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.recompile()
        self.config = {"configurable": {"thread_id": "dashboard"}}

    def recompile(self):
        self.graph = self.module.graph.builder.compile(checkpointer=InMemorySaver())

    async def send(self, identity, selected=None, *, response=None, messages=None, input_extra=None, copy_events=True):
        self.agent_model.responses = [response or AIMessage(id="historical-model-id", content="I refreshed everything.", tool_calls=[selected] if selected else [])]
        self.agent_model.cursor = 0
        self.respond_model.responses = [AIMessage(id=identity, content="Confirmed data explanation.")]
        self.respond_model.cursor = 0
        events = [(deepcopy(e) if copy_events else e) async for e in self.graph.astream(
            {"messages": messages if messages is not None else [HumanMessage(id=identity, content=identity)], **(input_extra or {})},
            self.config, stream_mode=["messages", "values", "updates", "custom", "checkpoints"])]
        saved = await self.graph.aget_state(self.config)
        self.assertFalse(saved.next)
        self.assertFalse(saved.tasks)
        self.assertEqual([e for k, e in events if k == "values"][-1], saved.values)
        self.assertTrue([e for k, e in events if k == "checkpoints"])
        return saved, events

    async def initial(self, spec=LAYOUT):
        queries = [call("query_recent_disruptions")] if spec == LAYOUT else []
        return await self.send("initial", decision("create", [call("render_spec", spec), *queries]))

    def patches(self, events):
        return [e["data"] for k, e in events if k == "custom" and e["name"] == "state_update"]

    def assert_completion(self, saved, identity):
        ids = [m.id for m in saved.values["messages"]]
        self.assertEqual(saved.values["completed_turn_id"], identity)
        self.assertEqual(saved.values["completed_answer_id"], ids[-1])
        self.assertEqual(saved.values["completed_message_ids"], ids)
        self.assertEqual(len(set(ids)), len(ids))
        self.assertTrue(ids[-1].startswith("answer-"))

    async def test_no_tool_filter_cannot_claim_refresh(self):
        self.setup_graph()
        await self.initial()
        saved, events = await self.send("Filter to only the cancelled flights.")
        self.assertNotIn("updated", saved.values["messages"][-1].content.lower())
        self.assertIn("No dashboard changes", saved.values["messages"][-1].content)
        self.assertEqual(self.patches(events), [])
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "rejected")
        self.assertEqual(len(saved.values["dashboard"]["recent_disruptions"]), 5)
        self.assertEqual(self.respond_model.cursor, 0)

    async def test_cancelled_decision_executes_once_and_receipt_matches(self):
        self.setup_graph()
        initial, _ = await self.initial()
        saved, events = await self.send("filter", decision("data_update", [call("query_recent_disruptions", {"type": "cancelled"})]))
        rows = saved.values["dashboard"]["recent_disruptions"]
        self.assertEqual([r["flight_number"] for r in rows], ["AA456", "UA204", "UA640"])
        self.assertEqual([r["type"] for r in rows], ["cancelled"] * 3)
        self.assertEqual(self.patches(events), [{"/recent_disruptions": rows}])
        receipt = saved.values["operation_receipt"]
        self.assertEqual(receipt["submitted_human_id"], "filter")
        self.assertEqual(receipt["outcome"], "applied")
        self.assertEqual(receipt["validated_slots"], {"recent_disruptions": rows})
        self.assertEqual(len(receipt["admitted_calls"]), 1)
        self.assertEqual(len(receipt["results"]), 1)
        self.assertEqual(receipt["admitted_calls"][0]["args"], {"type": "cancelled"})
        self.assertEqual(receipt["results"][0]["tool_call_id"], receipt["admitted_calls"][0]["id"])
        self.assertTrue(receipt["admitted_calls"][0]["id"].startswith("call-"))
        self.assertEqual(saved.values["_owned_layout"], initial.values["_owned_layout"])
        self.assertEqual(saved.values["_render_owner"], initial.values["_render_owner"])
        self.assertEqual(saved.values["messages"][:len(initial.values["messages"])], initial.values["messages"])
        self.assertIn("3 cancelled", saved.values["messages"][-1].content)
        self.assertEqual(self.respond_model.cursor, 0)
        self.assert_completion(saved, "filter")
        self.assertEqual((await self.graph.aget_state(initial.config)).values, initial.values)

    async def test_raw_rendered_wrapped_transitions_preserve_correlations(self):
        self.setup_graph()
        saved, events = await self.initial()
        observations = [v["messages"] for k, v in events if k == "values"]
        before = next(ms for ms in observations if any(isinstance(m, ToolMessage) and m.name == "render_spec" and m.content != "rendered" for m in ms))
        after = next(ms for ms in observations if any(isinstance(m, ToolMessage) and m.name == "render_spec" and m.content == "rendered" for m in ms))
        self.assertEqual([m.id for m in before], [m.id for m in after])
        raw = next(m for m in before if isinstance(m, ToolMessage) and m.name == "render_spec")
        parent = next(m for m in before if isinstance(m, AIMessage) and m.tool_calls)
        wrapped = next(m for m in after if m.id == parent.id)
        self.assertEqual(parent.content, "")
        self.assertEqual(json.loads(wrapped.content), json.loads(raw.content))
        self.assertEqual(wrapped.tool_calls, parent.tool_calls)
        rendered = next(m for m in after if m.id == raw.id)
        self.assertEqual((rendered.name, rendered.tool_call_id, rendered.status), (raw.name, raw.tool_call_id, raw.status))
        self.assertEqual(rendered.content, "rendered")
        for old, new in zip(before, after):
            if old.id not in (parent.id, raw.id):
                self.assertEqual(old, new)
        self.assertEqual(saved.values["operation_receipt"]["render_owner"],
                         {"parent_id": parent.id, "call_id": raw.tool_call_id, "result_id": raw.id})
        self.assert_completion(saved, "initial")
        self.assertFalse([e for k, e in events if k == "messages" and e[1]["langgraph_node"] in ("decide", "wrap_spec_into_ai", "generate_title")])

    async def test_absent_multiple_unknown_invalid_and_refused_decisions(self):
        variants = [
            AIMessage(content="Done."),
            AIMessage(content="", tool_calls=[decision("unsupported"), decision("unsupported")]),
            AIMessage(content="", tool_calls=[call("unknown")]),
            AIMessage(content="", invalid_tool_calls=[{"name": "plan_dashboard_operation", "args": "{", "id": "invalid", "error": "bad"}]),
            AIMessage(content="", additional_kwargs={"refusal": "No."}),
        ]
        for response in variants:
            with self.subTest(response=response):
                self.setup_graph()
                # _generate preserves invalid_tool_calls/refusal exactly; only model boundary mocked.
                with patch.object(LocalModel, "ainvoke", AsyncMock(return_value=response)):
                    saved, events = await self.send("rejected", response=response)
                self.assertEqual(saved.values["operation_receipt"]["outcome"], "rejected")
                self.assertEqual(saved.values["operation_receipt"]["admitted_calls"], [])
                self.assertFalse([m for m in saved.values["messages"] if isinstance(m, ToolMessage)])
                self.assertEqual(self.patches(events), [])

    async def test_initial_category_and_restructure_reuse_only_missing(self):
        self.setup_graph()
        rejected, _ = await self.send("wrong", decision("data_update", [call("query_recent_disruptions")]))
        self.assertEqual(rejected.values["operation_receipt"]["outcome"], "rejected")
        initial, _ = await self.initial()
        changed = deepcopy(LAYOUT)
        changed["elements"]["table"]["props"]["title"] = "Saved rows"
        saved, events = await self.send("structure", decision("restructure", [call("render_spec", changed)]))
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "applied")
        self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
        self.assertEqual(self.patches(events), [])
        rejected, _ = await self.send("duplicate-create", decision("create", [call("render_spec", changed), call("query_recent_disruptions")]))
        self.assertEqual(rejected.values["operation_receipt"]["outcome"], "rejected")

    async def test_literal_null_layout_owns_dashboard_without_data(self):
        self.setup_graph()
        literal = {"root": "metric", "elements": {"metric": {"type": "stat_card", "props": {"label": "Literal", "value": None, "delta": None}}}}
        saved, events = await self.initial(literal)
        self.assertEqual(saved.values["dashboard"], {})
        self.assertEqual(saved.values["_owned_layout"], literal)
        self.assertEqual(self.patches(events), [])
        next_saved, events = await self.send("data", decision("data_update", [call("query_recent_disruptions", {"limit": 1})]))
        self.assertEqual(next_saved.values["operation_receipt"]["outcome"], "applied")
        self.assertEqual(next_saved.values["_owned_layout"], literal)

    async def test_interpret_and_unsupported_execute_no_tools(self):
        for kind in ("interpret", "unsupported"):
            with self.subTest(kind=kind):
                self.setup_graph()
                initial, _ = await self.initial()
                saved, events = await self.send(kind, decision(kind, interpretation="Why?"))
                self.assertEqual(saved.values["operation_receipt"]["outcome"], kind)
                self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
                self.assertEqual(self.patches(events), [])
                self.assertIn("No dashboard changes", saved.values["messages"][-1].content)
                self.assertEqual(self.respond_model.cursor, 1 if kind == "interpret" else 0)
                self.assertFalse([e for k, e in events if k == "messages" and e[1]["langgraph_node"] == "respond"
                                  and e[0].id == kind])
                self.assert_completion(saved, kind)

    async def test_input_schema_excludes_injected_dashboard_receipt_and_completion(self):
        self.setup_graph()
        injected = {"dashboard": {"recent_disruptions": []}, "_owned_layout": LAYOUT,
                    "_render_owner": {"parent_id": "fake"}, "_decision": {"kind": "create"},
                    "_submitted_turn_id": "fake", "completed_turn_id": "fake",
                    "completed_message_ids": ["fake"], "operation_receipt": {"outcome": "applied"}}
        saved, _ = await self.send("real", decision("data_update", [call("query_recent_disruptions")]), input_extra=injected)
        self.assertEqual(saved.values["dashboard"], {})
        self.assertIsNone(saved.values["_owned_layout"])
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "rejected")
        self.assertEqual(saved.values["operation_receipt"]["submitted_human_id"], "real")
        self.assert_completion(saved, "real")

    async def test_prior_tools_and_prose_do_not_supply_current_operation(self):
        self.setup_graph()
        saved, events = await self.send("new", messages=[
            HumanMessage(id="old", content="old"), AIMessage(id="old-ai", content=json.dumps(LAYOUT)),
            ToolMessage(id="old-result", name="query_recent_disruptions", tool_call_id="old-call", content="[]"),
            HumanMessage(id="new", content="new")])
        self.assertEqual(saved.values["dashboard"], {})
        self.assertIsNone(saved.values["_owned_layout"])
        self.assertEqual(saved.values["operation_receipt"]["results"], [])
        self.assertEqual(self.patches(events), [])

    async def test_submitted_nonhuman_cannot_use_stale_human(self):
        self.setup_graph()
        saved, _ = await self.send("new", decision("create", [call("render_spec", {"root": "r", "elements": {"r": {"type": "container"}}})]),
                                   messages=[HumanMessage(id="old", content="old"), AIMessage(id="new", content="fake")])
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "rejected")
        self.assertIsNone(saved.values["operation_receipt"]["submitted_human_id"])
        self.assertIsNone(saved.values["completed_turn_id"])

    async def test_title_failures_are_nonblocking_and_nostream(self):
        for failure in ({}, {"fail_title": True}, {"fail_read": True}, {"fail_write": True}):
            with self.subTest(failure=failure):
                self.setup_graph(**failure)
                saved, events = await self.send("title", decision("unsupported"))
                self.assert_completion(saved, "title")
                self.assertFalse([e for k, e in events if k == "messages" and e[1]["langgraph_node"] == "generate_title"])
                if failure:
                    self.assertIn("failed for thread dashboard", self.diagnostics.getvalue())
                else:
                    self.threads.update.assert_awaited_once_with("dashboard", metadata={"title": "Local dashboard title"})

    async def test_model_failure_clears_stale_completion_and_preserves_failed_run(self):
        self.setup_graph()
        initial, _ = await self.initial()
        self.agent_model.fail = True
        with self.assertRaisesRegex(RuntimeError, "Local title failure"):
            await self.send("failure")
        saved = await self.graph.aget_state(self.config)
        self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
        self.assertIsNone(saved.values["operation_receipt"])
        self.assertIsNone(saved.values["completed_turn_id"])
        self.assertEqual(saved.next, ("decide",))

    async def test_graph_owned_ids_ignore_model_historical_ids(self):
        self.setup_graph()
        saved, _ = await self.initial()
        self.assertNotIn("historical-model-id", [m.id for m in saved.values["messages"]])
        self.assertNotIn("model-decision", [c["id"] for c in saved.values["operation_receipt"]["admitted_calls"]])
        self.assert_completion(saved, "initial")

    async def test_invalid_transcript_identity_prevents_completion(self):
        self.setup_graph()
        saved, _ = await self.send("human", decision("unsupported"),
                                   messages=[AIMessage(id="", content="invalid"), HumanMessage(id="human", content="human")])
        self.assertIsNone(saved.values["completed_turn_id"])

    async def test_empty_and_idempotent_updates_are_applied(self):
        self.setup_graph()
        await self.initial()
        for identity, args in [("same", {}), ("empty", {"type": "cancelled", "limit": 1})]:
            if identity == "empty":
                from langchain_core.tools import StructuredTool
                from langgraph.prebuilt import ToolNode
                def empty(limit: int = 5, type: str | None = None) -> list:
                    return []
                self.module._tool_node = ToolNode([StructuredTool.from_function(empty, name="query_recent_disruptions", description="Empty observation")])
            saved, events = await self.send(identity, decision("data_update", [call("query_recent_disruptions", args)]))
            self.assertEqual(saved.values["operation_receipt"]["outcome"], "applied")
            self.assertEqual(len(self.patches(events)), 1)
            if identity == "empty":
                self.assertEqual(saved.values["dashboard"]["recent_disruptions"], [])

    async def test_copy_ownership_between_patch_receipt_and_checkpoint(self):
        self.setup_graph()
        saved, events = await self.send("initial", decision("create", [call("render_spec", LAYOUT), call("query_recent_disruptions")]), copy_events=False)
        expected = deepcopy(saved.values["dashboard"])
        patch_data = self.patches(events)[0]
        patch_data["/recent_disruptions"][0]["type"] = "changed"
        self.assertEqual(saved.values["dashboard"], expected)
        self.assertEqual(saved.values["operation_receipt"]["validated_slots"], expected)
        saved.values["operation_receipt"]["validated_slots"]["recent_disruptions"][0]["type"] = "changed"
        saved.values["dashboard"]["recent_disruptions"][0]["type"] = "changed"
        self.assertEqual((await self.graph.aget_state(self.config)).values["dashboard"], expected)

    async def test_malformed_failed_missing_or_uncorrelated_results_roll_back_entire_batch(self):
        from langgraph.prebuilt import ToolNode
        from langchain_core.tools import StructuredTool
        variants = ["malformed", "error", "missing", "wrong-name", "wrong-call", "overlimit", "wrongfilter"]
        for variant in variants:
            with self.subTest(variant=variant):
                self.setup_graph()
                initial, _ = await self.initial()
                spec = deepcopy(LAYOUT)
                spec["elements"]["root"]["children"].append("trend")
                spec["elements"]["trend"] = {"type": "line_chart", "props": {"data": {"$state": "/on_time_trend"}, "xKey": "month", "yKey": "on_time_pct"}}
                # Missing trend requires exactly this query; make its actual observed output invalid.
                def observed(months=12):
                    if variant == "error":
                        raise ValueError("Unavailable")
                    if variant == "overlimit":
                        return [{"month": "x", "on_time_pct": 1}] * 13
                    return "not-json"
                self.module._tool_node = ToolNode([self.module.render_spec, StructuredTool.from_function(observed, name="query_on_time_trend", description="Controlled result")], handle_tool_errors=True)
                if variant in ("missing", "wrong-name", "wrong-call"):
                    real_executor = self.module.execute_tools
                    async def controlled(state, config):
                        output = await real_executor(state, config)
                        if variant == "missing":
                            output["messages"] = output["messages"][:1]
                            output["_result_ids"] = output["_result_ids"][:1]
                        elif variant == "wrong-name":
                            output["messages"][1].name = "query_recent_disruptions"
                        else:
                            output["messages"][1].tool_call_id = "unrelated"
                        return output
                    self.module.graph.builder.nodes["tools"].runnable = controlled
                    # runnable must use LangGraph's normal coercion via a new graph node registration.
                    from langchain_core.runnables import RunnableLambda
                    self.module.graph.builder.nodes["tools"].runnable = RunnableLambda(controlled)
                    self.recompile()
                    # preserve initial checkpoint in the newly compiled graph.
                    await self.graph.aupdate_state(self.config, initial.values, as_node="generate_title")
                saved, events = await self.send("bad", decision("restructure", [call("render_spec", spec), call("query_on_time_trend")]))
                self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
                self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
                self.assertEqual(saved.values["_owned_layout"], initial.values["_owned_layout"])
                self.assertEqual(self.patches(events), [])
                current = saved.values["operation_receipt"]["results"]
                self.assertTrue(any(r["name"] == "render_spec" and r["status"] == "success" and r["content"] != "rendered" for r in current))
                self.assertFalse(any(json.loads(m.content) == spec for m in saved.values["messages"] if isinstance(m, AIMessage) and m.content.startswith("{")))

    async def test_genuine_nonempty_parent_fallback_no_wrapper_or_data(self):
        self.setup_graph()
        real_admit = self.module.admit_operation
        def prose_parent(state):
            output = real_admit(state)
            if output.get("messages"):
                output["messages"][0].content = "Controlled genuine fallback."
            return output
        from langchain_core.runnables import RunnableLambda
        self.module.graph.builder.nodes["admit"].runnable = RunnableLambda(prose_parent)
        self.recompile()
        saved, events = await self.initial()
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
        self.assertEqual(saved.values["dashboard"], {})
        self.assertIsNone(saved.values["_owned_layout"])
        self.assertEqual(self.patches(events), [])
        self.assertTrue(any(m.content == "Controlled genuine fallback." for m in saved.values["messages"]))
        self.assertTrue(any(isinstance(m, ToolMessage) and m.name == "render_spec" and m.status == "success" and m.content != "rendered" for m in saved.values["messages"]))

    async def test_current_only_wrapper_does_not_rewrap_historical_render(self):
        self.setup_graph()
        initial, _ = await self.initial()
        saved, events = await self.send("new", decision("unsupported"))
        self.assertEqual(saved.values["messages"][:len(initial.values["messages"])], initial.values["messages"])
        self.assertFalse([e for k, e in events if k == "updates" and (e.get("wrap_spec_into_ai") or {}).get("messages")])

    async def test_fenced_minified_render_transfers_exact_validated_text(self):
        self.setup_graph()
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import ToolNode
        rendered = json.dumps(LAYOUT, separators=(",", ":"), ensure_ascii=False)
        def fenced(elements: dict, root: str) -> str:
            return "```json\n" + rendered + "\n```"
        self.module._tool_node = ToolNode([StructuredTool.from_function(fenced, name="render_spec", description="Fenced render"), *self.module._DATA_TOOLS])
        saved, _ = await self.initial()
        parent = next(m for m in saved.values["messages"] if isinstance(m, AIMessage) and m.tool_calls)
        self.assertEqual(parent.content, rendered)
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "applied")

    async def test_mixed_genuine_success_and_runtime_error_is_atomic(self):
        self.setup_graph()
        initial, _ = await self.initial()
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import ToolNode
        def unavailable() -> dict:
            raise RuntimeError("Provider secret must not escape")
        self.module._tool_node = ToolNode([self.module.render_spec,
            next(t for t in self.module._DATA_TOOLS if t.name == "query_on_time_trend"),
            StructuredTool.from_function(unavailable, name="query_airline_kpis", description="Failing observation")], handle_tool_errors="The dashboard tool failed.")
        spec = deepcopy(LAYOUT)
        spec["elements"]["root"]["children"] += ["trend", "metric"]
        spec["elements"]["trend"] = {"type": "line_chart", "props": {"data": {"$state": "/on_time_trend"}, "xKey": "month", "yKey": "on_time_pct"}}
        spec["elements"]["metric"] = {"type": "stat_card", "props": {"label": "On time", "value": {"$state": "/on_time/value"}}}
        saved, events = await self.send("mixed", decision("restructure", [call("render_spec", spec), call("query_on_time_trend", {"months": 3}), call("query_airline_kpis")]))
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
        self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
        self.assertEqual(saved.values["_owned_layout"], initial.values["_owned_layout"])
        self.assertEqual(self.patches(events), [])
        results = saved.values["operation_receipt"]["results"]
        success = next(r for r in results if r["name"] == "query_on_time_trend")
        self.assertEqual(success["status"], "success")
        self.assertEqual(len(json.loads(success["content"])), 3)
        failure = next(r for r in results if r["name"] == "query_airline_kpis")
        self.assertEqual((failure["status"], failure["content"]), ("error", "The dashboard tool failed."))
        self.assertEqual(next(r for r in results if r["name"] == "render_spec")["status"], "success")
        for k, v in events:
            if k == "values":
                self.assertEqual(v["dashboard"], initial.values["dashboard"])
        self.assert_completion(saved, "mixed")

    async def test_post_assessment_result_changes_cannot_publish(self):
        self.setup_graph()
        initial, _ = await self.initial()
        original = self.module.wrap_spec_into_ai
        async def change_result(state):
            output = await original(state)
            result = self.module.current_results(state)[0]
            output["messages"] = [result.model_copy(deep=True, update={"content": "[]"})]
            return output
        from langchain_core.runnables import RunnableLambda
        self.module.graph.builder.nodes["wrap_spec_into_ai"].runnable = RunnableLambda(change_result)
        self.recompile()
        await self.graph.aupdate_state(self.config, initial.values, as_node="generate_title")
        saved, events = await self.send("changed", decision("data_update", [call("query_recent_disruptions", {"type": "cancelled"})]))
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
        self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
        self.assertEqual(self.patches(events), [])

    async def test_backing_result_changed_before_wrapper_never_mounts_layout(self):
        self.setup_graph()
        original = self.module.assess_results
        def changed_after_assessment(state):
            output = original(state)
            result = next(m for m in self.module.current_results(state) if m.name == "query_recent_disruptions")
            output["messages"] = [result.model_copy(deep=True, update={"content": "[]"})]
            return output
        from langchain_core.runnables import RunnableLambda
        self.module.graph.builder.nodes["assess_results"].runnable = RunnableLambda(changed_after_assessment)
        self.recompile()
        saved, events = await self.initial()
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
        self.assertEqual(saved.values["dashboard"], {})
        self.assertIsNone(saved.values["_owned_layout"])
        self.assertEqual(self.patches(events), [])
        for kind, value in events:
            if kind == "values":
                self.assertFalse(any(isinstance(m, AIMessage) and m.content.startswith("{") for m in value["messages"]))
                self.assertFalse(any(isinstance(m, ToolMessage) and m.content == "rendered" for m in value["messages"]))

    async def test_direct_chronological_latest_results_and_slot_ownership(self):
        self.setup_graph()
        calls = [call("query_recent_disruptions", {"limit": 1}, "first"),
                 call("query_recent_disruptions", {"type": "cancelled"}, "last")]
        query = next(t for t in self.module._DATA_TOOLS if t.name == "query_recent_disruptions")
        results = [ToolMessage(id="result-" + c["id"], name=c["name"], tool_call_id=c["id"],
                               content=json.dumps(query.invoke(c["args"]))) for c in calls]
        slots = self.module.latest_data_slots(results, calls)
        self.assertEqual([r["flight_number"] for r in slots["recent_disruptions"]], ["AA456", "UA204", "UA640"])
        reversed_slots = self.module.latest_data_slots(list(reversed(results)), calls)
        self.assertEqual(len(reversed_slots["recent_disruptions"]), 1)
        slots["recent_disruptions"][0]["type"] = "changed"
        self.assertEqual(json.loads(results[-1].content)[0]["type"], "cancelled")

    async def test_exact_submitted_human_snapshot_is_owned_and_enforced(self):
        self.setup_graph()
        human = HumanMessage(id="exact", content="Original question")
        saved, _ = await self.send("exact", decision("unsupported"), messages=[human])
        self.assertEqual(saved.values["operation_receipt"].get("submitted_human"), human.model_dump())
        snapshot = deepcopy(saved.values["_submitted_human"])
        changed = deepcopy(saved.values)
        changed["messages"] = changed["messages"][:-1]
        changed["_decision"] = {"kind": "unsupported", "calls": [], "interpretation": ""}
        self.assertEqual(self.module.admit_operation(changed)["_operation"]["kind"], "unsupported")
        changed["messages"][-1].content = "Replaced question"
        rejected = self.module.admit_operation(changed)
        self.assertIn("Submitted human changed", rejected["_reason"])
        saved.values["operation_receipt"]["submitted_human"]["content"] = "Changed receipt"
        self.assertEqual(saved.values["_submitted_human"], snapshot)
        self.assertEqual((await self.graph.aget_state(self.config)).values["operation_receipt"]["submitted_human"], snapshot)

    async def test_failed_interpretation_preserves_failed_run_without_completion(self):
        self.setup_graph()
        initial, _ = await self.initial()
        self.respond_model.fail = True
        with self.assertRaisesRegex(RuntimeError, "Local title failure"):
            await self.send("explain", decision("interpret", interpretation="Why?"))
        saved = await self.graph.aget_state(self.config)
        self.assertEqual(saved.next, ("respond",))
        self.assertIsNone(saved.values["completed_turn_id"])
        self.assertIsNone(saved.values["completed_answer_id"])
        self.assertIsNone(saved.values["completed_message_ids"])
        self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
        self.assertEqual(saved.values["_owned_layout"], initial.values["_owned_layout"])

    async def test_compiled_valid_shape_wrong_filter_and_wrong_airline_are_unfulfilled(self):
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import ToolNode
        from src.dashboard_tools import RECENT_DISRUPTIONS
        for name, args in [("query_recent_disruptions", {"type": "cancelled"}),
                           ("query_flights_by_airline", {"airlines": ["Delta"]})]:
            with self.subTest(name=name):
                self.setup_graph()
                initial, _ = await self.initial()
                def mixed(limit: int = 5, type: str | None = None) -> list:
                    return deepcopy(RECENT_DISRUPTIONS[:2])
                def airline(airlines: list[str] | None = None) -> list:
                    return [{"airline": "United", "count": 1}]
                controlled = StructuredTool.from_function(mixed if name == "query_recent_disruptions" else airline,
                                                         name=name, description="Wrong selection")
                self.module._tool_node = ToolNode([controlled])
                saved, events = await self.send("wrong-selection", decision("data_update", [call(name, args)]))
                self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
                self.assertEqual(saved.values["dashboard"], initial.values["dashboard"])
                self.assertEqual(saved.values["_owned_layout"], initial.values["_owned_layout"])
                self.assertEqual(self.patches(events), [])
                self.assertEqual(saved.values["operation_receipt"]["results"][0]["status"], "success")

    async def test_changed_submitted_human_before_wrapper_cannot_publish(self):
        self.setup_graph()
        original = self.module.assess_results
        def changed_human(state):
            output = original(state)
            human = next(m for m in reversed(state["messages"]) if isinstance(m, HumanMessage))
            output["messages"] = [human.model_copy(deep=True, update={"content": "Changed intent"})]
            return output
        from langchain_core.runnables import RunnableLambda
        self.module.graph.builder.nodes["assess_results"].runnable = RunnableLambda(changed_human)
        self.recompile()
        saved, events = await self.initial()
        self.assertEqual(saved.values["operation_receipt"]["outcome"], "unfulfilled")
        self.assertEqual(saved.values["dashboard"], {})
        self.assertIsNone(saved.values["_owned_layout"])
        self.assertIsNone(saved.values["completed_turn_id"])
        self.assertEqual(self.patches(events), [])
        for kind, value in events:
            if kind == "values":
                self.assertFalse(any(isinstance(m, AIMessage) and m.content.startswith("{") for m in value["messages"]))

    async def test_full_initial_five_tool_batch_and_data_only_untouched_slots(self):
        self.setup_graph()
        marker = 'For "show me the dashboard":'
        layout = json.loads(self.module._PROMPT.split(marker)[-1].strip())
        initial, events = await self.send("all-six-types", decision("create", [
            call("render_spec", layout), *[call(t.name) for t in self.module._DATA_TOOLS]]))
        self.assertEqual(initial.values["operation_receipt"]["outcome"], "applied")
        self.assertEqual(len(initial.values["operation_receipt"]["admitted_calls"]), 5)
        self.assertEqual(len(initial.values["operation_receipt"]["results"]), 5)
        self.assertEqual(initial.values["dashboard"]["on_time"], {"value": "84.2%", "delta": "+1.4%"})
        self.assertEqual(len(initial.values["dashboard"]["on_time_trend"]), 12)
        self.assertEqual(len(initial.values["dashboard"]["flights_by_airline"]), 4)
        self.assertEqual(len(initial.values["dashboard"]["recent_disruptions"]), 5)
        self.assertEqual(self.patches(events)[0]["/on_time/value"], "84.2%")
        saved, events = await self.send("six-months", decision("data_update", [call("query_on_time_trend", {"months": 6})]))
        self.assertEqual(len(saved.values["dashboard"]["on_time_trend"]), 6)
        for slot in initial.values["dashboard"]:
            if slot != "on_time_trend":
                self.assertEqual(saved.values["dashboard"][slot], initial.values["dashboard"][slot])
        self.assertEqual(saved.values["_owned_layout"], layout)
        self.assertEqual(list(self.patches(events)[0]), ["/on_time_trend"])


class InstalledBindingTests(unittest.TestCase):
    def test_real_installed_chatopenai_required_binding(self):
        # LocalModel.bind_tools intentionally ignores kwargs; this is the separate real-provider binding proof.
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network, patch.dict(os.environ, {"OPENAI_API_KEY": "offline"}):
            spec = importlib.util.spec_from_file_location("installed_dashboard_binding", Path(__file__).parents[1] / "src/graph.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            bound = module._llm_with_tools
            network.assert_not_called()
        self.assertEqual(bound.kwargs["tool_choice"], {"type": "function", "function": {"name": "plan_dashboard_operation"}})
        self.assertIs(bound.kwargs["parallel_tool_calls"], False)
        schema = bound.kwargs["tools"][0]["function"]
        self.assertIs(schema["strict"], False)
        self.assertEqual(schema["parameters"]["properties"]["kind"]["enum"], ["create", "data_update", "restructure", "interpret", "unsupported"])
        self.assertEqual(schema["parameters"]["properties"]["calls"]["type"], "array")
        self.assertEqual(len(bound.kwargs["tools"]), 1)
        self.assertIn("nostream", bound.bound.tags)


if __name__ == "__main__":
    unittest.main()
