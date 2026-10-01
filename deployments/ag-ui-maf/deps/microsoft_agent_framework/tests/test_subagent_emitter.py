"""Tests for the SUBAGENT_* emitter — drives the `delegation_*` helpers and
the queue-merge run wrapper with a fake inner bridge generator plus a
scripted tool enqueue (the fake generator calls the helpers between its own
yields, exactly where the framework invokes the real tool on the pump's
driving chain) and asserts the exact merged sequence field-for-field."""

import asyncio

import pytest

from ag_ui.core import (
    EventType,
    RunFinishedEvent,
    RunStartedEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)

from src import subagent_emitter
from src.subagent_emitter import (
    SubagentEmittingAgent,
    current_tool_call_id,
    delegation_delta,
    delegation_error,
    delegation_finished,
    delegation_started,
    wrap_agent_run,
)

TID = "call_7sxPY1sC236nPyHRTWAZMJB9"
RUN_ID = f"{TID}-sub"
MESSAGE_ID = f"{TID}-sub-m1"


# ---------------------------------------------------------------------------
# Helper-level tests: install a session directly and inspect the queue.
# ---------------------------------------------------------------------------


@pytest.fixture
def session():
    s = subagent_emitter._EmitterSession(queue=asyncio.Queue())
    token = subagent_emitter._event_queue.set(s)
    yield s
    subagent_emitter._event_queue.reset(token)


def _drain(session) -> list:
    out = []
    while not session.queue.empty():
        out.append(session.queue.get_nowait())
    return out


def test_success_sequence_field_for_field(session):
    delegation_started(TID, "policy_researcher")
    delegation_delta(TID, "- Pre")
    delegation_delta(TID, "-approval")
    delegation_delta(TID, " required")
    delegation_finished(TID)

    out = _drain(session)
    assert [ev.type for ev in out] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]

    started = out[0]
    assert started.subagent_run_id == RUN_ID
    assert started.name == "policy_researcher"
    assert started.parent_tool_call_id == TID

    start = out[1]
    assert start.message_id == MESSAGE_ID
    assert start.role == "assistant"
    assert start.subagent_run_id == RUN_ID

    deltas = out[2:5]
    assert [ev.delta for ev in deltas] == ["- Pre", "-approval", " required"]
    for ev in deltas:
        assert ev.message_id == MESSAGE_ID
        assert ev.subagent_run_id == RUN_ID

    end = out[5]
    assert end.message_id == MESSAGE_ID
    assert end.subagent_run_id == RUN_ID

    finished = out[6]
    assert finished.subagent_run_id == RUN_ID
    assert finished.outcome.type == "success"


def test_no_deltas_still_brackets_with_started_and_finished(session):
    delegation_started(TID, "policy_researcher")
    delegation_finished(TID)
    assert [ev.type for ev in _drain(session)] == [
        EventType.SUBAGENT_STARTED,
        EventType.SUBAGENT_FINISHED,
    ]


def test_error_closes_open_message_then_reports(session):
    delegation_started(TID, "policy_researcher")
    delegation_delta(TID, "- Pre")
    delegation_error(TID, "specialist exploded")

    out = _drain(session)
    assert [ev.type for ev in out] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,  # open message is closed before the error
        EventType.SUBAGENT_ERROR,
    ]
    err = out[-1]
    assert err.subagent_run_id == RUN_ID
    assert err.message == "specialist exploded"


def test_events_after_terminal_are_ignored(session):
    delegation_started(TID, "policy_researcher")
    delegation_finished(TID)
    delegation_delta(TID, "late straggler")
    delegation_finished(TID)
    assert [ev.type for ev in _drain(session)] == [
        EventType.SUBAGENT_STARTED,
        EventType.SUBAGENT_FINISHED,
    ]


def test_empty_delta_is_dropped(session):
    delegation_started(TID, "policy_researcher")
    delegation_delta(TID, "")
    delegation_finished(TID)
    assert [ev.type for ev in _drain(session)] == [
        EventType.SUBAGENT_STARTED,
        EventType.SUBAGENT_FINISHED,
    ]


def test_none_tid_falls_back_to_generated_run_id(session):
    delegation_started(None, "policy_researcher")
    delegation_delta(None, "- x")
    delegation_finished(None)

    out = _drain(session)
    started = out[0]
    assert started.parent_tool_call_id is None
    assert started.subagent_run_id.startswith("sub-")
    assert len(started.subagent_run_id) == len("sub-") + 8
    # All subsequent events carry the same generated run id.
    assert {ev.subagent_run_id for ev in out} == {started.subagent_run_id}
    assert out[1].message_id == f"{started.subagent_run_id}-m1"


def test_helpers_are_noops_without_a_session():
    # Unit tests / direct agent runs: no wrapper, no queue — nothing raises.
    assert subagent_emitter._event_queue.get() is None
    assert current_tool_call_id("research_policy") is None
    delegation_started(TID, "policy_researcher")
    delegation_delta(TID, "- x")
    delegation_finished(TID)
    delegation_error(TID, "boom")


# ---------------------------------------------------------------------------
# Wrapper-level tests: queue-merge around a fake inner bridge generator.
# ---------------------------------------------------------------------------


class _FakeInner:
    """Duck-typed AgentFrameworkAgent carrying the attributes the wrapper
    copies plus a scripted `run` generator."""

    def __init__(self, gen_fn):
        self.agent = object()
        self.name = "fake"
        self.description = ""
        self.config = object()
        self._approval_state_store = object()
        self._gen_fn = gen_fn

    def run(self, input_data):
        return self._gen_fn(input_data)


def _run_started():
    return RunStartedEvent(type=EventType.RUN_STARTED, thread_id="t", run_id="r")


def _run_finished():
    return RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id="t", run_id="r")


async def _collect(agent) -> list:
    return [ev async for ev in agent.run({"messages": []})]


async def test_wrapper_merges_tool_enqueued_events_mid_stream():
    async def inner(_input):
        # Measured wire order: the bridge streams TOOL_CALL_START + ARGS
        # before invoking the tool; TOOL_CALL_END arrives only AFTER the
        # tool returns (docs/wire-capture-subagents.md, "After the emitter").
        yield _run_started()
        yield ToolCallStartEvent(
            type=EventType.TOOL_CALL_START, tool_call_id=TID, tool_call_name="research_policy"
        )
        yield ToolCallArgsEvent(
            type=EventType.TOOL_CALL_ARGS, tool_call_id=TID, delta='{"category":"travel","amount":900}'
        )
        # The framework invokes the tool HERE, on the pump's driving chain,
        # while the outer consumer is awaiting the queue.
        tid = current_tool_call_id("research_policy")
        assert tid == TID  # recorded by the pump from TOOL_CALL_START
        delegation_started(tid, "policy_researcher")
        delegation_delta(tid, "- Pre-approval")
        delegation_delta(tid, " required")
        delegation_finished(tid)
        yield ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=TID)
        yield ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT, message_id="m", tool_call_id=TID, content="- Pre-approval required"
        )
        yield _run_finished()

    out = await _collect(wrap_agent_run(_FakeInner(inner)))
    assert [ev.type for ev in out] == [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        # Child events land BETWEEN inner generator items — before the
        # bridge's own TOOL_CALL_END/RESULT reach the client.
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.RUN_FINISHED,
    ]
    started = out[3]
    assert started.subagent_run_id == RUN_ID
    assert started.parent_tool_call_id == TID
    assert [ev.delta for ev in out[5:7]] == ["- Pre-approval", " required"]


async def test_same_tool_double_call_gets_distinct_tids_and_delegations():
    # MAF runs multi-tool batches concurrently (asyncio.gather) and the
    # bridge streams every TOOL_CALL_START before the tools execute — so
    # two research_policy calls must each claim their OWN tid from the
    # FIFO and drive their own delegation, never sharing one message.
    tid2 = "call_secondResearchPolicyCall00"

    async def inner(_input):
        yield ToolCallStartEvent(
            type=EventType.TOOL_CALL_START, tool_call_id=TID, tool_call_name="research_policy"
        )
        yield ToolCallStartEvent(
            type=EventType.TOOL_CALL_START, tool_call_id=tid2, tool_call_name="research_policy"
        )
        # Both tool bodies run concurrently; their deltas interleave.
        tid_a = current_tool_call_id("research_policy")
        tid_b = current_tool_call_id("research_policy")
        assert (tid_a, tid_b) == (TID, tid2)  # FIFO: oldest first
        delegation_started(tid_a, "policy_researcher")
        delegation_started(tid_b, "policy_researcher")
        delegation_delta(tid_a, "- travel rules")
        delegation_delta(tid_b, "- meal rules")
        delegation_delta(tid_a, " apply")
        delegation_finished(tid_b)
        delegation_finished(tid_a)
        yield ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=TID)
        yield ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tid2)

    out = await _collect(wrap_agent_run(_FakeInner(inner)))

    started = [ev for ev in out if ev.type == EventType.SUBAGENT_STARTED]
    assert [ev.subagent_run_id for ev in started] == [f"{TID}-sub", f"{tid2}-sub"]
    assert [ev.parent_tool_call_id for ev in started] == [TID, tid2]

    # Identity separation: every child event carries its own delegation's
    # ids — interleaved ORDER between the two runs is fine.
    for ev in out:
        if ev.type == EventType.TEXT_MESSAGE_CONTENT and ev.delta.startswith("- travel"):
            assert ev.message_id == f"{TID}-sub-m1"
        if ev.type == EventType.TEXT_MESSAGE_CONTENT and ev.delta.startswith("- meal"):
            assert ev.message_id == f"{tid2}-sub-m1"
    a_events = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{TID}-sub"]
    b_events = [ev for ev in out if getattr(ev, "subagent_run_id", None) == f"{tid2}-sub"]
    assert [ev.type for ev in a_events] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]
    assert [ev.type for ev in b_events] == [
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_FINISHED,
    ]
    assert {ev.message_id for ev in a_events if hasattr(ev, "message_id")} == {f"{TID}-sub-m1"}
    assert {ev.message_id for ev in b_events if hasattr(ev, "message_id")} == {f"{tid2}-sub-m1"}


async def test_wrapper_error_path_emits_subagent_error_then_propagates():
    class _Boom(RuntimeError):
        pass

    async def inner(_input):
        yield _run_started()
        yield ToolCallStartEvent(
            type=EventType.TOOL_CALL_START, tool_call_id=TID, tool_call_name="research_policy"
        )
        tid = current_tool_call_id("research_policy")
        delegation_started(tid, "policy_researcher")
        delegation_delta(tid, "- Pre")
        delegation_error(tid, "specialist exploded")
        raise _Boom("specialist exploded")

    agent = wrap_agent_run(_FakeInner(inner))
    out = []
    with pytest.raises(_Boom):
        async for ev in agent.run({"messages": []}):
            out.append(ev)
    # Everything enqueued before the failure was delivered, ending in the
    # SUBAGENT_ERROR (with the open child message closed first).
    assert [ev.type for ev in out] == [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.SUBAGENT_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.SUBAGENT_ERROR,
    ]
    assert out[-1].message == "specialist exploded"


async def test_wrapper_clean_shutdown_on_consumer_break():
    closed = asyncio.Event()

    async def inner(_input):
        try:
            yield _run_started()
            while True:  # endless stream: only a cancel/close ends it
                await asyncio.sleep(0.01)
                yield _run_started()
        finally:
            closed.set()

    agent = wrap_agent_run(_FakeInner(inner))
    gen = agent.run({"messages": []})
    first = await gen.__anext__()
    assert first.type == EventType.RUN_STARTED
    await gen.aclose()  # consumer break / client disconnect

    await asyncio.wait_for(closed.wait(), timeout=1)
    # No orphaned tasks: everything spawned by the wrapper is done.
    pending = [
        t
        for t in asyncio.all_tasks()
        if t is not asyncio.current_task() and not t.done()
    ]
    assert pending == []
    # The ContextVar session was uninstalled.
    assert subagent_emitter._event_queue.get() is None


async def test_wrapper_resets_contextvar_after_normal_completion():
    async def inner(_input):
        yield _run_started()
        yield _run_finished()

    out = await _collect(wrap_agent_run(_FakeInner(inner)))
    assert [ev.type for ev in out] == [EventType.RUN_STARTED, EventType.RUN_FINISHED]
    assert subagent_emitter._event_queue.get() is None


def test_wrap_agent_run_returns_agentframeworkagent_for_endpoint_dispatch():
    fake = _FakeInner(None)
    wrapped = wrap_agent_run(fake)
    assert isinstance(wrapped, SubagentEmittingAgent)
    # The endpoint dispatches on isinstance(agent, AgentFrameworkAgent) and
    # shares the config / approval-state store.
    from agent_framework.ag_ui import AgentFrameworkAgent

    assert isinstance(wrapped, AgentFrameworkAgent)
    assert wrapped.config is fake.config
    assert wrapped._approval_state_store is fake._approval_state_store


def test_server_mounts_the_wrapped_agent():
    from src import server

    # The FastAPI endpoint consumes the wrapped run (protocol_runner is the
    # SubagentEmittingAgent), so SUBAGENT_* events reach the wire.
    assert isinstance(server.wrapped_agent, SubagentEmittingAgent)
