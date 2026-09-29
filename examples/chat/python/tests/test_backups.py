"""Backup inventory + the executable approval tools.

The inventory is demo-owned state: seeded from a fixed list against a FROZEN
clock so every thread starts identically and a recording is reproducible.
"""
import json
from typing import Annotated, Optional

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command
from typing_extensions import TypedDict

pytestmark = pytest.mark.smoke


def test_state_declares_backups_channel():
    from src.graph import State
    assert "backups" in State.__annotations__


def test_seed_is_fixed_and_fresh_per_call():
    from src.backups import seed_backups
    a = seed_backups()
    b = seed_backups()
    assert a == b
    assert a is not b, "callers mutate their copy; the seed must not be shared"
    assert len(a) == 8
    assert all({"id", "location", "created_at", "size_gb"} <= set(row) for row in a)


def test_inventory_of_falls_back_to_seed_when_state_is_empty():
    from src.backups import inventory_of, seed_backups
    assert inventory_of({}) == seed_backups()
    assert inventory_of({"backups": None}) == seed_backups()
    rows = [{"id": "x", "location": "s3://x", "created_at": "2026-01-01", "size_gb": 1.0}]
    assert inventory_of({"backups": rows}) == rows


def test_inventory_of_preserves_an_explicit_empty_inventory():
    from src.backups import inventory_of
    rows = []
    inventory = inventory_of({"backups": rows})
    assert inventory == []
    assert inventory is not rows


def test_age_is_measured_against_the_frozen_clock():
    from src.backups import INVENTORY_TODAY, age_days
    assert INVENTORY_TODAY == "2026-09-05"
    assert age_days({"created_at": "2026-09-05"}) == 0
    assert age_days({"created_at": "2026-06-07"}) == 90


def test_older_than_selects_rows_at_or_past_the_threshold():
    from src.backups import older_than, seed_backups
    old = older_than(seed_backups(), 90)
    ids = [b["id"] for b in old]
    assert ids == [
        "bk-2026-05-28-prod",
        "bk-2026-04-30-prod",
        "bk-2026-03-15-prod",
        "bk-2026-02-01-staging",
        "bk-2025-12-31-prod",
    ]
    assert older_than(seed_backups(), 0) == seed_backups()
    assert older_than(seed_backups(), 10_000) == []


def test_two_seed_rows_are_retained_and_both_are_old():
    from src.backups import older_than, seed_backups
    retained = [b["id"] for b in seed_backups() if b.get("retain")]
    assert retained == ["bk-2026-03-15-prod", "bk-2025-12-31-prod"]
    old_ids = {b["id"] for b in older_than(seed_backups(), 90)}
    assert set(retained) <= old_ids, "the retain rule must matter for the 90-day scenario"


class _ToolState(TypedDict):
    messages: Annotated[list, add_messages]
    backups: Optional[list]


def _tool_graph(*tools):
    """A one-node graph around ToolNode with an in-memory checkpointer, so the
    tools run exactly the way the real graph runs them (InjectedState,
    Command updates, interrupts) without an LLM."""
    b = StateGraph(_ToolState)
    b.add_node("tools", ToolNode(list(tools)))
    b.set_entry_point("tools")
    b.add_edge("tools", END)
    return b.compile(checkpointer=MemorySaver())


def _call(name: str, args: dict, call_id: str = "t1") -> dict:
    return {"messages": [AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])]}


def _last_tool_json(result: dict) -> dict:
    msg = result["messages"][-1]
    assert isinstance(msg, ToolMessage)
    return json.loads(msg.content)


def test_list_backups_returns_matching_rows_and_seeds_the_thread():
    from src.backups import list_backups, seed_backups
    g = _tool_graph(list_backups)
    cfg = {"configurable": {"thread_id": "list-1"}}
    out = g.invoke(_call("list_backups", {"older_than_days": 90}), cfg)
    payload = _last_tool_json(out)
    assert payload["older_than_days"] == 90
    assert [b["id"] for b in payload["backups"]] == [
        "bk-2026-05-28-prod",
        "bk-2026-04-30-prod",
        "bk-2026-03-15-prod",
        "bk-2026-02-01-staging",
        "bk-2025-12-31-prod",
    ]
    assert payload["total"] == 8
    assert g.get_state(cfg).values["backups"] == seed_backups()


def test_list_backups_reads_the_thread_inventory_not_the_seed():
    from src.backups import list_backups
    g = _tool_graph(list_backups)
    cfg = {"configurable": {"thread_id": "list-2"}}
    only = [{"id": "bk-only", "location": "s3://x", "created_at": "2025-01-01", "size_gb": 1.0}]
    out = g.invoke({**_call("list_backups", {"older_than_days": 1}), "backups": only}, cfg)
    assert [b["id"] for b in _last_tool_json(out)["backups"]] == ["bk-only"]


def test_list_backups_persists_an_explicit_empty_inventory():
    from src.backups import list_backups
    g = _tool_graph(list_backups)
    cfg = {"configurable": {"thread_id": "list-empty"}}
    out = g.invoke({**_call("list_backups", {"older_than_days": 0}, "list-empty-call"), "backups": []}, cfg)
    assert _last_tool_json(out) == {"older_than_days": 0, "backups": [], "total": 0}
    assert out["messages"][-1].tool_call_id == "list-empty-call"
    saved = g.get_state(cfg).values
    assert saved["backups"] == []
    assert _last_tool_json(saved) == _last_tool_json(out)
    assert saved["messages"][-1].tool_call_id == "list-empty-call"


def test_deleting_the_last_backup_keeps_later_checkpointed_lists_empty():
    from src.backups import delete_backups, list_backups
    g = _tool_graph(delete_backups, list_backups)
    cfg = {"configurable": {"thread_id": "delete-last"}}
    only = [{"id": "bk-only", "location": "s3://only", "created_at": "2025-01-01", "size_gb": 1.25}]
    paused = g.invoke({**_call("delete_backups", {"ids": ["bk-only"]}, "delete-last-call"), "backups": only}, cfg)
    assert paused["__interrupt__"][0].value["ids"] == ["bk-only"]
    before = g.get_state(cfg).values
    assert before["backups"] == only
    assert not any(isinstance(message, ToolMessage) for message in before["messages"])

    out = g.invoke(Command(resume="approved"), cfg)
    assert _last_tool_json(out) == {"deleted": ["bk-only"], "freed_gb": 1.2, "remaining": 0}
    assert out["messages"][-1].tool_call_id == "delete-last-call"
    saved = g.get_state(cfg).values
    assert saved["backups"] == []
    assert _last_tool_json(saved) == _last_tool_json(out)
    assert saved["messages"][-1].tool_call_id == "delete-last-call"

    listed = g.invoke(_call("list_backups", {"older_than_days": 0}, "list-after-last-call"), cfg)
    assert _last_tool_json(listed) == {"older_than_days": 0, "backups": [], "total": 0}
    assert listed["messages"][-1].tool_call_id == "list-after-last-call"
    assert g.get_state(cfg).values["backups"] == []


_OLD_DELETABLE = ["bk-2026-05-28-prod", "bk-2026-04-30-prod", "bk-2026-02-01-staging"]


def test_delete_without_approval_interrupts_and_deletes_nothing():
    """The test that carries the whole claim. Mutation-checked: with the
    `interrupt(...)` call removed from delete_backups this MUST fail."""
    from src.backups import delete_backups, inventory_of, seed_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": "del-1"}}
    out = g.invoke(_call("delete_backups", {"ids": _OLD_DELETABLE}), cfg)

    assert "__interrupt__" in out, "delete_backups must pause before doing anything"
    value = out["__interrupt__"][0].value
    assert value["type"] == "approval_request"
    assert isinstance(value["reason"], str)
    for bid in _OLD_DELETABLE:
        assert bid in value["reason"]
    assert value["ids"] == _OLD_DELETABLE

    # Nothing was written: no ToolMessage, and the inventory is still whole.
    assert not any(isinstance(m, ToolMessage) for m in g.get_state(cfg).values["messages"])
    assert inventory_of(g.get_state(cfg).values) == seed_backups()


def test_approval_deletes_exactly_the_named_rows_and_persists():
    from src.backups import delete_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": "del-2"}}
    g.invoke(_call("delete_backups", {"ids": _OLD_DELETABLE}), cfg)
    out = g.invoke(Command(resume="approved"), cfg)

    payload = _last_tool_json(out)
    assert payload["deleted"] == _OLD_DELETABLE
    assert payload["remaining"] == 5
    assert payload["freed_gb"] == pytest.approx(37.8 + 36.4 + 12.3)
    remaining_ids = {b["id"] for b in g.get_state(cfg).values["backups"]}
    assert remaining_ids.isdisjoint(_OLD_DELETABLE)
    assert len(remaining_ids) == 5


@pytest.mark.parametrize("answer", ["denied", "no", "Stop, keep the staging one", ""])
def test_anything_but_approval_deletes_nothing(answer):
    from src.backups import delete_backups, inventory_of, seed_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": f"del-3-{answer!r}"}}
    g.invoke(_call("delete_backups", {"ids": _OLD_DELETABLE}), cfg)
    out = g.invoke(Command(resume=answer), cfg)

    payload = _last_tool_json(out)
    assert payload["deleted"] == []
    assert payload["declined"] is True
    assert payload["human_response"] == answer
    assert inventory_of(g.get_state(cfg).values) == seed_backups()


@pytest.mark.parametrize("answer", ["approved", "Approve", "APPROVED — go ahead", "yes", "ok", "okay", "confirm", "proceed", "go ahead", " \nYeS\t", "  approved — go ahead  "])
def test_approval_wording_is_recognised(answer):
    from src.backups import delete_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": f"del-4-{answer!r}"}}
    g.invoke(_call("delete_backups", {"ids": ["bk-2026-02-01-staging"]}), cfg)
    out = g.invoke(Command(resume=answer), cfg)
    assert _last_tool_json(out)["deleted"] == ["bk-2026-02-01-staging"]


@pytest.mark.parametrize("answer", [
    "approve the prod ones but keep staging",
    "approved but do not delete staging",
    "  APPROVED if the audit passes\n",
    "approved — go ahead, but keep staging",
    "approvedish",
    "approve-no",
    "not approved",
    "do not approve",
])
def test_conditional_negated_and_prefixed_answers_preserve_explicit_inventory(answer):
    from src.backups import delete_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": f"conditional-{answer!r}"}}
    inventory = [
        {"id": "bk-prod", "location": "s3://prod", "created_at": "2025-01-01", "size_gb": 2.0},
        {"id": "bk-staging", "location": "s3://staging", "created_at": "2025-01-01", "size_gb": 1.0},
    ]
    paused = g.invoke({**_call("delete_backups", {"ids": ["bk-prod", "bk-staging"]}, "conditional-call"), "backups": inventory}, cfg)
    assert paused["__interrupt__"][0].value["ids"] == ["bk-prod", "bk-staging"]
    before = g.get_state(cfg).values
    assert before["backups"] == inventory
    assert not any(isinstance(message, ToolMessage) for message in before["messages"])

    out = g.invoke(Command(resume=answer), cfg)
    assert _last_tool_json(out) == {"deleted": [], "declined": True, "human_response": answer, "remaining": 2}
    assert out["messages"][-1].tool_call_id == "conditional-call"
    saved = g.get_state(cfg).values
    assert saved["backups"] == inventory
    assert _last_tool_json(saved) == _last_tool_json(out)
    assert saved["messages"][-1].tool_call_id == "conditional-call"


def test_retained_ids_are_refused_before_any_interrupt():
    from src.backups import delete_backups, inventory_of, seed_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": "del-5"}}
    out = g.invoke(_call("delete_backups", {"ids": ["bk-2026-05-28-prod", "bk-2026-03-15-prod"]}), cfg)

    assert "__interrupt__" not in out, "a refusal must not ask a human to approve it"
    payload = _last_tool_json(out)
    assert payload["deleted"] == []
    assert payload["refused"] == ["bk-2026-03-15-prod"]
    assert "retain" in payload["error"]
    assert inventory_of(g.get_state(cfg).values) == seed_backups()


def test_unknown_ids_are_refused_before_any_interrupt():
    from src.backups import delete_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": "del-6"}}
    out = g.invoke(_call("delete_backups", {"ids": ["bk-nope"]}), cfg)
    assert "__interrupt__" not in out
    payload = _last_tool_json(out)
    assert payload["deleted"] == []
    assert payload["refused"] == ["bk-nope"]


def test_empty_id_list_is_refused():
    from src.backups import delete_backups
    g = _tool_graph(delete_backups)
    cfg = {"configurable": {"thread_id": "del-7"}}
    out = g.invoke(_call("delete_backups", {"ids": []}), cfg)
    assert "__interrupt__" not in out
    assert _last_tool_json(out)["deleted"] == []


def test_approval_reason_is_compact_enough_for_the_hero_dwell():
    """INTERRUPT_DWELL_MS in hero-script.ts is calibrated to a ~40-word
    proposal. The reason for five ids must stay well inside that budget."""
    from src.backups import approval_reason, older_than, seed_backups
    reason = approval_reason(older_than(seed_backups(), 90))
    assert len(reason.split()) <= 60
    assert "bk-2026-05-28-prod" in reason
