"""Meeting scheduler copilot — AWS Strands backend.

A genuinely non-LangGraph AG-UI backend exercising the neutral Agent
contract surfaces measured in the 2026-08-31 runtime-portability matrix:

- messages: streamed assistant text.
- tool calls: ``check_availability`` executes server-side with no pause.
- shared state: SNAPSHOT-only, and honestly so. The Strands bridge never
  emits STATE_DELTA; outbound state exists only where a tool opts in via
  per-tool ``ToolBehavior`` hooks (``state_from_result`` on
  ``check_availability``, ``state_from_args`` on ``book_meeting``), each of
  which emits a full STATE_SNAPSHOT. Because our adapter applies snapshots
  with replacement semantics, a PARTIAL snapshot would clobber sibling
  state keys — so every hook here returns the COMPLETE state object.
- interrupts: ``book_meeting`` parks in ``tool_context.interrupt(...)``;
  the bridge finishes the run with the protocol-standard
  ``RUN_FINISHED.outcome = {type: 'interrupt', interrupts: [...]}`` and
  resumes from the client's top-level ``resume`` entries keyed by
  ``interruptId`` (never the LangGraph bridge's CUSTOM ``on_interrupt``).

- subagents: ``research_availability`` delegates to a tool-less specialist
  ``availability_researcher`` Agent via an async-generator ``@tool`` that
  re-yields the specialist's ``stream_async`` events; a per-tool
  ``ToolBehavior.tool_stream_event_handler`` (src/subagent_emitter.py)
  translates them into standard ``SUBAGENT_*`` + child ``TEXT_MESSAGE_*``
  wire events. (The bridge natively drops inner text deltas and would
  otherwise route delegation through CUSTOM MultiAgentHandoff + STEP_*;
  multi-agent routes also crash the stale PyPI ``ag-ui-strands`` 0.3.0
  wheel — which is why this example installs ``ag-ui-strands`` 0.4.1 from PyPI, see
  pyproject.toml and docs/wire-capture-subagents.md.)

Model: Strands' native OpenAI provider on plain ``OPENAI_API_KEY`` — no
AWS credentials involved. ``OPENAI_BASE_URL`` is honored, which is how the
aimock e2e harness intercepts model calls. See .env.example.
"""

import json
import os

# Strands wires OpenTelemetry unconditionally and logs exporter noise when
# no collector is listening. Disable the SDK before strands imports. (Env
# override still wins because this is a setdefault; see .env.example.)
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("OTEL_PYTHON_DISABLED_INSTRUMENTATIONS", "all")

from strands import Agent, tool
from strands.models.openai import OpenAIModel
from strands.types.tools import ToolContext

from ag_ui_strands import StrandsAgent, StrandsAgentConfig, ToolBehavior

from .subagent_emitter import emit_subagent_events

_SLOTS = {
    "monday": ["09:00", "13:30"],
    "tuesday": ["10:00", "15:00"],
    "wednesday": ["11:00"],
    "thursday": ["09:30", "14:00", "16:30"],
    "friday": ["10:30"],
}

# region demo-state
# Per-process demo state. The Strands bridge is SNAPSHOT-only: every
# outbound state emission replaces the whole frontend state object, so each
# ToolBehavior hook below composes and returns this COMPLETE object rather
# than just the key it changed — a partial return would wipe the sibling
# key. (Module-level state keeps the demo honest and simple; a real
# deployment would key this per thread.)
_state: dict = {"availability": None, "booking": None}


def _complete_state() -> dict:
    return {"availability": _state["availability"], "booking": _state["booking"]}
# endregion


# region availability-tool
@tool
def check_availability(day: str) -> dict:
    """Look up the open meeting slots for a weekday.

    Args:
        day: Weekday name, e.g. 'Tuesday'.

    Returns:
        A dict with the day and its open slots.
    """
    slots = _SLOTS.get(day.strip().lower(), [])
    return {"day": day, "slots": slots}


async def availability_state(context) -> dict | None:
    """state_from_result hook: mirror the availability lookup into state."""
    result = context.result_data
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except ValueError:
            return None
    if not isinstance(result, dict):
        return None
    _state["availability"] = {"day": result.get("day"), "slots": result.get("slots", [])}
    return _complete_state()
# endregion


# region book-meeting
@tool(context=True)
def book_meeting(topic: str, slot: str, tool_context: ToolContext) -> str:
    """Book a meeting after a human approves it.

    Args:
        topic: Short description of the meeting purpose.
        slot: The chosen slot, e.g. 'Tuesday 10:00'.

    Returns:
        A confirmation (or rejection) sentence.
    """
    answer = tool_context.interrupt(
        "book_meeting",
        reason={"topic": topic, "slot": slot},
    )
    payload = answer.get("response") or {}
    approved = bool(payload.get("approved")) and not (
        answer.get("cancelled") or payload.get("cancelled")
    )
    _state["booking"] = {"topic": topic, "slot": slot, "status": "booked" if approved else "declined"}
    if not approved:
        return f"The human declined. Meeting NOT booked: {topic}"
    return f"Meeting booked for {slot}: {topic}"
# endregion


# region booking-state
async def booking_state(context) -> dict | None:
    """state_from_args hook: mirror the pending booking into state as the
    tool-call arguments finish streaming (before the interrupt pauses the
    run), so the approval UI can render from shared state."""
    tool_input = context.tool_input
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except ValueError:
            return None
    if not isinstance(tool_input, dict):
        return None
    _state["booking"] = {
        "topic": tool_input.get("topic"),
        "slot": tool_input.get("slot"),
        "status": "pending",
    }
    return _complete_state()
# endregion


_RESEARCHER_INSTRUCTIONS = (
    "You are an availability researcher. Given attendee names and a date "
    "range, produce a short bullet summary of likely availability windows. "
    "Be concise: 3 bullets max."
)


# region delegation-tool
@tool
async def research_availability(attendees: str, date_range: str):
    """Delegate availability research for the given attendees to a specialist.

    Args:
        attendees: Comma-separated attendee names, e.g. 'Ada, Grace'.
        date_range: The window to research, e.g. 'next week'.

    Returns:
        The specialist's bullet summary of likely availability windows.
    """
    chunks: list[str] = []
    try:
        async for event in availability_researcher.stream_async(
            f"Attendees: {attendees}\nDate range: {date_range}"
        ):
            if isinstance(event, dict) and isinstance(event.get("data"), str):
                chunks.append(event["data"])
            yield event
    except Exception as exc:  # pragma: no cover - not reachable without a live model failure
        # Surface the failure to the emitter (which owns the SUBAGENT_ERROR
        # wire event), then let the tool error propagate to Strands normally.
        yield {"delegation_error": str(exc)}
        raise
    # Strands takes the LAST yielded value as the tool result.
    yield "".join(chunks)
# endregion


_INSTRUCTIONS = """You are a meeting scheduling copilot.

When the user asks to book a meeting:
1. FIRST call `check_availability` with the requested weekday.
2. THEN call `book_meeting` with the meeting topic and ONE chosen slot in
   the form '<Day> <time>' (e.g. 'Tuesday 10:00'). Do not output prose
   alongside the `book_meeting` call — the user will be shown an approval
   card.
3. After the human approves and the tool returns, confirm in one short
   sentence what was booked, naming the topic and slot.

If the human declines, acknowledge in one short sentence that nothing was
booked.

Keep every response brief and factual. Never invent availability — use the
tool.

When the user asks about attendees' availability, delegate that research to
the `research_availability` tool before proposing meeting slots.
"""


# region model
def build_model() -> OpenAIModel:
    """Strands' native OpenAI provider — plain OPENAI_API_KEY, no AWS creds.

    A placeholder key fails properly at request time (401) instead of at
    module import. OPENAI_BASE_URL redirects the client (used by the aimock
    e2e harness to replay fixtures).
    """
    client_args: dict = {"api_key": os.environ.get("OPENAI_API_KEY", "unset-openai-api-key")}
    base_url = os.environ.get("OPENAI_BASE_URL")
    if base_url:
        client_args["base_url"] = base_url
    return OpenAIModel(client_args=client_args, model_id=os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"))
# endregion


# region specialist
# Tool-less specialist the orchestrator delegates availability research to
# via the `research_availability` async-generator tool above. Its streamed
# events cross the bridge as tool_stream_events and are translated into
# SUBAGENT_* wire events by the emitter registered in ToolBehavior below.
availability_researcher = Agent(
    model=build_model(),
    system_prompt=_RESEARCHER_INSTRUCTIONS,
    name="availability_researcher",
    tools=[],
)
# endregion

# region agent-config
agent = StrandsAgent(
    agent=Agent(
        model=build_model(),
        system_prompt=_INSTRUCTIONS,
        tools=[check_availability, book_meeting, research_availability],
    ),
    name="aws-strands",
    description="Books meetings with availability lookup, shared state, and human approval.",
    config=StrandsAgentConfig(
        tool_behaviors={
            "check_availability": ToolBehavior(state_from_result=availability_state),
            "book_meeting": ToolBehavior(state_from_args=booking_state),
            "research_availability": ToolBehavior(
                tool_stream_event_handler=emit_subagent_events,
            ),
        },
    ),
)
# endregion
