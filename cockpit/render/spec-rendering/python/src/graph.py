"""
Render Spec Rendering Graph

A LangGraph StateGraph that returns JSON render specs describing UI layouts.
The Angular frontend uses RenderSpecComponent to render these specs into
live Angular components.
"""

from pathlib import Path
from langgraph.graph import StateGraph, MessagesState, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def build_spec_rendering_graph():
    """
    Constructs a graph that generates JSON render specs.

    The agent responds with JSON UI specifications that the Angular frontend
    renders using RenderSpecComponent from @threadplane/angular/render.
    """
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)

    async def generate(state: MessagesState) -> dict:
        system_prompt = (PROMPTS_DIR / "spec-rendering.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("generate", generate)
    graph.set_entry_point("generate")
    graph.add_edge("generate", END)

    return graph.compile()


graph = build_spec_rendering_graph()
