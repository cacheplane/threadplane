"""SUBAGENT_* emitter for the `research_policy` delegation tool.

The MAF AG-UI bridge is a pure pull-driven async generator with no writer a
tool body could reach: the specialist's streamed updates are consumed
entirely inside the tool and only the return string surfaces (as
TOOL_CALL_RESULT). Measured in docs/wire-capture-subagents.md, which also
names the injection seam implemented here: wrap ``AgentFrameworkAgent.run``
— the exact method the FastAPI endpoint consumes (`_endpoint.py:212`) —
with a queue-merge generator.

How the seam works (``SubagentEmittingAgent`` / ``wrap_agent_run``):

1. ``run()`` creates an ``asyncio.Queue`` and publishes it (plus a small
   correlation map) through a module-level ``ContextVar``. The delegation
   tool executes on the same async call chain, so the value propagates
   into the tool body.
2. A pump task drains the inner bridge generator into that queue. This is
   required for LIVE interleaving: while the tool runs, the bridge
   generator is suspended awaiting the next provider update, so a naive
   "drain between inner yields" design would batch every child delta until
   the tool returned. With the pump-task merge, a ``put_nowait`` from the
   tool body wakes the outer consumer immediately.
3. The tool body calls the ``delegation_*`` helpers below, which build the
   typed ``ag_ui.core`` events and enqueue them:

       SUBAGENT_STARTED {subagentRunId: <tid>-sub, parentToolCallId: <tid>}
       TEXT_MESSAGE_START/CONTENT.../END   (streamed specialist deltas)
       SUBAGENT_FINISHED outcome=success   (or SUBAGENT_ERROR on failure)

Correlation: the pump appends every TOOL_CALL_START's ``toolCallId`` to a
per-tool-name FIFO as it passes through the queue, and each tool body pops
the oldest via ``current_tool_call_id`` — so a multi-tool batch calling the
same tool twice (MAF runs batches concurrently via ``asyncio.gather``, and
the bridge streams all TOOL_CALL_STARTs first) gives each invocation its
own tid and its own delegation. The bridge yields TOOL_CALL_START (and the
ARGS deltas) for the delegation call BEFORE the framework invokes the tool
on the same driving chain, so the FIFO is deterministically populated by
the time the tool body runs; TOOL_CALL_END arrives only AFTER the tool
returns (measured wire order — the SUBAGENT_* sequence lands between ARGS
and END), which is why correlation relies on START alone. If a caller ever
invokes the tool outside
the wrapped run, the helpers fall back to a generated ``sub-<hex8>`` run id
with ``parentToolCallId`` omitted — and with no queue at all they are pure
no-ops, which is what keeps unit tests and direct agent runs side-effect
free.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator

from ag_ui.core import (
    BaseEvent,
    EventType,
    SubagentErrorEvent,
    SubagentFinishedEvent,
    SubagentFinishedSuccessOutcome,
    SubagentStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from agent_framework.ag_ui import AgentFrameworkAgent

DELEGATION_TOOL_NAME = "research_policy"


@dataclass
class _Delegation:
    """Lifecycle of one delegation call, keyed by parent tool-call id."""

    run_id: str
    message_id: str
    message_open: bool = False
    finished: bool = False


@dataclass
class _EmitterSession:
    """Per-run channel shared between the run wrapper and the tool body."""

    queue: asyncio.Queue[Any]
    # Per-tool-name FIFO of not-yet-claimed TOOL_CALL_START toolCallIds:
    # the pump appends, each tool body pops the oldest — one tid per call
    # even when a batch invokes the same tool twice.
    tool_call_ids: dict[str, list[str]] = field(default_factory=dict)
    runs: dict[str | None, _Delegation] = field(default_factory=dict)


_event_queue: ContextVar[_EmitterSession | None] = ContextVar(
    "maf_subagent_emitter_session", default=None
)


def current_tool_call_id(tool_name: str) -> str | None:
    """Claim the oldest unclaimed TOOL_CALL_START toolCallId for a tool.

    Pops from the per-name FIFO the pump fills, so each concurrent
    invocation of the same tool gets its own tid. Deterministically
    populated before the tool body runs (see module docstring); ``None``
    outside a wrapped run.
    """
    session = _event_queue.get()
    if session is None:
        return None
    pending = session.tool_call_ids.get(tool_name)
    if not pending:
        return None
    return pending.pop(0)


def emit(event: BaseEvent) -> None:
    """Enqueue one AG-UI event onto the live run stream; no-op unwrapped."""
    session = _event_queue.get()
    if session is not None:
        session.queue.put_nowait(event)


def delegation_started(tid: str | None, name: str) -> None:
    """Announce the specialist run. Ids derive from the delegation tool-call
    id; without one (unwrapped fallback) a ``sub-<hex8>`` run id is generated
    and ``parentToolCallId`` omitted."""
    session = _event_queue.get()
    run_id = f"{tid}-sub" if tid else f"sub-{uuid.uuid4().hex[:8]}"
    if session is not None:
        session.runs[tid] = _Delegation(run_id=run_id, message_id=f"{run_id}-m1")
    emit(
        SubagentStartedEvent(
            type=EventType.SUBAGENT_STARTED,
            subagent_run_id=run_id,
            name=name,
            parent_tool_call_id=tid,
        )
    )


def _active(tid: str | None) -> _Delegation | None:
    session = _event_queue.get()
    if session is None:
        return None
    delegation = session.runs.get(tid)
    if delegation is None or delegation.finished:
        return None
    return delegation


def delegation_delta(tid: str | None, text: str) -> None:
    """Stream one specialist text delta, lazily opening the attributed
    message (so a zero-delta run emits no empty message)."""
    delegation = _active(tid)
    if delegation is None or not text:
        return
    if not delegation.message_open:
        delegation.message_open = True
        emit(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=delegation.message_id,
                role="assistant",
                subagent_run_id=delegation.run_id,
            )
        )
    emit(
        TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id=delegation.message_id,
            delta=text,
            subagent_run_id=delegation.run_id,
        )
    )


def _close_message(delegation: _Delegation) -> None:
    if delegation.message_open:
        delegation.message_open = False
        emit(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=delegation.message_id,
                subagent_run_id=delegation.run_id,
            )
        )


def delegation_finished(tid: str | None) -> None:
    """Close the open child message and finish the subagent with success."""
    delegation = _active(tid)
    if delegation is None:
        return
    delegation.finished = True
    _close_message(delegation)
    emit(
        SubagentFinishedEvent(
            type=EventType.SUBAGENT_FINISHED,
            subagent_run_id=delegation.run_id,
            outcome=SubagentFinishedSuccessOutcome(),
        )
    )


def delegation_error(tid: str | None, message: str) -> None:
    """Close the open child message and report the specialist failure. The
    tool re-raises afterwards, so the bridge's own tool-error path still
    runs normally."""
    delegation = _active(tid)
    if delegation is None:
        return
    delegation.finished = True
    _close_message(delegation)
    emit(
        SubagentErrorEvent(
            type=EventType.SUBAGENT_ERROR,
            subagent_run_id=delegation.run_id,
            message=message,
        )
    )


class _PumpFailure:
    """Sentinel carrying an inner-generator exception across the queue."""

    def __init__(self, exc: BaseException) -> None:
        self.exc = exc


_DONE = object()


def _record_tool_call(session: _EmitterSession, event: Any) -> None:
    if getattr(event, "type", None) == EventType.TOOL_CALL_START:
        session.tool_call_ids.setdefault(event.tool_call_name, []).append(
            event.tool_call_id
        )


class SubagentEmittingAgent(AgentFrameworkAgent):
    """AgentFrameworkAgent whose ``run`` merges tool-enqueued SUBAGENT_*
    events into the bridge stream via the pump-task queue.

    Constructed from an already-configured ``AgentFrameworkAgent`` (shares
    its config and approval-state store rather than re-running ``__init__``),
    so the endpoint's ``isinstance(agent, AgentFrameworkAgent)`` dispatch
    and approval resume flow are untouched.
    """

    def __init__(self, inner: AgentFrameworkAgent) -> None:
        self._inner = inner
        self.agent = inner.agent
        self.name = inner.name
        self.description = inner.description
        self.config = inner.config
        self._approval_state_store = inner._approval_state_store

    async def run(
        self, input_data: dict[str, Any]
    ) -> AsyncGenerator[BaseEvent, None]:
        queue: asyncio.Queue[Any] = asyncio.Queue()
        session = _EmitterSession(queue=queue)
        token = _event_queue.set(session)
        inner_gen = self._inner.run(input_data)

        async def _pump() -> None:
            try:
                async for event in inner_gen:
                    _record_tool_call(session, event)
                    queue.put_nowait(event)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # propagate to the consumer, never swallow
                queue.put_nowait(_PumpFailure(exc))
            else:
                queue.put_nowait(_DONE)

        # create_task copies the current context AFTER the ContextVar set,
        # so the tool body (which executes on the pump's driving chain)
        # sees this session.
        pump = asyncio.create_task(_pump())
        try:
            while True:
                item = await queue.get()
                if item is _DONE:
                    break
                if isinstance(item, _PumpFailure):
                    raise item.exc
                yield item
        finally:
            # Consumer break / client disconnect (GeneratorExit) or pump
            # failure: cancel and await the pump so no task is orphaned,
            # then close the inner generator.
            pump.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pump
            with contextlib.suppress(Exception):
                await inner_gen.aclose()
            # reset raises ValueError if a GC-driven aclose runs the finally
            # in a different context than the one that set the var.
            with contextlib.suppress(ValueError):
                _event_queue.reset(token)


def wrap_agent_run(agent: AgentFrameworkAgent) -> SubagentEmittingAgent:
    """Wrap an AgentFrameworkAgent so its run stream carries SUBAGENT_*."""
    return SubagentEmittingAgent(agent)
