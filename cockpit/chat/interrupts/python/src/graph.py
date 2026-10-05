"""Chat Interrupts Graph — agent ↔ ToolNode loop with book_flight (interrupt).

Self-contained: aviation_tools + aviation_data copied into this module.
The book_flight tool raises interrupt({...}) before completing the booking,
so the chat-interrupt-panel renders and the user can Accept or Ignore.
"""

import os
from pathlib import Path
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt
from langgraph.constants import TAG_NOSTREAM
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph_sdk import get_client

from src.aviation_tools import (
    get_airport_info,
    find_routes,
    lookup_flight,
)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
MODEL = "gpt-5-mini"

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


# region book-flight
@tool
async def book_flight(flight_number: str) -> str:
    """Book a flight by flight number. Pauses for human confirmation.

    Use this tool when the user explicitly asks to book a specific flight.
    The tool raises a LangGraph interrupt so the UI can render an
    approval card; on resume, it returns a confirmation or cancellation
    message.

    Args:
        flight_number: Flight number like 'AA123' or 'UA456'.

    Returns:
        A short booking confirmation or cancellation message.
    """
    flight = await lookup_flight.ainvoke({"flight_number": flight_number})
    if "error" in flight:
        return f"Cannot book {flight_number}: {flight['error']}."

    summary = (
        f"Book {flight['airline']} {flight['flight_number']} from "
        f"{flight['from']} to {flight['to']} "
        f"(departs {flight['depart_local']}, {flight['aircraft']})?"
    )
    response = interrupt({
        "type": "approval_request",
        "summary": summary,
        "flight": flight,
    })

    decision = str(response).strip().lower()
    if decision.startswith("confirm"):
        return (
            f"Booked {flight['airline']} {flight['flight_number']} from "
            f"{flight['from']} to {flight['to']} "
            f"(departs {flight['depart_local']})."
        )
    return "Booking cancelled."
# endregion


# region graph
def build_interrupts_graph():
    """Agent ↔ ToolNode loop with aviation read tools + book_flight (interrupt)."""
    tools = [book_flight, find_routes, lookup_flight, get_airport_info]
    llm = ChatOpenAI(model=MODEL, streaming=True).bind_tools(tools)

    async def agent(state: MessagesState) -> dict:
        system_prompt = (PROMPTS_DIR / "interrupts.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent)
    graph.add_node("tools", ToolNode(tools))
    graph.add_node("generate_title", generate_title)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: "generate_title"})
    graph.add_edge("tools", "agent")
    graph.add_edge("generate_title", END)
    return graph.compile()
# endregion


graph = build_interrupts_graph()
