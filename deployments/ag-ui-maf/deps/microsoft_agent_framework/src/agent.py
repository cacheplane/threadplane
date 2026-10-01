"""Expense approval copilot — Microsoft Agent Framework backend.

A genuinely non-LangGraph AG-UI backend exercising the neutral Agent
contract surfaces measured in the 2026-08-31 runtime-portability matrix:

- messages: streamed assistant text.
- tool calls: ``lookup_expense_policy`` executes server-side with no pause.
- shared state: the ``expense`` argument of ``submit_expense`` streams
  predictively into frontend state via ``predict_state_config``
  (STATE_SNAPSHOT / STATE_DELTA).
- interrupts: ``submit_expense`` requires approval
  (``approval_mode="always_require"``), so the run finishes with the
  protocol-standard ``RUN_FINISHED.outcome = {type: 'interrupt', ...}`` and
  resumes from the client's top-level ``resume`` entries.

- subagents: ``research_policy`` delegates to the tool-less
  ``policy_researcher`` specialist Agent and streams its deltas through the
  ``delegation_*`` helpers in src/subagent_emitter.py, which merge standard
  ``SUBAGENT_*`` + attributed child ``TEXT_MESSAGE_*`` events into the run
  stream at the run-wrapper seam (the MAF bridge natively emits NOTHING for
  nested-agent activity inside a tool — measured red upstream and in
  docs/wire-capture-subagents.md).

Model client: Azure OpenAI is the DEFAULT path — when
``AZURE_OPENAI_ENDPOINT`` is set the client routes to Azure (key auth via
``AZURE_OPENAI_API_KEY``; deployment via ``AZURE_OPENAI_MODEL``;
``AZURE_OPENAI_API_VERSION`` optional). Without it, the plain OpenAI client
is used on ``OPENAI_API_KEY`` (honoring ``OPENAI_BASE_URL``, which is how
the aimock e2e harness intercepts calls). See .env.example.
"""

import os

from agent_framework import Agent, tool
from agent_framework.ag_ui import AgentFrameworkAgent
from agent_framework.openai import OpenAIChatCompletionClient
from pydantic import BaseModel, Field

from . import subagent_emitter

_POLICIES = {
    "meals": {"limit_usd": 300, "receipt_required_over_usd": 25, "notes": "Team meals require attendee count in the memo."},
    "travel": {"limit_usd": 1500, "receipt_required_over_usd": 0, "notes": "Book through the travel portal when possible."},
    "equipment": {"limit_usd": 800, "receipt_required_over_usd": 0, "notes": "Laptops and peripherals need an asset tag."},
    "software": {"limit_usd": 500, "receipt_required_over_usd": 0, "notes": "Annual subscriptions need manager pre-approval."},
}


class Expense(BaseModel):
    """A structured expense report entry."""

    vendor: str = Field(..., description="Merchant or vendor name, e.g. 'Blue Finch Bistro'.")
    category: str = Field(..., description="One of: meals, travel, equipment, software, other.")
    amount_usd: float = Field(..., description="Total amount in USD.")
    memo: str = Field(..., description="One-line justification, including attendee count for meals.")


# region policy-tool
@tool(
    name="lookup_expense_policy",
    description="Look up the reimbursement policy for an expense category.",
)
def lookup_expense_policy(category: str) -> str:
    """Return the reimbursement policy for a category.

    Args:
        category: Expense category, e.g. 'meals' or 'travel'.

    Returns:
        A short policy summary string.
    """
    policy = _POLICIES.get(category.strip().lower())
    if policy is None:
        return f"No specific policy for '{category}'; the general limit is $200 with receipts required."
    return (
        f"Policy for {category}: limit ${policy['limit_usd']} per expense, "
        f"receipts required over ${policy['receipt_required_over_usd']}. {policy['notes']}"
    )
# endregion


# region approval-tool
@tool(
    name="submit_expense",
    description="Submit an expense report entry for reimbursement. Requires human approval.",
    approval_mode="always_require",
)
def submit_expense(expense: Expense) -> str:
    """Submit the expense for reimbursement once a human approves it.

    Args:
        expense: The complete expense entry (vendor, category, amount_usd, memo).

    Returns:
        A confirmation string with the recorded amount.
    """
    # On the approval-resume path the framework replays the stored tool-call
    # arguments as plain dicts rather than re-validating through pydantic —
    # normalize before reading attributes.
    entry = expense if isinstance(expense, Expense) else Expense.model_validate(expense)
    return (
        f"Expense recorded: ${entry.amount_usd:.2f} to {entry.vendor} "
        f"({entry.category}) — queued for reimbursement."
    )
# endregion


_INSTRUCTIONS = """You are an expense approval copilot.

Before recommending whether to submit an expense, delegate the policy
research to the specialist by calling `research_policy` with the category
and amount.

When the user asks to file an expense:
1. FIRST call `lookup_expense_policy` with the expense category.
2. THEN call `submit_expense` with the complete structured expense
   (vendor, category, amount_usd, memo). Do not output prose alongside the
   `submit_expense` call — the user will be shown an approval card.
3. After the human approves and the tool executes, confirm in one short
   sentence that the expense has been submitted for reimbursement, naming
   the amount and vendor.

If the human rejects the submission, acknowledge in one short sentence that
the expense was not submitted.

Keep every response brief and factual. Never invent policy details — use the
policy tool.
"""


# region model-client
def build_chat_client() -> OpenAIChatCompletionClient:
    """Azure OpenAI by default; plain OpenAI when Azure env is absent.

    Passing `azure_endpoint` explicitly is the constructor's strongest Azure
    signal — it wins even when OPENAI_API_KEY is also set, which makes Azure
    the default whenever it is configured. Key, deployment (model), and API
    version resolve from AZURE_OPENAI_* env vars.
    """
    azure_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
    if azure_endpoint:
        return OpenAIChatCompletionClient(
            model=os.environ.get("AZURE_OPENAI_MODEL"),
            azure_endpoint=azure_endpoint,
        )
    # Passing api_key explicitly forces OpenAI routing even when no
    # OPENAI_API_KEY env var is set; without it the constructor falls back to
    # Azure env resolution and raises at import time. A placeholder key fails
    # properly at request time (401) instead of at module import.
    return OpenAIChatCompletionClient(
        model=os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
        api_key=os.environ.get("OPENAI_API_KEY", "unset-openai-api-key"),
    )
# endregion


# region delegation
policy_researcher = Agent(
    name="policy_researcher",
    instructions=(
        "You are an expense-policy researcher. Given an expense category and "
        "amount, summarize the applicable policy rules in 3 short bullets."
    ),
    client=build_chat_client(),
)


@tool(
    name="research_policy",
    description="Delegate policy research for this expense to a specialist.",
)
async def research_policy(category: str, amount: float) -> str:
    """Delegate policy research for this expense to a specialist.

    Streams the ``policy_researcher`` specialist and mirrors each text delta
    onto the AG-UI wire as attributed SUBAGENT_* / TEXT_MESSAGE_* events via
    src/subagent_emitter.py (no-ops outside the wrapped run).

    Args:
        category: Expense category, e.g. 'meals' or 'travel'.
        amount: Expense amount in USD.

    Returns:
        The specialist's complete policy summary.
    """
    # Deterministically recorded by the run wrapper's pump before this body
    # runs (the bridge streams TOOL_CALL_START/ARGS/END first); None when
    # invoked outside a wrapped run.
    tid = subagent_emitter.current_tool_call_id("research_policy")
    subagent_emitter.delegation_started(tid, policy_researcher.name)
    parts: list[str] = []
    try:
        prompt = (
            f"Expense category: {category}. Amount: ${amount:.2f}. "
            "Summarize the applicable policy rules."
        )
        async for update in policy_researcher.run(prompt, stream=True):
            text = update.text
            if text:
                parts.append(text)
                subagent_emitter.delegation_delta(tid, text)
    except Exception as exc:
        subagent_emitter.delegation_error(tid, str(exc))
        raise
    subagent_emitter.delegation_finished(tid)
    return "".join(parts)
# endregion


# region bridge
agent = AgentFrameworkAgent(
    agent=Agent(
        name="expense_approval_copilot",
        instructions=_INSTRUCTIONS,
        client=build_chat_client(),
        tools=[lookup_expense_policy, research_policy, submit_expense],
    ),
    name="ExpenseApprovalCopilot",
    description="Files expense reports with policy lookup, shared state, and human approval.",
    state_schema={
        "expense": {"type": "object", "description": "The expense entry being drafted."},
    },
    predict_state_config={
        "expense": {"tool": "submit_expense", "tool_argument": "expense"},
    },
    require_confirmation=False,
)
# endregion
