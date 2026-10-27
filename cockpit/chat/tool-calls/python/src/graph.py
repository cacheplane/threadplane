"""Chat Tool-Calls Graph — canonical agent ↔ ToolNode loop with aviation tools.

Mirrors umbrella's c-tool-calls. Self-contained: aviation_tools + aviation_data
copied into this module.
"""

import os
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode
from langgraph.constants import TAG_NOSTREAM
from langgraph_sdk import get_client

from src.aviation_tools import ALL_TOOLS as AVIATION_TOOLS

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


def build_tool_calls_graph():
    """Canonical agent ↔ ToolNode loop with aviation tools bound."""
    # region bind-tools
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True).bind_tools(AVIATION_TOOLS)

    async def agent(state: MessagesState) -> dict:
        system_prompt = (PROMPTS_DIR / "tool-calls.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    # endregion

    # region tool-loop
    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent)
    graph.add_node("tools", ToolNode(AVIATION_TOOLS))
    graph.add_node("generate_title", generate_title)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: "generate_title"})
    graph.add_edge("tools", "agent")
    graph.add_edge("generate_title", END)

    return graph.compile()
    # endregion


graph = build_tool_calls_graph()
