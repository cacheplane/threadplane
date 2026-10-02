"""
LangGraph Subgraphs Graph — nested execution with a state boundary

Demonstrates LangGraph's composition primitive: a *compiled child graph added
to a parent graph as a plain node*. Three things make this a real subgraph
demo rather than a straight-line chain:

1. **A conditional route.** The `orchestrate` node classifies the request and
   the parent decides whether to enter the child graph at all. A greeting
   answers directly; a factual question routes through `research` first.

2. **A state boundary.** The parent state carries `messages`; the child state
   (`ResearchState`) does not. LangGraph wires a subgraph node through the
   keys the two schemas *share* — here `research_topic` and `research_brief` —
   so the child receives a topic and returns a brief, and can neither read the
   chat transcript nor append to it.

3. **Nested execution.** The child runs as its own graph with its own step
   sequence, and LangGraph emits its stream events under a namespace
   (`research:<uuid>`) rather than flattening them into the parent's.

**Two views of the child on the Angular side.** `agent.value()` reads the
parent's own state — the shared `research_topic` / `research_brief` keys are
the boundary made visible. `agent.subagents()` shows the child as a stream:
every namespaced child run appears there, plain subgraph nodes under their
namespace key (named by node) and tool-dispatched children under their
tool-call id (that shape is demonstrated in `cockpit/chat/subagents`).
"""

from pathlib import Path
from typing import Annotated, NotRequired, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# Gate phrase for the router's structured-output call. Kept distinct from the
# other two system prompts so e2e fixture replay can tell the calls apart.
ROUTER_PROMPT = (
    "Delegation Router.\n"
    "Decide whether answering the latest user turn requires a factual "
    "deep dive that should be handed to the research subgraph.\n"
    "Greetings, small talk, and questions about your own capabilities do "
    "NOT require research. Questions about facts, comparisons, or how a "
    "technology works DO.\n"
    "When research is required, restate the request as one focused topic "
    "line for the subgraph."
)

RESEARCH_PROMPT = (
    "Research Subgraph.\n"
    "You are a focused researcher running as a child graph. You are given a "
    "topic and nothing else — you cannot see the chat transcript, so never "
    "address the user or ask questions. Return 3-5 terse factual bullets. "
    "Your output is an internal brief the parent orchestrator will use to "
    "write the user-facing answer."
)


class DelegationDecision(BaseModel):
    """Structured routing decision produced by the `orchestrate` node."""

    needs_research: bool = Field(
        description="True when answering requires a factual deep dive that the research subgraph should handle."
    )
    topic: str = Field(
        default="",
        description="One focused topic line for the subgraph. Empty string when needs_research is false.",
    )


# region state
class ResearchState(TypedDict):
    """Child graph state — deliberately has no `messages` key.

    The only keys here are the ones shared with the parent, which is exactly
    the contract LangGraph uses to pass state into and out of a subgraph node.
    """

    research_topic: str
    research_brief: str


class OrchestratorState(TypedDict):
    """Parent graph state — the transcript plus the shared subgraph channel."""

    messages: Annotated[list, add_messages]
    research_topic: str
    research_brief: str
    # Final-answer identity binds the retained boundary to one original turn.
    completed_turn_id: NotRequired[str]
    completed_answer_id: NotRequired[str]
# endregion


def build_subgraphs_graph():
    """Constructs a parent graph that conditionally enters a child subgraph."""
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)
    router = ChatOpenAI(model="gpt-5-mini", tags=["nostream"]).with_structured_output(DelegationDecision)
    researcher = ChatOpenAI(model="gpt-5-mini")

    # region research-subgraph
    # ── Child: research subgraph ──────────────────────────────────────────────

    async def research_node(state: ResearchState) -> dict:
        """Turn a topic into an internal brief. No transcript access."""
        response = await researcher.ainvoke(
            [
                SystemMessage(content=RESEARCH_PROMPT),
                HumanMessage(content=f"Topic: {state['research_topic']}"),
            ]
        )
        text = response.content
        if isinstance(text, list):  # multi-part content
            text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
        return {"research_brief": str(text).strip()}

    research_graph = StateGraph(ResearchState)
    research_graph.add_node("research", research_node)
    research_graph.add_edge(START, "research")
    research_graph.add_edge("research", END)
    compiled_research = research_graph.compile()
    # endregion

    # ── Parent: orchestrator graph ────────────────────────────────────────────

    # region orchestrate
    async def orchestrate_node(state: OrchestratorState) -> dict:
        """Classify the request. Writing a topic is what triggers delegation.

        Both shared keys are reset every turn so a topic left over from an
        earlier turn in the same thread can't re-trigger the subgraph.
        """
        decision = await router.ainvoke(
            [SystemMessage(content=ROUTER_PROMPT), *state["messages"]]
        )
        topic = decision.topic.strip() if decision.needs_research else ""
        return {"research_topic": topic, "research_brief": ""}

    def route_after_orchestrate(state: OrchestratorState) -> str:
        """The parent's decision: enter the child graph, or skip it."""
        return "research" if state.get("research_topic") else "answer"
    # endregion

    # region answer
    async def answer_node(state: OrchestratorState) -> dict:
        """The only node that writes to the transcript.

        `transcriptNodeNames: ['answer']` on the Angular side mirrors this:
        the router's and the subgraph's tokens never reach the chat UI.
        """
        system_prompt = (PROMPTS_DIR / "subgraphs.md").read_text()
        brief = state.get("research_brief") or ""
        context = (
            [SystemMessage(content=f"Internal brief returned by the research subgraph:\n{brief}")]
            if brief
            else []
        )
        response = await llm.ainvoke(
            [SystemMessage(content=system_prompt), *context, *state["messages"]]
        )
        question = next(
            (message for message in reversed(state["messages"])
             if getattr(message, "type", None) == "human"),
            None,
        )
        human_id = getattr(question, "id", None)
        answer_id = getattr(response, "id", None)
        completion = {}
        if (isinstance(human_id, str) and human_id
                and isinstance(answer_id, str) and answer_id
                and human_id != answer_id):
            completion = {
                "completed_turn_id": human_id,
                "completed_answer_id": answer_id,
            }
        return {"messages": [response], **completion}
    # endregion

    # region graph
    parent_graph = StateGraph(OrchestratorState)
    parent_graph.add_node("orchestrate", orchestrate_node)
    # The compiled child graph IS the node — no wrapper function. This is what
    # makes it a subgraph rather than an inline helper call.
    parent_graph.add_node("research", compiled_research)
    parent_graph.add_node("answer", answer_node)
    parent_graph.add_edge(START, "orchestrate")
    parent_graph.add_conditional_edges(
        "orchestrate",
        route_after_orchestrate,
        {"research": "research", "answer": "answer"},
    )
    parent_graph.add_edge("research", "answer")
    parent_graph.add_edge("answer", END)
    return parent_graph.compile()
    # endregion


# The graph instance — referenced by langgraph.json
graph = build_subgraphs_graph()
