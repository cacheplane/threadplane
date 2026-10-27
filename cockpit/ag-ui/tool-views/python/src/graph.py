"""
LangGraph Tool-Views Graph

Demonstrates tool-driven view rendering over AG-UI. The agent calls a
`weather_card` tool that returns plain JSON data — no UI spec. The tool call
and its result travel over the wire as AG-UI TOOL_CALL_* events; the Angular
frontend owns a component registered under the matching name and renders it
live from the call's args/result/status.

Flow: START -> agent <-> tools -> agent (loop) -> END
"""

from pathlib import Path
import json
from typing import Annotated

from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


# region weather-tool
@tool
async def weather_card(location: str, tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
    """Look up the current weather for a location.

    Returns plain JSON data. The frontend renders a component registered
    under the name `weather_card` from this call's args and result.

    Args:
        location: The city or place to look up weather for.

    Returns:
        A tool message containing location, temperatureF, conditions, humidity, windMph.
    """
    # Deterministic demo data so e2e fixtures stay stable.
    reading = {
        "location": location,
        "temperatureF": 68,
        "conditions": "Sunny",
        "humidity": 55,
        "windMph": 8,
    }
    # Set the result ID before the bridge streams it; add_messages otherwise
    # assigns a different ID later, after native clients have placed the result.
    return ToolMessage(
        id=tool_call_id,
        tool_call_id=tool_call_id,
        name="weather_card",
        content=json.dumps(reading),
    )
# endregion


_TOOLS = [weather_card]


# region graph
def build_tool_views_graph():
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True).bind_tools(_TOOLS)

    async def agent(state: MessagesState) -> dict:
        system_prompt = (PROMPTS_DIR / "tool-views.md").read_text()
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    def route(state: MessagesState) -> str:
        last = state["messages"][-1]
        return "tools" if getattr(last, "tool_calls", None) else END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent)
    graph.add_node("tools", ToolNode(_TOOLS))
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile(checkpointer=MemorySaver())
# endregion


# The graph instance — referenced by server.py
graph = build_tool_views_graph()
