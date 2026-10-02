"""Full airline-operations KPI dashboard graph for the ag-ui/json-render example.

Port of cockpit/chat/generative-ui/python/src/graph.py, adapted so dashboard
data lands in graph state (which ag-ui-langgraph auto-emits as STATE_SNAPSHOT)
instead of get_stream_writer (which does NOT survive the ag-ui-langgraph
runtime).

Flow:
  START → agent ↔ tools → wrap_spec_into_ai → agent (loop) → emit_state → respond → generate_title → END

`agent` is a single LLM call with all 5 tools bound (render_spec + 4 data
tools). After tools run, `wrap_spec_into_ai` post-processes — if the LLM
called render_spec, it replaces the parent AI message's content with the
spec JSON (in place via add_messages' id-match reducer) so the chat-lib's
content-classifier mounts <chat-generative-ui>. Then loops back to agent
until the LLM returns no tool_calls (cap _MAX_TOOL_ITERATIONS per turn).

emit_state walks the message history for this turn and returns the tool
results as top-level state fields — ag-ui-langgraph emits them as
STATE_SNAPSHOT; the Angular chat-lib effect syncs them into the explicit
[store] the app passes to <chat>, where the spec's $state bindings
resolve them.
"""

import json
import os
from pathlib import Path
from typing import Literal, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph_sdk import get_client
from typing_extensions import Annotated, TypedDict

from .dashboard_tools import ALL_TOOLS as _DATA_TOOLS

_PROMPT = (Path(__file__).parent.parent / "prompts" / "json-render.md").read_text()

_MAX_TOOL_ITERATIONS = 6


# region dashboard-state
class DashboardState(TypedDict):
    """Graph state for the airline KPI dashboard.

    Data fields are declared here so ag-ui-langgraph includes them in the
    STATE_SNAPSHOT emitted to the client. The Angular sync effect maps each
    top-level key k → /k in the render store, so spec $state bindings like
    /on_time/value resolve correctly.
    """
    messages: Annotated[list, add_messages]
    on_time: Optional[dict]
    flights_today: Optional[dict]
    avg_delay: Optional[dict]
    load_factor: Optional[dict]
    on_time_trend: Optional[list]
    flights_by_airline: Optional[list]
    recent_disruptions: Optional[list]
# endregion

# region render-spec-tool
@tool
async def render_spec(elements: dict, root: str, tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
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
        A stable tool message containing the spec serialized as JSON.
        A post-process node (wrap_spec_into_ai)
        wraps this payload into the AI message content where the
        chat-lib's content-classifier picks it up.
    """
    return ToolMessage(
        id=tool_call_id,
        tool_call_id=tool_call_id,
        name="render_spec",
        content=json.dumps({"elements": elements, "root": root}),
    )
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
        llm = ChatOpenAI(model=_TITLE_MODEL, temperature=0)
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

    existing = parent_ai.content
    if isinstance(existing, str) and existing.strip():
        return {}

    payload = render_tool_msg.content if isinstance(render_tool_msg.content, str) else ""
    if not payload:
        return {}
# endregion

    # region rewrite-assistant-content
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
async def emit_state(state: DashboardState) -> dict:
    """Accumulate this turn's tool results into graph state so ag-ui-langgraph
    emits them as STATE_SNAPSHOT. Walk messages in reverse to the most recent
    human turn; map each known data tool to its state field(s).
    query_airline_kpis returns the four nested *_card sections; merge directly."""
    updates: dict = {}
    for msg in reversed(state["messages"]):
        if getattr(msg, "type", None) == "tool":
            try:
                data = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
            except (json.JSONDecodeError, TypeError):
                continue
            if msg.name == "query_airline_kpis" and isinstance(data, dict):
                updates.update(data)  # {on_time:{...}, flights_today:{...}, avg_delay:{...}, load_factor:{...}}
            elif msg.name == "query_on_time_trend":
                updates["on_time_trend"] = data
            elif msg.name == "query_flights_by_airline":
                updates["flights_by_airline"] = data
            elif msg.name == "query_recent_disruptions":
                updates["recent_disruptions"] = data
        elif getattr(msg, "type", None) == "human":
            break
    return updates
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
    return {"messages": [response]}


# region graph-wiring
_builder = StateGraph(DashboardState)
_builder.add_node("agent", agent)
_builder.add_node("tools", ToolNode(_ALL_TOOLS))
_builder.add_node("wrap_spec_into_ai", wrap_spec_into_ai)
_builder.add_node("finalize", finalize)
_builder.add_node("emit_state", emit_state)
_builder.add_node("respond", respond)
_builder.add_node("generate_title", generate_title)

_builder.set_entry_point("agent")
_builder.add_conditional_edges("agent", should_continue)
_builder.add_edge("tools", "wrap_spec_into_ai")
_builder.add_edge("wrap_spec_into_ai", "agent")
_builder.add_edge("finalize", "emit_state")
_builder.add_edge("emit_state", "respond")
_builder.add_edge("respond", "generate_title")
_builder.add_edge("generate_title", END)

# ag-ui-langgraph requires a checkpointer to manage thread state.
# The chat example omits it because LangGraph Cloud provides one at runtime,
# but the ag-ui-langgraph/uvicorn runtime needs it explicitly.
graph = _builder.compile(checkpointer=MemorySaver())
# endregion
