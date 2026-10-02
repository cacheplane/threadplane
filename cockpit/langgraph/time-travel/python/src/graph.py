"""
LangGraph Time Travel Graph

Demonstrates checkpoint-based time travel. Each message exchange is saved as
a checkpoint snapshot. The client reads the thread's checkpoint history and can
start a new run from any past checkpoint by submitting with that checkpoint.

The LangGraph API server provides checkpointing automatically.
"""

from pathlib import Path
from typing import NotRequired
from langgraph.graph import StateGraph, MessagesState, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class TimeTravelState(MessagesState):
    """Canonical final identities let the React preview verify adopted history."""

    completed_turn_id: NotRequired[str]
    completed_answer_id: NotRequired[str]
    completed_message_ids: NotRequired[list[str]]


def build_time_travel_graph():
    """
    Constructs a StateGraph that the LangGraph API server checkpoints.

    The LangGraph API checkpointer saves a snapshot after each node execution,
    producing a history of ThreadState objects that the client can replay or
    branch from using checkpoint IDs.
    """
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)

    async def generate(state: TimeTravelState) -> dict:
        """Generate a response, checkpointed for time travel."""
        system_prompt = (PROMPTS_DIR / "time-travel.md").read_text()
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

    graph = StateGraph(TimeTravelState)
    graph.add_node("generate", generate)
    graph.set_entry_point("generate")
    graph.add_edge("generate", END)
    return graph.compile()


# The graph instance — referenced by langgraph.json
graph = build_time_travel_graph()
