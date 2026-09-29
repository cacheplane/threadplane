"""Demo-owned backup inventory and the tools that act on it.

Why this exists: the hero's approval beat used to replay an authored answer,
because after approval the graph had nothing to execute — `request_approval`
was the only relevant tool. These two tools give the model something REAL to
do, against state the demo owns, and put the approval interrupt inside the
destructive tool so it is enforced by code rather than by the system prompt.

The inventory lives in the graph State (see ``State.backups`` in graph.py)
so it rides the checkpoint: per-thread isolated, and it survives the
interrupt, the resume, and a page reload.

The clock is FROZEN. Ages are measured against ``INVENTORY_TODAY`` rather than
``date.today()`` so that "older than 90 days" selects the same rows on every
run — a recording made today must replay the same inventory next year.
"""
import json
from datetime import date
from typing import Annotated

from langchain_core.messages import ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.prebuilt import InjectedState
from langgraph.types import Command, interrupt
from typing_extensions import NotRequired, TypedDict


class Backup(TypedDict):
    id: str
    location: str
    created_at: str  # ISO date, YYYY-MM-DD
    size_gb: float
    retain: NotRequired[bool]


INVENTORY_TODAY = "2026-09-05"

_SEED: list[Backup] = [
    {"id": "bk-2026-08-30-prod", "location": "s3://acme-db-backups/prod/2026-08-30.dump.gz", "created_at": "2026-08-30", "size_gb": 41.2},
    {"id": "bk-2026-08-16-prod", "location": "s3://acme-db-backups/prod/2026-08-16.dump.gz", "created_at": "2026-08-16", "size_gb": 40.7},
    {"id": "bk-2026-07-05-prod", "location": "s3://acme-db-backups/prod/2026-07-05.dump.gz", "created_at": "2026-07-05", "size_gb": 39.1},
    {"id": "bk-2026-05-28-prod", "location": "s3://acme-db-backups/prod/2026-05-28.dump.gz", "created_at": "2026-05-28", "size_gb": 37.8},
    {"id": "bk-2026-04-30-prod", "location": "s3://acme-db-backups/prod/2026-04-30.dump.gz", "created_at": "2026-04-30", "size_gb": 36.4},
    {"id": "bk-2026-03-15-prod", "location": "s3://acme-db-backups/prod/2026-03-15.dump.gz", "created_at": "2026-03-15", "size_gb": 35.0, "retain": True},
    {"id": "bk-2026-02-01-staging", "location": "s3://acme-db-backups/staging/2026-02-01.dump.gz", "created_at": "2026-02-01", "size_gb": 12.3},
    {"id": "bk-2025-12-31-prod", "location": "s3://acme-db-backups/prod/2025-12-31.dump.gz", "created_at": "2025-12-31", "size_gb": 33.6, "retain": True},
]


def seed_backups() -> list[Backup]:
    """A fresh copy of the fixed inventory. Copied so a caller's edits never
    leak into the next thread."""
    return [dict(row) for row in _SEED]  # type: ignore[return-value]


def inventory_of(state: dict) -> list[Backup]:
    """The thread's inventory, or the seed when the thread has none yet."""
    rows = state.get("backups") if isinstance(state, dict) else None
    return seed_backups() if rows is None else list(rows)


def age_days(backup: Backup) -> int:
    return (date.fromisoformat(INVENTORY_TODAY) - date.fromisoformat(backup["created_at"])).days


def older_than(inventory: list[Backup], days: int) -> list[Backup]:
    return [b for b in inventory if age_days(b) >= days]


@tool
def list_backups(
    older_than_days: int,
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """List database backups whose age is at least `older_than_days` days.

    Read-only. Returns JSON with `older_than_days`, the matching `backups`
    (each with id, location, created_at, size_gb, and `retain: true` when
    the backup is under a retention hold and must never be deleted), and
    `total`, the size of the whole inventory. Pass 0 to list everything.
    """
    inventory = inventory_of(state)
    rows = older_than(inventory, older_than_days)
    content = json.dumps(
        {"older_than_days": older_than_days, "backups": rows, "total": len(inventory)}
    )
    # Writes the inventory back even on a read so the FIRST touch seeds the
    # checkpoint: from here on the thread owns its rows explicitly.
    return Command(
        update={
            "backups": inventory,
            "messages": [ToolMessage(content=content, tool_call_id=tool_call_id)],
        }
    )


_APPROVAL_WORDS = (
    "approved", "approve", "yes", "ok", "okay", "confirm", "proceed", "go ahead",
    "approved — go ahead",
)


def is_approval(response: object) -> bool:
    """True only for an unambiguous yes. Free text that merely mentions
    approval ("approve the prod ones but keep staging") is NOT a yes — the
    model gets the words back and re-plans instead."""
    text = str(response or "").strip().lower()
    return text in _APPROVAL_WORDS


def approval_reason(targets: list[Backup]) -> str:
    total_gb = round(sum(b["size_gb"] for b in targets), 1)
    ids = ", ".join(b["id"] for b in targets)
    return (
        f"Delete {len(targets)} backups ({total_gb} GB): {ids}. "
        "This permanently removes them from storage and cannot be undone."
    )


def _refusal(ids: list[str], error: str, tool_call_id: str) -> Command:
    content = json.dumps({"deleted": [], "refused": ids, "error": error})
    return Command(update={"messages": [ToolMessage(content=content, tool_call_id=tool_call_id)]})


@tool
def delete_backups(
    ids: list[str],
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Permanently delete the backups with these ids.

    This tool PAUSES for the human's approval on its own before deleting
    anything, so do not call `request_approval` first. Pass only ids
    returned by `list_backups`, and never an id whose backup carries
    `retain: true` — the call is refused outright, nothing is deleted, and
    you must call again without it. Returns JSON: `deleted` (ids removed),
    `freed_gb`, and `remaining` (rows left in the inventory). If the human
    declines, `declined` is true, nothing is deleted, and `human_response`
    carries their words so you can adjust the plan.
    """
    # Everything above the interrupt() call is idempotent on purpose:
    # LangGraph re-runs this function on resume, and interrupt() returns the
    # human's answer on that second pass. request_approval in graph.py works
    # the same way and is the precedent.
    inventory = inventory_of(state)
    by_id = {b["id"]: b for b in inventory}
    if not ids:
        return _refusal([], "No ids given; call list_backups first.", tool_call_id)
    unknown = [i for i in ids if i not in by_id]
    if unknown:
        return _refusal(unknown, f"Unknown backup ids: {', '.join(unknown)}. Nothing was deleted.", tool_call_id)
    retained = [i for i in ids if by_id[i].get("retain")]
    if retained:
        return _refusal(
            retained,
            f"Refused: {', '.join(retained)} tagged retain and cannot be deleted. Nothing was deleted.",
            tool_call_id,
        )

    targets = [by_id[i] for i in ids]
    # The guardrail. There is no path to the deletion below that skips this
    # line, so a prompt cannot talk past it and neither can a jailbreak.
    decision = interrupt({"type": "approval_request", "reason": approval_reason(targets), "ids": ids})

    if not is_approval(decision):
        content = json.dumps(
            {"deleted": [], "declined": True, "human_response": str(decision or ""), "remaining": len(inventory)}
        )
        return Command(update={"messages": [ToolMessage(content=content, tool_call_id=tool_call_id)]})

    doomed = set(ids)
    remaining = [b for b in inventory if b["id"] not in doomed]
    content = json.dumps(
        {
            "deleted": ids,
            "freed_gb": round(sum(b["size_gb"] for b in targets), 1),
            "remaining": len(remaining),
        }
    )
    return Command(
        update={
            "backups": remaining,
            "messages": [ToolMessage(content=content, tool_call_id=tool_call_id)],
        }
    )
