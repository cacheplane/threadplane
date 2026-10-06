"""
Chat Timeline Graph

A standard conversational agent. Timeline and checkpoint navigation
is managed by the agent() ref on the frontend side.
"""

import os
from pathlib import Path
from typing import NotRequired
from langgraph.constants import TAG_NOSTREAM
from langgraph.graph import StateGraph, MessagesState, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph_sdk import get_client

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class TimelineState(MessagesState):
    """Canonical final identities let clients verify adopted history."""

    completed_turn_id: NotRequired[str]
    completed_answer_id: NotRequired[str]
    completed_message_ids: NotRequired[list[str]]

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


# region conversation-graph
def build_timeline_graph():
    """
    Constructs a standard conversational agent.
    Timeline/history navigation is handled by the Angular agent() frontend.
    """
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)

    async def generate(state: TimelineState) -> dict:
        system_prompt = (PROMPTS_DIR / "timeline.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        canonical = [*state["messages"], response]
        ids = [getattr(message, "id", None) for message in canonical]
        completion = {}
        if (len(canonical) >= 2
                and getattr(canonical[-2], "type", None) == "human"
                and getattr(response, "type", None) == "ai"
                and all(isinstance(identity, str) and identity for identity in ids)
                and len(ids) == len(set(ids))):
            completion = {
                "completed_turn_id": ids[-2],
                "completed_answer_id": ids[-1],
                "completed_message_ids": ids,
            }
        return {"messages": [response], **completion}

    graph = StateGraph(TimelineState)
    graph.add_node("generate", generate)
    graph.add_node("generate_title", generate_title)
    graph.set_entry_point("generate")
    graph.add_edge("generate", "generate_title")
    graph.add_edge("generate_title", END)

    return graph.compile()


# endregion


graph = build_timeline_graph()
