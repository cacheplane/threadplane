"""Chat Subagents Graph — orchestrator LLM with a single `task` tool that
dispatches to specialized aviation subagents (research/booking/itinerary).

Mirrors umbrella's c-subagents. Self-contained: aviation_tools + aviation_data
copied into this module.
"""

import os
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from typing import Annotated

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.constants import TAG_NOSTREAM
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph_sdk import get_client

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# ── generate_title node (inline; matches Pattern D from spec
#     2026-05-19-llm-generated-labels-design.md) ──────────────────────────────

_TITLE_PROMPT = (
    "In 3-5 words, summarize what the user is asking about. "
    "Output ONLY the title — no quotes, no period, no prefix."
)
_TITLE_MODEL = "gpt-5-mini"


async def generate_title(state: MessagesState, config) -> dict:
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


_RESEARCH_PROMPT = """You are a Research Agent for trip planning. Given a task
describing one or more airports, return destination intel about them: city,
typical weather, major terminals, and notable travel considerations. Draw on
general knowledge of the airports named in the task.

Return a concise 2-4 sentence summary. If an airport isn't recognizable, say so."""

_BOOKING_PROMPT = """You are a Booking Agent for trip planning. Given an origin and
destination in the task description, describe realistic flight options between
them: which major carriers fly the route nonstop, typical durations, and rough
fare expectations.

Return a concise summary listing 2-3 plausible options with airline, an example
flight number, times, and price-or-aircraft info."""

_ITINERARY_PROMPT = """You are an Itinerary Agent for trip planning. Synthesize a
final trip plan from the research + booking outputs you receive in the task
description.

Return a clean 3-5 sentence itinerary summarizing the recommended flight choice,
what to expect on arrival (weather), and any practical tips (e.g., terminal info,
buffer time). Be helpful and concise."""


# subagent_type → system prompt. Keyed by the same Literal the `task` tool
# exposes, so one parameterized subgraph serves all three specialists.
_SUBAGENT_PROMPTS: dict[str, str] = {
    "research": _RESEARCH_PROMPT,
    "booking": _BOOKING_PROMPT,
    "itinerary": _ITINERARY_PROMPT,
}


# region subagent-graph
class SubagentState(TypedDict):
    """Child-graph state. `subagent_type` selects the system prompt."""
    messages: Annotated[list, add_messages]
    subagent_type: str
    task_description: str


async def _subagent_node(state: SubagentState) -> dict:
    """Focused subagent: a single role-prompted LLM call. Kept to ONE LLM call
    (no within-subagent tool loop) so each subagent's request has a unique,
    stable discriminator (its role-specific task_description) — this lets the
    aimock e2e replay match it deterministically. The within-subagent tool
    calling is exercised by the dedicated tool-calls cap; here the focus is
    subagent orchestration + the inline subagent card. The returned message
    streams under this subgraph's `tools:<call_id>` namespace, which the
    @threadplane/langgraph SubagentTracker matches to surface the card."""
    subagent_type = state["subagent_type"]
    task_description = state["task_description"]
    system_prompt = _SUBAGENT_PROMPTS.get(subagent_type, _ITINERARY_PROMPT)

    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)
    response = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=task_description),
    ])
    return {"messages": [response]}


# Compiled child graph. Invoking it from inside the `task` tool makes LangGraph
# nest its run under a `tools:<uuid>` namespace, where the uuid is a checkpoint
# id assigned independently — nothing on the wire links it to the `call_*`
# tool-call id. The @threadplane/langgraph SubagentTracker matches this
# namespace to the registered `task` dispatch to surface a card.
_subagent_builder = StateGraph(SubagentState)
_subagent_builder.add_node("subagent", _subagent_node)
_subagent_builder.set_entry_point("subagent")
_subagent_builder.add_edge("subagent", END)
subagent_subgraph = _subagent_builder.compile()
# endregion


def _final_text(messages: list) -> str:
    """Last non-empty string content from the child graph's messages."""
    for msg in reversed(messages or []):
        content = getattr(msg, "content", None)
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            if any(p.strip() for p in parts):
                return "\n".join(parts)
    return "(no subagent output)"


# region announce
def _announce_subagent(config, tool_call_id: str) -> None:
    """Bind this tool call's child stream to its tool-call id, for the UI.

    LangGraph streams the child under a `tools:<uuid>` namespace whose uuid is
    a checkpoint id — nothing on the wire links it to the `call_*` id, so a
    frontend showing per-subagent progress would otherwise have to guess.
    Inside the tool body both halves are known; emit them as one custom event
    that `@threadplane/langgraph` recognizes.

    Inlined per the cockpit standalone rule — the canonical helper is
    `threadplane.middleware.langgraph.announce_subagent`.
    """
    if not tool_call_id:
        return
    meta = dict((config or {}).get("metadata") or {})
    namespace = meta.get("checkpoint_ns")
    if not namespace:
        return
    try:
        from langgraph.config import get_stream_writer

        get_stream_writer()(
            {
                "type": "threadplane.subagent_binding",
                "namespace": namespace,
                "tool_call_id": tool_call_id,
            }
        )
    except Exception:
        pass
# endregion


# region task-tool
@tool
async def task(
    subagent_type: Literal["research", "booking", "itinerary"],
    task_description: str,
    tool_call_id: Annotated[str, InjectedToolCallId] = None,
    config: RunnableConfig = None,
) -> str:
    """Delegate a subtask to a specialized subagent subgraph.

    Args:
        subagent_type: Which specialist to dispatch — "research" (airport /
            destination intel), "booking" (flight options between origin and
            destination), or "itinerary" (final trip plan synthesizing research
            + bookings). This label also identifies the subagent in the UI.
        task_description: Plain-English description of what the subagent should
            do (e.g., "Gather info on LAX and JFK airports").

    Returns:
        The subagent's final answer as a string.
    """
    _announce_subagent(config, tool_call_id)
    result = await subagent_subgraph.ainvoke(
        {"subagent_type": subagent_type, "task_description": task_description, "messages": []}
    )
    messages = result.get("messages") if isinstance(result, dict) else None
    return _final_text(messages)
# endregion


# region orchestrator
def build_subagents_graph():
    """Orchestrator LLM with a single `task` tool that dispatches to subagent functions."""
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True).bind_tools([task])

    async def orchestrator(state: MessagesState) -> dict:
        system_prompt = (PROMPTS_DIR / "subagents.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("orchestrator", orchestrator)
    graph.add_node("tools", ToolNode([task]))
    graph.add_node("generate_title", generate_title)
    graph.set_entry_point("orchestrator")
    graph.add_conditional_edges("orchestrator", should_continue, {"tools": "tools", END: "generate_title"})
    graph.add_edge("tools", "orchestrator")
    graph.add_edge("generate_title", END)
    return graph.compile()
# endregion


graph = build_subagents_graph()
