"""LangGraph client-tools graph.

The browser declares the tools (get_weather/weather_card/confirm_booking) and
ships them to the model as the AG-UI client tool catalog; ag-ui-langgraph
merges them into state['tools']. This graph binds those client stubs onto the
model (no server implementation) and ends the turn when the model calls one —
the browser executes it and re-runs with a ToolMessage, which the model then
summarizes.
"""
from pathlib import Path

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver
from typing_extensions import Annotated, TypedDict

from threadplane.middleware.langgraph import bind_client_tools

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class State(TypedDict):
    # `tools` holds the client tool catalog ag-ui-langgraph merges in from
    # RunAgentInput.tools — declared as a channel so the graph retains it.
    messages: Annotated[list, add_messages]
    tools: list


_base_llm = ChatOpenAI(model="gpt-5-mini", streaming=True)


def build_client_tools_graph():
    async def agent(state: State) -> dict:
        # Bind the client catalog stubs (from state['tools']) onto the model.
        llm = bind_client_tools(_base_llm, [], state)
        system = (PROMPTS_DIR / "client-tools.md").read_text()
        response = await llm.ainvoke([SystemMessage(content=system)] + state["messages"])
        return {"messages": [response]}

    # No server tools: a client tool call ends the run (the browser executes it),
    # and so does a final text turn. So the agent node always routes to END.
    def route(state: State) -> str:
        return END

    graph = StateGraph(State)
    graph.add_node("agent", agent)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {END: END})
    return graph.compile(checkpointer=MemorySaver())


graph = build_client_tools_graph()
