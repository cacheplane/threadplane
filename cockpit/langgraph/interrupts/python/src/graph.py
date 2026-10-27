"""
LangGraph Interrupts Graph — Refund Authorization

Demonstrates human-in-the-loop approval for high-stakes actions using
LangGraph's interrupt() primitive. The agent drafts a refund (extracting
customer, amount, and reason from the conversation), then pauses at
request_approval. The frontend renders an approval card; resuming with
{ approved: true } issues the refund (optionally with an edited amount),
resuming with { approved: false } skips it.
"""

from pathlib import Path
from typing import TypedDict, Annotated, Optional
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.types import interrupt
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, AIMessage

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


# region state
class RefundDraft(BaseModel):
    """Structured fields the agent extracts from the refund request."""

    customer_id: str = Field(description="The customer identifier, e.g. cus_a8x2k. Use 'unknown' if not stated.")
    amount: float = Field(description="The refund amount in USD. Use 0 if not stated.")
    reason: str = Field(description="One sentence describing why the refund is justified.")


class RefundState(TypedDict):
    messages: Annotated[list, add_messages]
    customer_id: Optional[str]
    amount: Optional[float]
    reason: Optional[str]
    decision_approved: Optional[bool]
    refund_id: Optional[str]
# endregion


def build_interrupts_graph():
    # region draft
    llm = ChatOpenAI(model="gpt-5-mini", streaming=True)
    # Extracted fields belong to state, not the user-visible message stream.
    extractor = ChatOpenAI(model="gpt-5-mini", tags=["nostream"]).with_structured_output(RefundDraft)

    async def draft_refund(state: RefundState) -> dict:
        """Extract structured refund fields, then acknowledge the draft.

        Two LLM calls: one structured-output extraction that populates
        state.customer_id / amount / reason for the approval card, and one
        streaming acknowledgement for the chat transcript.
        """
        system_prompt = (PROMPTS_DIR / "interrupts.md").read_text()

        draft = await extractor.ainvoke(
            [
                SystemMessage(content="Extract the refund fields from the conversation."),
                *state["messages"],
            ]
        )

        response = await llm.ainvoke([SystemMessage(content=system_prompt)] + state["messages"])
        return {
            "messages": [response],
            "customer_id": draft.customer_id,
            "amount": draft.amount,
            "reason": draft.reason,
        }
    # endregion

    # region request-approval
    def request_approval(state: RefundState) -> dict:
        """Pause for human approval. Resume value is { approved: bool, amount?: number }."""
        amount = state.get("amount") or 0.0
        customer_id = state.get("customer_id") or "unknown"
        reason = state.get("reason") or ""

        decision = interrupt({
            "kind": "refund_approval",
            "amount": amount,
            "customer_id": customer_id,
            "reason": reason,
        })

        if not isinstance(decision, dict) or not decision.get("approved"):
            return {
                "decision_approved": False,
                "messages": [AIMessage(content="Refund cancelled by operator. No charge issued.")],
            }

        edited_amount = decision.get("amount")
        final_amount = float(edited_amount) if edited_amount is not None else amount
        return {
            "decision_approved": True,
            "amount": final_amount,
        }
    # endregion

    # region graph
    def issue_refund(state: RefundState) -> dict:
        """Stand-in for the real Stripe call. Logs a fake refund ID."""
        customer_id = state.get("customer_id") or "anon"
        refund_id = "re_demo_" + customer_id[-6:]
        # Wrap identifiers in backticks so markdown doesn't treat the
        # underscores in cus_*/re_* as emphasis delimiters.
        msg = f"Refund of ${state['amount']:.2f} issued to `{customer_id}`. Refund ID: `{refund_id}`."
        return {"refund_id": refund_id, "messages": [AIMessage(content=msg)]}

    def route_after_approval(state: RefundState) -> str:
        return "issue" if state.get("decision_approved") is True else "end"

    graph = StateGraph(RefundState)
    graph.add_node("draft", draft_refund)
    graph.add_node("request_approval", request_approval)
    graph.add_node("issue", issue_refund)

    graph.add_edge(START, "draft")
    graph.add_edge("draft", "request_approval")
    graph.add_conditional_edges("request_approval", route_after_approval, {"issue": "issue", "end": END})
    graph.add_edge("issue", END)

    return graph.compile()
    # endregion


graph = build_interrupts_graph()
