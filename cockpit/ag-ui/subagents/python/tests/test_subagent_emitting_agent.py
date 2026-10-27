"""Tests for SubagentEmittingAgent — the run-wrapping emitter that expands the
graph's `subagent_activity` CUSTOM events (started / message_start / message /
finished / error) into the protocol's standard SUBAGENT_* + attributed
TEXT_MESSAGE_* events. Drives the wrapper with a scripted inner
`LangGraphAgent.run` generator and asserts the exact output sequence
field-for-field."""
import logging
from typing import Any

import pytest
from ag_ui.core import (
    CustomEvent,
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
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
MESSAGE_ID = f"{TID}-sub-m1"


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


def _tool_call(tid: str):
    return [
        ToolCallStartEvent(type=EventType.TOOL_CALL_START, tool_call_id=tid, tool_call_name="task"),
        ToolCallArgsEvent(type=EventType.TOOL_CALL_ARGS, tool_call_id=tid, delta='{"role":"research"}'),
        ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tid),
    ]


def _tool_result(tid: str, content: str):
    return ToolCallResultEvent(
        type=EventType.TOOL_CALL_RESULT, message_id=f"{tid}-result", tool_call_id=tid, content=content
    )


async def _collect(monkeypatch, script: list) -> list:
    async def fake_run(self, input):
        for ev in script:
            yield ev

    monkeypatch.setattr(LangGraphAgent, "run", fake_run)
    agent = SubagentEmittingAgent(name="subagents", graph=_graph())
    return [ev async for ev in agent.run(_input())]


async def test_expands_one_delegation_field_for_field(monkeypatch):
    script = [
        _run_started(),
        *_tool_call(TID),
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": MESSAGE_ID}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "Paris "}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "is"}),
        _activity({"subagent_id": TID, "phase": "finished", "status": "complete"}),
        _tool_result(TID, "Paris is"),
        _run_finished(),
    ]
    out = await _collect(monkeypatch, script)

    assert [ev.type for ev in out] == [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
        EventType.TOOL_CALL_RESULT,
        EventType.RUN_FINISHED,
    ]
    # The CUSTOM subagent_activity events are consumed, never forwarded.
    assert not any(ev.type == EventType.CUSTOM for ev in out)

    started = out[4]
    assert started.subagent_run_id == RUN_ID
    assert started.name == "research"
    assert started.parent_tool_call_id == TID

    start = out[5]
    assert start.message_id == MESSAGE_ID
    assert start.role == "assistant"
    assert start.subagent_run_id == RUN_ID

    deltas = out[6:8]
    assert [ev.delta for ev in deltas] == ["Paris ", "is"]
    for ev in deltas:
        assert ev.message_id == MESSAGE_ID
        assert ev.subagent_run_id == RUN_ID

    end = out[8]
    assert end.message_id == MESSAGE_ID
    assert end.subagent_run_id == RUN_ID

    finished = out[9]
    assert finished.subagent_run_id == RUN_ID
    assert finished.outcome.type == "success"

    # Bridge-native events pass through untouched (same objects, unattributed).
    assert out[1] is script[1]
    assert out[10] is script[9]
    assert out[10].subagent_run_id is None


async def test_serialized_custom_value_is_decoded(monkeypatch):
    # The bridge may JSON-serialize custom values; the expansion must cope.
    script = [
        CustomEvent(type=EventType.CUSTOM, name="subagent_activity",
                    value='{"subagent_id": "call_1", "phase": "started", "name": "booking"}'),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.SUBAGENT_STARTED, EventType.SUBAGENT_FINISHED]
    assert out[0].name == "booking"


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
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": MESSAGE_ID}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "Par"}),
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
    assert out[3].message_id == MESSAGE_ID
    assert out[3].subagent_run_id == RUN_ID
    err = out[4]
    assert err.subagent_run_id == RUN_ID
    assert err.message == "RuntimeError: child exploded"


async def test_second_message_start_closes_the_first(monkeypatch):
    m2 = f"{TID}-sub-m2"
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": MESSAGE_ID}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "a"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": m2}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": m2, "delta": "b"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    out = await _collect(monkeypatch, script)
    assert [(ev.type, getattr(ev, "message_id", None)) for ev in out] == [
        (EventType.SUBAGENT_STARTED, None),
        (EventType.TEXT_MESSAGE_START, MESSAGE_ID),
        (EventType.TEXT_MESSAGE_CONTENT, MESSAGE_ID),
        (EventType.TEXT_MESSAGE_END, MESSAGE_ID),
        (EventType.TEXT_MESSAGE_START, m2),
        (EventType.TEXT_MESSAGE_CONTENT, m2),
        (EventType.TEXT_MESSAGE_END, m2),
        (EventType.SUBAGENT_FINISHED, None),
    ]


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
    assert [ev.message_id for ev in starts] == [f"{TID}-sub-m1", f"{TID}-sub-m2"]
    content = [ev for ev in out if ev.type == EventType.TEXT_MESSAGE_CONTENT]
    assert content[0].message_id == f"{TID}-sub-m1"


async def test_message_before_message_start_opens_the_message_lazily(monkeypatch):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "x"}),
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
    assert out[1].message_id == MESSAGE_ID


async def test_two_sequential_delegations_get_distinct_run_ids(monkeypatch):
    script = [
        _run_started(),
        *_tool_call(TID),
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": MESSAGE_ID}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "intel"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
        _tool_result(TID, "intel"),
        *_tool_call(TID2),
        _activity({"subagent_id": TID2, "phase": "started", "name": "booking"}),
        _activity({"subagent_id": TID2, "phase": "message_start", "message_id": f"{TID2}-sub-m1"}),
        _activity({"subagent_id": TID2, "phase": "message", "message_id": f"{TID2}-sub-m1", "delta": "flights"}),
        _activity({"subagent_id": TID2, "phase": "finished"}),
        _tool_result(TID2, "flights"),
        _run_finished(),
    ]
    out = await _collect(monkeypatch, script)

    started = [ev for ev in out if ev.type == EventType.SUBAGENT_STARTED]
    assert [ev.subagent_run_id for ev in started] == [f"{TID}-sub", f"{TID2}-sub"]
    assert [ev.parent_tool_call_id for ev in started] == [TID, TID2]
    assert [ev.name for ev in started] == ["research", "booking"]

    a = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{TID}-sub"]
    b = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{TID2}-sub"]
    expected = [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]
    assert [ev.type for ev in a] == expected
    assert [ev.type for ev in b] == expected
    assert {ev.message_id for ev in a if hasattr(ev, "message_id")} == {f"{TID}-sub-m1"}
    assert {ev.message_id for ev in b if hasattr(ev, "message_id")} == {f"{TID2}-sub-m1"}
    # Every child event sits between its own tool call's END and RESULT.
    types = [ev.type for ev in out]
    tool_results = [i for i, ev in enumerate(out) if ev.type == EventType.TOOL_CALL_RESULT]
    assert types.index(EventType.SUBAGENT_STARTED) > types.index(EventType.TOOL_CALL_END)
    assert types.index(EventType.SUBAGENT_FINISHED) < tool_results[0]


async def test_unknown_phase_is_dropped_with_a_warning(monkeypatch, caplog):
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "tool_call", "tool_call_id": "x"}),
        _activity({"subagent_id": TID, "phase": "finished"}),
    ]
    with caplog.at_level(logging.WARNING):
        out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.SUBAGENT_STARTED, EventType.SUBAGENT_FINISHED]
    assert any("tool_call" in rec.getMessage() for rec in caplog.records)


async def test_malformed_payload_is_dropped(monkeypatch, caplog):
    script = [
        _run_started(),
        CustomEvent(type=EventType.CUSTOM, name="subagent_activity", value="not json"),
        _activity({"phase": "started", "name": "research"}),  # no subagent_id
        _activity({"subagent_id": TID}),  # no phase
        _run_finished(),
    ]
    with caplog.at_level(logging.WARNING):
        out = await _collect(monkeypatch, script)
    assert [ev.type for ev in out] == [EventType.RUN_STARTED, EventType.RUN_FINISHED]


async def test_delegation_state_is_per_run(monkeypatch):
    # A second run on the same agent must not see the first run's open message.
    script = [
        _activity({"subagent_id": TID, "phase": "started", "name": "research"}),
        _activity({"subagent_id": TID, "phase": "message_start", "message_id": MESSAGE_ID}),
        _activity({"subagent_id": TID, "phase": "message", "message_id": MESSAGE_ID, "delta": "x"}),
        # run ends with the message still open (client disconnect, say)
    ]

    async def fake_run(self, input):
        for ev in script:
            yield ev

    monkeypatch.setattr(LangGraphAgent, "run", fake_run)
    agent = SubagentEmittingAgent(name="subagents", graph=_graph())
    first = [ev async for ev in agent.run(_input())]
    assert first[-1].type == EventType.TEXT_MESSAGE_CONTENT

    script[:] = [_activity({"subagent_id": TID, "phase": "finished"})]
    second = [ev async for ev in agent.run(_input())]
    # No stale TEXT_MESSAGE_END from run 1 leaks into run 2; the unknown
    # delegation's finished is still expanded (bracketing the card).
    assert [ev.type for ev in second] == [EventType.SUBAGENT_FINISHED]


def test_clone_preserves_the_subclass():
    # The FastAPI endpoint runs agent.clone() per request; the emitter must
    # survive cloning or SUBAGENT_* events would silently vanish from the wire.
    agent = SubagentEmittingAgent(name="subagents", graph=_graph())
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
