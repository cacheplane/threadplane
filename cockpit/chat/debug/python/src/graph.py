"""
Chat Debug Graph

A multi-step agent (generate -> process -> summarize) that produces
interesting debug data for inspecting with the ChatDebugComponent.
Multiple nodes create rich state transitions for the debug panel.
"""

import os
from pathlib import Path
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.constants import TAG_NOSTREAM
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
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


# region debug-state
class DebugState(MessagesState):
    """MessagesState plus the metrics `process` computes.

    The devtools State tab pretty-prints whatever the graph keeps in state.
    A graph that only carries `messages` has nothing to show there, because
    the transcript is rendered as the conversation rather than as state.
    """

    analysis: dict


# endregion


def build_debug_graph():
    """
    Constructs a multi-step graph with generate, process, and summarize
    nodes to produce rich state transitions for debug inspection.
    """
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)

    # region pipeline-nodes
    async def generate(state: DebugState) -> dict:
        system_prompt = (PROMPTS_DIR / "debug.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    async def process(state: DebugState) -> dict:
        last = state["messages"][-1].content
        analysis = {
            "characters": len(last),
            "words": last.count(" ") + 1,
        }
        processed = AIMessage(
            content=f"[Processing] Analyzed {analysis['characters']} characters. "
            f"Found {analysis['words']} words. Processing complete."
        )
        return {"messages": [processed], "analysis": analysis}

    async def summarize(state: DebugState) -> dict:
        messages = [
            SystemMessage(content="Provide a brief one-sentence summary of the conversation so far.")
        ] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    # endregion

    # region graph-wiring
    graph = StateGraph(DebugState)
    graph.add_node("generate", generate)
    graph.add_node("process", process)
    graph.add_node("summarize", summarize)
    graph.add_node("generate_title", generate_title)
    graph.set_entry_point("generate")
    graph.add_edge("generate", "process")
    graph.add_edge("process", "summarize")
    graph.add_edge("summarize", "generate_title")
    graph.add_edge("generate_title", END)

    return graph.compile()
    # endregion


graph = build_debug_graph()
