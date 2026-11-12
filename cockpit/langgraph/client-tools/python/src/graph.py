"""LangGraph client-tools graph (LangGraph-direct path).

The browser declares the tools (get_weather/weather_card/confirm_booking) and
the `@threadplane/langgraph` adapter ships the catalog as `input.client_tools`.
This graph declares a `client_tools` channel so the catalog is retained across
the turn, binds those client stubs onto the model (no server implementation),
and ends the turn when the model calls one — the browser executes it and
re-runs with a ToolMessage, which the model then summarizes.
"""
from pathlib import Path

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import Annotated, TypedDict

from threadplane.middleware.langgraph import bind_client_tools

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class State(TypedDict):
    messages: Annotated[list, add_messages]
    # The @threadplane/langgraph adapter ships the client tool catalog here.
    client_tools: list


_base_llm = ChatOpenAI(model="gpt-5-mini", streaming=True)


def build_client_tools_graph():
    async def agent(state: State) -> dict:
        # bind_client_tools reads state['tools'] then falls back to state['client_tools'].
        llm = bind_client_tools(_base_llm, [], state)
        system = (PROMPTS_DIR / "client-tools.md").read_text()
        response = await llm.ainvoke([SystemMessage(content=system)] + state["messages"])
        return {"messages": [response]}

    def route(state: State) -> str:
        return END  # no server tools: a client tool call ends the run; the browser executes it

    graph = StateGraph(State)
    graph.add_node("agent", agent)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {END: END})
    return graph.compile()


# The graph instance — referenced by langgraph.json. For `langgraph dev` the
# platform runtime provides the checkpointer, so we compile without one (mirrors
# cockpit/langgraph/streaming/python/src/graph.py).
graph = build_client_tools_graph()
