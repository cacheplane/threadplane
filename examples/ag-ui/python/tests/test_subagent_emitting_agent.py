"""Tests for SubagentEmittingAgent — the run-wrapping emitter that expands the
graph's `subagent_activity` CUSTOM events (started / message_start / message /
tool_call / tool_result / finished / error) into the protocol's standard
SUBAGENT_* + attributed TEXT_MESSAGE_* / TOOL_CALL_* events. Drives the
wrapper with a scripted inner `LangGraphAgent.run` generator and asserts the
exact output sequence field-for-field."""
import json
import logging
from typing import Any

import pytest
from ag_ui.core import (
    CustomEvent,
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui_langgraph import LangGraphAgent
from langgraph.graph import END, MessagesState, StateGraph

from src.streaming.subagent_emitting_agent import SubagentEmittingAgent

TID = "call_1"
TID2 = "call_2"
RUN_ID = f"{TID}-sub"
M1 = f"{TID}-sub-m1"
M2 = f"{TID}-sub-m2"
LOOKUP = "call_lookup_1"
LOOKUP_ARGS = {"query": "angular signals"}
LOOKUP_RESULT = "Angular signals are a reactivity primitive."


def _graph():
    g = StateGraph(MessagesState)
    g.add_node("noop", lambda state: {})
    g.set_entry_point("noop")
    g.add_edge("noop", END)
    return g.compile()


def _input() -> RunAgentInput:
    return RunAgentInput(
        thread_id="t", run_id="r", messages=[], tools=[], context=[], state={}, forwarded_props={}
    )


def _activity(payload: dict[str, Any]) -> CustomEvent:
    return CustomEvent(type=EventType.CUSTOM, name="subagent_activity", value=payload)


def _run_started():
    return RunStartedEvent(type=EventType.RUN_STARTED, thread_id="t", run_id="r")


def _run_finished():
    return RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id="t", run_id="r")


def _tool_call(tid: str, name: str = "research", args: str = '{"topic":"signals"}'):
    return [
        ToolCallStartEvent(type=EventType.TOOL_CALL_START, tool_call_id=tid, tool_call_name=name),
        ToolCallArgsEvent(type=EventType.TOOL_CALL_ARGS, tool_call_id=tid, delta=args),
        ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tid),
    ]


def _tool_result(tid: str, content: str):
    return ToolCallResultEvent(
        type=EventType.TOOL_CALL_RESULT, message_id=f"{tid}-result", tool_call_id=tid, content=content
    )


def _text(message_id: str, delta: str):
    return [
        TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id=message_id, role="assistant"),
        TextMessageContentEvent(type=EventType.TEXT_MESSAGE_CONTENT, message_id=message_id, delta=delta),
        TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=message_id),
    ]


def _delegation(tid: str = TID, name: str = "research") -> list:
    """The research subgraph's phase sequence for one reason → tool → answer
    loop, as the graph dispatches it (see test_subagent_emission.py)."""
    m1, m2 = f"{tid}-sub-m1", f"{tid}-sub-m2"
    return [
        _activity({"subagent_id": tid, "phase": "started", "name": name}),
        _activity({"subagent_id": tid, "phase": "message_start", "message_id": m1}),
        _activity({"subagent_id": tid, "phase": "tool_call", "message_id": m1,
                   "tool_call_id": LOOKUP, "name": "lookup", "args": LOOKUP_ARGS}),
        _activity({"subagent_id": tid, "phase": "tool_result",
                   "tool_call_id": LOOKUP, "content": LOOKUP_RESULT}),
        _activity({"subagent_id": tid, "phase": "message_start", "message_id": m2}),
        _activity({"subagent_id": tid, "phase": "message", "message_id": m2, "delta": "- Signals"}),
        _activity({"subagent_id": tid, "phase": "message", "message_id": m2, "delta": " are reactive."}),
        _activity({"subagent_id": tid, "phase": "finished", "status": "complete"}),
    ]


async def _collect(monkeypatch, script: list) -> list:
    async def fake_run(self, input):
        for ev in script:
            yield ev

    monkeypatch.setattr(LangGraphAgent, "run", fake_run)
    agent = SubagentEmittingAgent(name="chat", graph=_graph())
    return [ev async for ev in agent.run(_input())]


async def test_expands_the_reason_tool_answer_loop_field_for_field(monkeypatch):
    script = [_run_started(), *_tool_call(TID), *_delegation(), _tool_result(TID, "- Signals are reactive."), _run_finished()]
    out = await _collect(monkeypatch, script)

    assert [ev.type for ev in out] == [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,   # m1 — the tool-calling turn
        EventType.TEXT_MESSAGE_END,     # closed before the child's tool call
        EventType.TOOL_CALL_START,      # lookup (attributed)
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,     # lookup result (attributed)
        EventType.TEXT_MESSAGE_START,   # m2 — the answer turn
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
        EventType.TOOL_CALL_RESULT,     # the parent's research result (bridge-native)
        EventType.RUN_FINISHED,
    ]
    # The CUSTOM subagent_activity events are consumed, never forwarded.
    assert not any(ev.type == EventType.CUSTOM for ev in out)

    started = out[4]
    assert started.subagent_run_id == RUN_ID
    assert started.name == "research"
    assert started.parent_tool_call_id == TID

    m1_start, m1_end = out[5], out[6]
    assert (m1_start.message_id, m1_start.role, m1_start.subagent_run_id) == (M1, "assistant", RUN_ID)
    assert (m1_end.message_id, m1_end.subagent_run_id) == (M1, RUN_ID)

    tc_start, tc_args, tc_end, tc_result = out[7:11]
    assert tc_start.tool_call_id == LOOKUP
    assert tc_start.tool_call_name == "lookup"
    assert tc_start.parent_message_id == M1
    assert tc_start.subagent_run_id == RUN_ID
    assert tc_args.tool_call_id == LOOKUP
    assert json.loads(tc_args.delta) == LOOKUP_ARGS
    assert tc_args.subagent_run_id == RUN_ID
    assert tc_end.tool_call_id == LOOKUP
    assert tc_end.subagent_run_id == RUN_ID
    assert tc_result.tool_call_id == LOOKUP
    assert tc_result.message_id == f"{LOOKUP}-result"
    assert tc_result.content == LOOKUP_RESULT
    assert tc_result.role == "tool"
    assert tc_result.subagent_run_id == RUN_ID

    m2_start = out[11]
    assert (m2_start.message_id, m2_start.role, m2_start.subagent_run_id) == (M2, "assistant", RUN_ID)
    deltas = out[12:14]
    assert [ev.delta for ev in deltas] == ["- Signals", " are reactive."]
    for ev in deltas:
        assert ev.message_id == M2
        assert ev.subagent_run_id == RUN_ID
    m2_end = out[14]
    assert (m2_end.message_id, m2_end.subagent_run_id) == (M2, RUN_ID)

    finished = out[15]
    assert finished.subagent_run_id == RUN_ID
    assert finished.outcome.type == "success"

    # Bridge-native events pass through untouched (same objects, unattributed).
    assert out[1] is script[1]
    assert out[16] is script[12]
    assert out[16].subagent_run_id is None


async def test_bridge_native_events_pass_through_untouched_even_inside_a_delegation(monkeypatch):
    # The wrapper is a pure 1:N expander: it never filters bridge-native
    # events. The child subgraph's own LLM text / tool call are kept off the
    # wire at the SOURCE — the research tool invokes the subgraph with the
    # bridge's `emit-messages` / `emit-tool-calls` = False run metadata (see
    # test_subagent_emission.py) — so an unattributed event that does arrive
    # between started and finished (the child's STEP_*, or any future
    # bridge-native event) is forwarded as-is, same object, in order.
    step = StepStartedEvent(type=EventType.STEP_STARTED, step_name="tools")
    parent_text = _text("lc_run--parent", "Here is what the subagent found.")
    script = [
        _run_started(),
        *_tool_call(TID),
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": M1}),
        step,
        _activity({"subagent_id": TID, "phase": "message", "message_id": M1, "delta": "- Signals"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
        _tool_result(TID, "- Signals"),
        *parent_text,
        _run_finished(),
    ]
    out = await _collect(monkeypatch, script)
    assert [(ev.type, getattr(ev, "subagent_run_id", None)) for ev in out] == [
        (EventType.RUN_STARTED, None),
        (EventType.TOOL_CALL_START, None),
        (EventType.TOOL_CALL_ARGS, None),
        (EventType.TOOL_CALL_END, None),
        (EventType.SUBAGENT_STARTED, RUN_ID),
        (EventType.TEXT_MESSAGE_START, RUN_ID),
        (EventType.STEP_STARTED, None),
        (EventType.TEXT_MESSAGE_CONTENT, RUN_ID),
        (EventType.TEXT_MESSAGE_END, RUN_ID),
        (EventType.SUBAGENT_FINISHED, RUN_ID),
        (EventType.TOOL_CALL_RESULT, None),
        (EventType.TEXT_MESSAGE_START, None),
        (EventType.TEXT_MESSAGE_CONTENT, None),
        (EventType.TEXT_MESSAGE_END, None),
        (EventType.RUN_FINISHED, None),
    ]
    assert out[6] is step
    assert out[11:14] == parent_text


async def test_without_any_delegation_the_stream_is_the_identity(monkeypatch):
    script = [_run_started(), *_tool_call("call_search", name="search_documents"),
              _tool_result("call_search", "[]"), *_text("lc_run--parent", "hi"), _run_finished()]
    out = await _collect(monkeypatch, script)
    # Identity except the one stamp: RUN_STARTED gains the protocol version.
    assert out[0].protocol_version == "1.0"
    assert out[1:] == script[1:]
    assert out[0].model_copy(update={"protocol_version": None}) == script[0]


async def test_serialized_custom_value_is_decoded(monkeypatch):
    # The bridge may JSON-serialize custom values; the expansion must cope.
    script = [
        CustomEvent(type=EventType.CUSTOM, name="subagent_activity",
                    value='{"subagent_id": "call_1", "phase": "started", "name": "research"}'),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.SUBAGENT_STARTED, EventType.SUBAGENT_FINISHED]
    assert out[0].name == "research"


async def test_no_deltas_still_brackets_with_started_and_finished(monkeypatch):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.SUBAGENT_STARTED, EventType.SUBAGENT_FINISHED]


async def test_unrelated_custom_event_passes_through_untouched(monkeypatch):
    other = CustomEvent(type=EventType.CUSTOM, name="PredictState", value={"x": 1})
    out = await _collect(monkeypatch, [_run_started(), other, _run_finished()])
    assert [ev.type for ev in out] == [EventType.RUN_STARTED, EventType.CUSTOM, EventType.RUN_FINISHED]
    assert out[1] is other


async def test_error_closes_open_message_then_reports(monkeypatch):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": M1}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": M1, "delta": "Par"}),
        _activity({"subagent_id": TID, "phase": "error", "message": "RuntimeError: child exploded"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,  # open message is closed before the error
        EventType.SUBAGENT_ERROR,
    ]
    assert out[3].message_id == M1
    assert out[3].subagent_run_id == RUN_ID
    err = out[4]
    assert err.subagent_run_id == RUN_ID
    assert err.message == "RuntimeError: child exploded"


async def test_tool_call_without_an_open_message_has_no_parent(monkeypatch):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "tool_call", "tool_call_id": LOOKUP, "name": "lookup", "args": {}}),
        _activity({"subagent_id": TID, "phase": "tool_result", "tool_call_id": LOOKUP, "content": {"ok": True}}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [
        EventType.SUBAGENT_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.SUBAGENT_FINISHED,
    ]
    assert out[1].parent_message_id is None
    assert out[2].delta == "{}"
    # Non-string tool content is JSON-serialized so the encoder never sees a dict.
    assert out[4].content == '{"ok": true}'


async def test_message_start_without_message_id_derives_it(monkeypatch):
    # Defensive: a message_start missing message_id gets <tid>-sub-m<n>.
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start"}),
        _activity({"subagent_id": TID, "phase": "message", "delta": "x"}),
        _activity({"subagent_id": TID, "phase": "message_start"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    starts = [ev for ev in out if ev.type == EventType.TEXT_MESSAGE_START]
    assert [ev.message_id for ev in starts] == [M1, M2]
    content = [ev for ev in out if ev.type == EventType.TEXT_MESSAGE_CONTENT]
    assert content[0].message_id == M1


async def test_message_before_message_start_opens_the_message_lazily(monkeypatch):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": M1, "delta": "x"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]
    assert out[1].message_id == M1


async def test_two_sequential_delegations_get_distinct_run_ids(monkeypatch):
    script = [
        _run_started(),
        *_tool_call(TID),
        *_delegation(TID, "research"),
        _tool_result(TID, "intel"),
        *_tool_call(TID2),
        *_delegation(TID2, "research"),
        _tool_result(TID2, "more intel"),
        _run_finished(),
    ]
    out = await _collect(monkeypatch, script)

    started = [ev for ev in out if ev.type == EventType.SUBAGENT_STARTED]
    assert [ev.subagent_run_id for ev in started] == [f"{TID}-sub", f"{TID2}-sub"]
    assert [ev.parent_tool_call_id for ev in started] == [TID, TID2]

    expected = [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_END,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]
    a = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{TID}-sub"]
    b = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{TID2}-sub"]
    assert [ev.type for ev in a] == expected
    assert [ev.type for ev in b] == expected
    assert {ev.message_id for ev in a if ev.type == EventType.TEXT_MESSAGE_START} == {f"{TID}-sub-m1", f"{TID}-sub-m2"}
    assert {ev.message_id for ev in b if ev.type == EventType.TEXT_MESSAGE_START} == {f"{TID2}-sub-m1", f"{TID2}-sub-m2"}
    # Every child block sits between its own tool call's END and RESULT.
    types = [ev.type for ev in out]
    parent_results = [i for i, ev in enumerate(out) if ev.type == EventType.TOOL_CALL_RESULT and ev.subagent_run_id is None]
    assert types.index(EventType.SUBAGENT_STARTED) > types.index(EventType.TOOL_CALL_END)
    assert types.index(EventType.SUBAGENT_FINISHED) < parent_results[0]
    second_started = [i for i, ev in enumerate(out) if ev.type == EventType.SUBAGENT_STARTED][1]
    assert parent_results[0] < second_started < parent_results[1]


async def test_unknown_phase_is_dropped_with_a_warning(monkeypatch, caplog):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "reasoning", "delta": "hmm"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    with caplog.at_level(logging.WARNING):
        out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.SUBAGENT_STARTED, EventType.SUBAGENT_FINISHED]
    assert any("reasoning" in rec.getMessage() for rec in caplog.records)


async def test_malformed_payload_is_dropped(monkeypatch, caplog):
    script = [
        _run_started(),
        CustomEvent(type=EventType.CUSTOM, name="subagent_activity", value="not json"),
        _activity({"phase": "started", "name": "research"}),  # no subagent_id
        _activity({"subagent_id": TID}),  # no phase
        _activity({"subagent_id": TID, "phase": "tool_call", "name": "lookup"}),  # no tool_call_id
        _activity({"subagent_id": TID, "phase": "tool_result", "content": "x"}),  # no tool_call_id
        _run_finished(),
    ]
    with caplog.at_level(logging.WARNING):
        out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.RUN_STARTED, EventType.RUN_FINISHED]


async def test_delegation_state_is_per_run(monkeypatch):
    # A second run on the same agent must not see the first run's open message.
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": M1}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": M1, "delta": "x"}),
        # run ends with the message still open (client disconnect, say)
    ]

    async def fake_run(self, input):
        for ev in script:
            yield ev

    monkeypatch.setattr(LangGraphAgent, "run", fake_run)
    agent = SubagentEmittingAgent(name="chat", graph=_graph())
    first = [ev async for ev in agent.run(_input())]
    assert first[-1].type == EventType.TEXT_MESSAGE_CONTENT

    script[:] = [*_text("lc_run--parent", "hello"), _activity({"subagent_id": TID, "phase": "finished"})]
    second = [ev async for ev in agent.run(_input())]
    # No stale TEXT_MESSAGE_END from run 1 leaks into run 2, and the unknown
    # delegation's finished is still expanded (bracketing the card).
    assert [ev.type for ev in second] == [
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]


def test_clone_preserves_the_subclass():
    # The FastAPI endpoint runs agent.clone() per request; the emitter must
    # survive cloning or SUBAGENT_* events would silently vanish from the wire.
    agent = SubagentEmittingAgent(name="chat", graph=_graph())
    assert isinstance(agent.clone(), SubagentEmittingAgent)


def test_server_mounts_the_emitting_agent(monkeypatch):
    # ChatOpenAI validates credentials at construction (graph import time).
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    from src import server

    assert isinstance(server.agent, SubagentEmittingAgent)


async def test_run_started_declares_the_protocol_version(monkeypatch):
    from ag_ui.core import PROTOCOL_VERSION

    events = await _collect(monkeypatch, [_run_started()])
    started = events[0]
    assert started.type == EventType.RUN_STARTED
    assert started.protocol_version == PROTOCOL_VERSION


async def test_run_started_keeps_an_explicit_protocol_version(monkeypatch):
    started_in = RunStartedEvent(
        type=EventType.RUN_STARTED, thread_id="t", run_id="r", protocol_version="1.0"
    )
    events = await _collect(monkeypatch, [started_in])
    assert events[0].protocol_version == "1.0"
