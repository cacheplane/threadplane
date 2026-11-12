"""LangGraph client-tools graph.

The browser declares the tools (get_weather/weather_card/confirm_booking) and
ships them to the model as the AG-UI client tool catalog; ag-ui-langgraph
merges them into state['tools']. This graph binds those client stubs onto the
model (no server implementation) and ends the turn when the model calls one —
the browser executes it and re-runs with a ToolMessage, which the model then
summarizes.

When one response requests two or more browser tools, the graph also writes a
plan to `todos`, the `[{content, status}]` shape a deep-agents style to-do tool
writes. ag-ui-langgraph publishes it in the state snapshot, and the
@threadplane/ag-ui session reads it as `plan`.
"""
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
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
    # The plan for a turn that requests several browser tools.
    todos: list


SUMMARY_STEP = "Summarize the results"


def step_label(call: dict) -> str:
    """A readable plan step for one requested browser tool."""
    args = call.get("args") or {}
    location = args.get("location")
    where = f" for {location}" if isinstance(location, str) and location.strip() else ""
    labels = {
        "get_weather": f"Check the weather{where}",
        "weather_card": f"Show the weather card{where}",
        "weather_snapshot": f"Show a weather snapshot{where}",
        "confirm_booking": "Confirm the booking with you",
        "slow_status_check": "Run the status check",
    }
    return labels.get(call.get("name", ""), str(call.get("name", "tool")).replace("_", " ").capitalize())


def next_todos(messages: list, response: AIMessage, todos: list | None) -> list | None:
    """The plan after this response, or None to leave it unchanged.

    Several browser tools in one response declare a plan: their steps are in
    progress while the browser runs them, and the summary follows. The answer
    after their results completes it. A new user turn clears an earlier plan.
    """
    calls = response.tool_calls or []
    last = messages[-1] if messages else None
    if len(calls) >= 2:
        steps = [{"content": step_label(call), "status": "in_progress"} for call in calls]
        return steps + [{"content": SUMMARY_STEP, "status": "pending"}]
    if todos and isinstance(last, ToolMessage) and not calls:
        return [{**todo, "status": "completed"} for todo in todos]
    if todos and isinstance(last, HumanMessage):
        return []
    return None


_base_llm = ChatOpenAI(model="gpt-5-mini", streaming=True)


def build_client_tools_graph():
    async def agent(state: State) -> dict:
        # Bind the client catalog stubs (from state['tools']) onto the model.
        llm = bind_client_tools(_base_llm, [], state)
        system = (PROMPTS_DIR / "client-tools.md").read_text()
        response = await llm.ainvoke([SystemMessage(content=system)] + state["messages"])
        update: dict = {"messages": [response]}
        todos = next_todos(state["messages"], response, state.get("todos"))
        if todos is not None:
            update["todos"] = todos
        return update

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
