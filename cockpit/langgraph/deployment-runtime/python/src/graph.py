"""
LangGraph Deployment Runtime Graph

Standard chat graph demonstrating production deployment patterns.
The graph itself is intentionally simple — the focus of this example
is the deployment configuration, not a unique graph pattern.

Deploy with:
    langgraph deploy

Or run locally for development:
    langgraph dev
"""

from pathlib import Path
from typing import NotRequired
from langgraph.graph import StateGraph, MessagesState, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class DeploymentRuntimeState(MessagesState):
    completed_turn_id: NotRequired[str]
    completed_answer_id: NotRequired[str]
    completed_message_ids: NotRequired[list[str]]


def build_deployment_runtime_graph():
    """
    Constructs a standard chat StateGraph suitable for production deployment.

    This graph is designed to be deployed via `langgraph deploy` to
    LangGraph Cloud. The assistantId in the Angular component must match
    the graph key in langgraph.json.
    """
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)

    async def generate(state: DeploymentRuntimeState) -> dict:
        """Generate a response using the full message history."""
        system_prompt = (PROMPTS_DIR / "deployment-runtime.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        result = {"messages": [response]}
        canonical = [*state["messages"], response]
        ids = [getattr(message, "id", None) for message in canonical]
        if (
            len(canonical) >= 2
            and getattr(canonical[-2], "type", None) == "human"
            and getattr(canonical[-1], "type", None) == "ai"
            and all(isinstance(identity, str) and identity for identity in ids)
            and len(ids) == len(set(ids))
        ):
            result["completed_turn_id"] = ids[-2]
            result["completed_answer_id"] = ids[-1]
            result["completed_message_ids"] = ids
        return result

    graph = StateGraph(DeploymentRuntimeState)
    graph.add_node("generate", generate)
    graph.set_entry_point("generate")
    graph.add_edge("generate", END)
    return graph.compile()


# The graph instance — referenced by langgraph.json
graph = build_deployment_runtime_graph()
