"""Single-node agentic graph for the airline operations KPI dashboard.

Flow:
  START → agent ↔ tools → wrap_spec_into_ai → agent (loop) → emit_state → respond → END

`agent` is a single LLM call with all 5 tools bound (render_spec + 4 data
tools). After tools run, `wrap_spec_into_ai` post-processes — if the LLM
called render_spec, it replaces the parent AI message's content with the
spec JSON (in place via add_messages' id-match reducer) so the chat-lib's
content-classifier mounts <chat-generative-ui>. Then loops back to agent
until the LLM returns no tool_calls (cap _MAX_TOOL_ITERATIONS per turn).

Mirrors the emit_generated_surface pattern from examples/chat/python/src/graph.py,
adapted for a continuation loop instead of terminal dispatch.
"""

import json
import os
from copy import deepcopy
from math import isfinite
from pathlib import Path
from typing import Literal, NotRequired

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode
from langgraph.constants import TAG_NOSTREAM
from langgraph_sdk import get_client

from src.dashboard_tools import ALL_TOOLS as _DATA_TOOLS

_PROMPT = (Path(__file__).parent.parent / "prompts" / "generative-ui.md").read_text()

_MAX_TOOL_ITERATIONS = 6


class DashboardState(MessagesState):
    """Layouts live in messages; owned data and completion survive checkpoints."""
    dashboard: NotRequired[dict]
    completed_turn_id: NotRequired[str | None]
    completed_answer_id: NotRequired[str | None]
    completed_message_ids: NotRequired[list[str] | None]
    _submitted_turn_id: NotRequired[str | None]


def prepare_turn(state: DashboardState) -> dict:
    """Capture the submitted human before tools append intermediate messages."""
    last = state["messages"][-1] if state["messages"] else None
    return {
        "_submitted_turn_id": last.id if isinstance(last, HumanMessage) else None,
        "completed_turn_id": None,
        "completed_answer_id": None,
        "completed_message_ids": None,
    }


# region render-spec-tool
@tool
async def render_spec(elements: dict, root: str) -> str:
    """Render an interactive dashboard layout.

    Use this tool to author or update the dashboard layout. See the system
    prompt for the full component catalog and state binding conventions.

    Call this tool AT MOST ONCE per turn — only when the layout needs to
    be created (first turn) or restructured (follow-up structural change).
    Do NOT call it again to refresh data; the data tools handle that.

    Args:
        elements: Dict keyed by component id. Each value has `type`, optional
            `props`, and optional `children` (list of component ids).
        root: The id of the top-level component (must be a key in `elements`).

    Returns:
        The spec serialized as JSON. A post-process node (wrap_spec_into_ai)
        wraps this payload into the AI message content where the
        chat-lib's content-classifier picks it up.
    """
    return json.dumps({"elements": elements, "root": root})
# endregion


_ALL_TOOLS = [render_spec, *_DATA_TOOLS]

_llm_with_tools = ChatOpenAI(
    model="gpt-5",
    temperature=0,
    streaming=True,
    reasoning_effort="minimal",
).bind_tools(_ALL_TOOLS)

_respond_llm = ChatOpenAI(model="gpt-5-mini", temperature=0, streaming=True)

# ── generate_title node (inline; matches Pattern D from spec
#     2026-05-19-llm-generated-labels-design.md) ──────────────────────────────

_TITLE_PROMPT = (
    "In 3-5 words, summarize what the user is asking about. "
    "Output ONLY the title — no quotes, no period, no prefix."
)
_TITLE_MODEL = "gpt-5-mini"


async def generate_title(state: DashboardState, config) -> dict:
    """Background title generation: on the first turn, summarize the user's
    intent into 3-5 words and persist to LangGraph thread metadata.

    Idempotent — skips when metadata.title already exists. Errors are
    swallowed because the title is a UX nicety, never a blocker.
    """
    thread_id = (config.get("configurable") or {}).get("thread_id")
    if not thread_id:
        return {}
    sdk_url = os.environ.get("LANGGRAPH_API_URL")
    try:
        client = get_client(url=sdk_url)
        thread = await client.threads.get(thread_id)
        if (thread.get("metadata") or {}).get("title"):
            return {}
        first_user = next(
            (m for m in state["messages"] if getattr(m, "type", None) == "human"),
            None,
        )
        if not first_user or not isinstance(first_user.content, str):
            return {}
        if first_user.content.lstrip().startswith("{"):
            return {}
        llm = ChatOpenAI(model=_TITLE_MODEL, temperature=0, tags=[TAG_NOSTREAM])
        response = await llm.ainvoke([
            SystemMessage(content=_TITLE_PROMPT),
            HumanMessage(content=first_user.content),
        ])
        title = (response.content or "").strip().strip('"').strip("'")[:80]
        if title:
            await client.threads.update(thread_id, metadata={"title": title})
    except Exception as e:  # noqa: BLE001 — title is a UX nicety; never block
        print(
            f"[generate_title] failed for thread {thread_id}: "
            f"{type(e).__name__}: {e}",
            flush=True,
        )
    return {}


async def agent(state: DashboardState) -> dict:
    """Single agentic node: LLM bound with all 5 tools."""
    messages = [SystemMessage(content=_PROMPT)] + state["messages"]
    response = await _llm_with_tools.ainvoke(messages)
    return {"messages": [response]}


def should_continue(state: DashboardState) -> Literal["tools", "finalize", "emit_state"]:
    """Loop while the agent emits tool_calls, up to _MAX_TOOL_ITERATIONS
    this turn. After the cap, route through `finalize` (strips orphan
    tool_calls from the last AI message) before emit_state — otherwise
    `respond`'s LLM call rejects the message history because the AI
    message had tool_calls without matching ToolMessages."""
    last = state["messages"][-1]
    if not (hasattr(last, "tool_calls") and last.tool_calls):
        return "emit_state"

    iter_count = 0
    for msg in reversed(state["messages"]):
        if msg.type == "human":
            break
        if msg.type == "ai" and getattr(msg, "tool_calls", None):
            iter_count += 1
    if iter_count >= _MAX_TOOL_ITERATIONS:
        return "finalize"
    return "tools"


async def finalize(state: DashboardState) -> dict:
    """Strip tool_calls from the last AI message when the iteration cap
    is hit, so respond's LLM call doesn't fail with 'tool_calls without
    matching ToolMessage' errors. Replaces in place via add_messages
    id-match reducer."""
    last = state["messages"][-1]
    if not (isinstance(last, AIMessage) and last.tool_calls):
        return {}
    replacement_kwargs: dict = {
        "content": last.content or "(iteration cap reached)",
        "additional_kwargs": last.additional_kwargs or {},
        "response_metadata": last.response_metadata or {},
    }
    if getattr(last, "id", None):
        replacement_kwargs["id"] = last.id
    return {"messages": [AIMessage(**replacement_kwargs)]}


# region wrap-spec-into-ai
async def wrap_spec_into_ai(state: DashboardState) -> dict:
    """Post-process that wraps the most recent render_spec ToolMessage
    payload into the parent AI tool-call message's content (in place via
    LangGraph's add_messages reducer matching by id). The chat-lib's
    content-classifier then sees content starting with `{` and mounts
    <chat-generative-ui>.

    Idempotent: if the parent AI message already has non-empty content
    (already wrapped on a prior iteration), no-op. Also no-op if there
    is no render_spec ToolMessage to process.

    Mirrors emit_generated_surface from examples/chat/python/src/graph.py,
    adapted to loop back to `agent` instead of going to END.
    """
    msgs = state["messages"]

    render_tool_msg: ToolMessage | None = None
    parent_ai: AIMessage | None = None
    for m in reversed(msgs):
        if isinstance(m, ToolMessage) and m.name == "render_spec":
            render_tool_msg = m
            for prior in reversed(msgs):
                if isinstance(prior, AIMessage) and prior.tool_calls:
                    if any(tc.get("id") == render_tool_msg.tool_call_id for tc in prior.tool_calls):
                        parent_ai = prior
                        break
            break

    if render_tool_msg is None or parent_ai is None:
        return {}
# endregion

# region rewrite-message-content
    existing = parent_ai.content
    if isinstance(existing, str) and existing.strip():
        return {}

    payload = render_tool_msg.content if isinstance(render_tool_msg.content, str) else ""
    if not payload:
        return {}

    stripped = payload.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        stripped = "\n".join(line for line in lines if not line.startswith("```")).strip()

    out: list = []

    placeholder_kwargs: dict = {
        "content": "rendered",
        "tool_call_id": render_tool_msg.tool_call_id,
        "name": "render_spec",
    }
    if getattr(render_tool_msg, "id", None):
        placeholder_kwargs["id"] = render_tool_msg.id
    out.append(ToolMessage(**placeholder_kwargs))

    replacement_kwargs: dict = {
        "content": stripped,
        "tool_calls": parent_ai.tool_calls,
        "additional_kwargs": parent_ai.additional_kwargs or {},
        "response_metadata": parent_ai.response_metadata or {},
    }
    if getattr(parent_ai, "id", None):
        replacement_kwargs["id"] = parent_ai.id
    out.append(AIMessage(**replacement_kwargs))

    return {"messages": out}
# endregion


# region emit-state
def _data_slots(name: str, data) -> dict:
    """Accept only the four data tools' successful fixture-shaped payloads."""
    def number(value):
        try:
            return type(value) in (int, float) and isfinite(value)
        except OverflowError:
            return False

    if name == "query_airline_kpis":
        fields = {"on_time", "flights_today", "avg_delay", "load_factor"}
        if not isinstance(data, dict) or not data or not set(data) <= fields:
            return {}
        for value in data.values():
            if (not isinstance(value, dict) or set(value) != {"value", "delta"}
                    or not isinstance(value["delta"], str)
                    or not (isinstance(value["value"], str) or number(value["value"]))):
                return {}
        return deepcopy(data)

    contracts = {
        "query_on_time_trend": ("on_time_trend", {"month": str, "on_time_pct": number}),
        "query_flights_by_airline": ("flights_by_airline", {"airline": str, "count": number}),
        "query_recent_disruptions": ("recent_disruptions", {
            "flight_number": str, "type": str, "minutes": number, "route": str, "date": str}),
    }
    if name not in contracts or not isinstance(data, list):
        return {}
    slot, fields = contracts[name]
    for row in data:
        if not isinstance(row, dict) or set(row) != set(fields):
            return {}
        if any(not (isinstance(row[key], str) if check is str else check(row[key]))
               for key, check in fields.items()):
            return {}
    return {slot: deepcopy(data)}


async def emit_state(state: DashboardState) -> dict:
    """Persist current-turn data and emit equivalent Angular state patches.

    Traverse in transcript order so the newest successful result for a slot
    wins. Prior-turn results never replay; untouched prior slots are retained.
    """
    from langgraph.config import get_stream_writer

    messages = state["messages"]
    start = next((i + 1 for i in range(len(messages) - 1, -1, -1)
                  if isinstance(messages[i], HumanMessage)), len(messages))
    slots: dict = {}
    for msg in messages[start:]:
        if not isinstance(msg, ToolMessage) or msg.status != "success":
            continue
        try:
            data = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
        except (json.JSONDecodeError, TypeError):
            continue
        slots.update(_data_slots(msg.name, data))

    dashboard = deepcopy(state.get("dashboard") or {})
    dashboard.update(slots)
    if slots:
        patches = {}
        for key, value in slots.items():
            if isinstance(value, dict):
                patches.update({f"/{key}/{field}": deepcopy(item) for field, item in value.items()})
            else:
                patches[f"/{key}"] = deepcopy(value)
        writer = get_stream_writer()
        writer({"name": "state_update", "data": patches})

    return {"dashboard": dashboard}
# endregion


async def respond(state: DashboardState) -> dict:
    """Generate a brief conversational summary of what just happened on
    this turn. ALWAYS runs (no early-exit)."""
    messages = [
        SystemMessage(content=(
            "Provide a brief (1-2 sentence) conversational summary of what "
            "you just did this turn. If you generated a dashboard, say so. "
            "If you filtered data, say what you filtered. "
            "Do NOT output JSON. Do NOT ask follow-up questions."
        ))
    ] + state["messages"]
    response = await _respond_llm.ainvoke(messages)
    canonical = [*state["messages"], response]
    ids = [getattr(message, "id", None) for message in canonical]
    human = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
    completion = {}
    if (human is not None and human.id == state.get("_submitted_turn_id")
            and isinstance(response, AIMessage)
            and all(isinstance(identity, str) and identity for identity in ids)
            and len(ids) == len(set(ids))):
        completion = {
            "completed_turn_id": human.id,
            "completed_answer_id": response.id,
            "completed_message_ids": ids,
        }
    return {"messages": [response], **completion}


# region graph-wiring
_builder = StateGraph(DashboardState)
_builder.add_node("prepare_turn", prepare_turn)
_builder.add_node("agent", agent)
_builder.add_node("tools", ToolNode(_ALL_TOOLS))
_builder.add_node("wrap_spec_into_ai", wrap_spec_into_ai)
_builder.add_node("finalize", finalize)
_builder.add_node("emit_state", emit_state)
_builder.add_node("respond", respond)
_builder.add_node("generate_title", generate_title)

_builder.set_entry_point("prepare_turn")
_builder.add_edge("prepare_turn", "agent")
_builder.add_conditional_edges("agent", should_continue)
_builder.add_edge("tools", "wrap_spec_into_ai")
_builder.add_edge("wrap_spec_into_ai", "agent")
_builder.add_edge("finalize", "emit_state")
_builder.add_edge("emit_state", "respond")
_builder.add_edge("respond", "generate_title")
_builder.add_edge("generate_title", END)

graph = _builder.compile()
# endregion
