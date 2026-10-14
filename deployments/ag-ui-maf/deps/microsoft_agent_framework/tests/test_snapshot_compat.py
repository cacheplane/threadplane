"""Narrow historical-tool repair at the public, pinned bridge boundary."""
import asyncio
from copy import deepcopy

import pytest
from ag_ui.core import MessagesSnapshotEvent, RunStartedEvent, ToolMessage
from agent_framework.ag_ui import AgentFrameworkAgent


POLICY = {"id": "policy-result", "role": "tool", "toolCallId": "policy-call", "content": "Policy for meals: limit $300 per expense", "metadata": {"receipt": None}, "custom": None}


def history():
    return [
        {"id": "user", "role": "user", "content": "File dinner"},
        {"id": "policy-assistant", "role": "assistant", "toolCalls": [{"id": "policy-call", "type": "function", "function": {"name": "lookup_expense_policy", "arguments": '{"category":"meals"}'}}]},
        deepcopy(POLICY),
        {"id": "approval-assistant", "role": "assistant", "toolCalls": [{"id": "approval-call", "type": "function", "function": {"name": "submit_expense", "arguments": "{}"}}]},
    ]


async def drive(monkeypatch, messages, event, before=None):
    from src.snapshot_compat import HistoricalToolSnapshotAgent

    async def inner(self, data):
        if before:
            before(data)
        yield event

    monkeypatch.setattr(AgentFrameworkAgent, "run", inner)
    # Constructor is inherited; the fake public run needs no model client.
    agent = object.__new__(HistoricalToolSnapshotAgent)
    return [item async for item in agent.run({"messages": messages})]


@pytest.mark.asyncio
async def test_literal_c0_later_copy_removed_without_mutation(monkeypatch):
    source = history()
    event = MessagesSnapshotEvent(messages=[*source, deepcopy(POLICY)], metadata={"trace": None}, timestamp=42)
    before_input, before_event = deepcopy(source), event.model_dump(mode="json", by_alias=True)
    [result] = await drive(monkeypatch, source, event)
    assert [message.id for message in result.messages] == [item["id"] for item in source]
    assert result.model_dump(mode="json", by_alias=True) == {**before_event, "messages": before_event["messages"][:-1]}
    assert all(a is b for a, b in zip(result.messages, event.messages))
    assert source == before_input
    assert event.model_dump(mode="json", by_alias=True) == before_event


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"role": "assistant"}, {"content": "different"}, {"toolCallId": "other"},
    {"metadata": {"receipt": True}}, {"metadata": {}}, {"error": "failed"},
    {"encryptedValue": "secret"}, {"custom": "changed"}, {"subagentRunId": "child"},
    {"tool_call_id": "conflict"}, {"subagent_run_id": "child"},
])
async def test_any_conflicting_copy_denies_entire_group(monkeypatch, change):
    conflicting = {**POLICY, **change}
    # model_construct retains alias collisions for defensive boundary coverage.
    event = MessagesSnapshotEvent.model_construct(messages=[deepcopy(POLICY), deepcopy(POLICY), conflicting])
    [result] = await drive(monkeypatch, history(), event)
    assert result is event


@pytest.mark.asyncio
@pytest.mark.parametrize("messages", [[], [deepcopy(POLICY), deepcopy(POLICY)], [deepcopy(POLICY), {"id": "policy-result", "role": "user", "content": "collision"}]])
async def test_empty_or_ambiguous_history_denies_authority(monkeypatch, messages):
    event = MessagesSnapshotEvent(messages=[POLICY, POLICY])
    [result] = await drive(monkeypatch, messages, event)
    assert result is event


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("toolCallId", ""), ("id", ""), ("subagentRunId", "child"), ("tool_call_id", "conflict")])
async def test_ineligible_history(monkeypatch, field, value):
    record = {**POLICY, field: value}
    event = MessagesSnapshotEvent.model_construct(messages=[record, deepcopy(record)])
    [result] = await drive(monkeypatch, [record], event)
    assert result is event


@pytest.mark.asyncio
@pytest.mark.parametrize("extra", [{"subagentRunId": "child"}, {"subagent_run_id": "child"}])
async def test_child_snapshot_unchanged(monkeypatch, extra):
    event = MessagesSnapshotEvent(messages=[POLICY, POLICY], **extra)
    [result] = await drive(monkeypatch, history(), event)
    assert result is event


@pytest.mark.asyncio
@pytest.mark.parametrize("messages", [[POLICY], [{**POLICY, "id": "new"}] * 2, [{"id": "a", "role": "assistant", "content": "same"}] * 2, [{**POLICY, "subagentRunId": "child"}] * 2])
async def test_unique_new_assistant_child_unchanged(monkeypatch, messages):
    event = MessagesSnapshotEvent(messages=messages)
    [result] = await drive(monkeypatch, history(), event)
    assert result is event


@pytest.mark.asyncio
@pytest.mark.parametrize("old,new", [(True, 1), (False, 0), (1, 1.0)])
async def test_type_faithful_metadata(monkeypatch, old, new):
    original = {**POLICY, "metadata": {"value": old}}
    changed = {**POLICY, "metadata": {"value": new}}
    event = MessagesSnapshotEvent(messages=[changed, changed])
    [result] = await drive(monkeypatch, [original], event)
    assert result is event


@pytest.mark.asyncio
async def test_multiple_groups_and_owned_capture_before_iteration(monkeypatch):
    other = {**POLICY, "id": "other", "toolCallId": "other-call"}
    source = [deepcopy(POLICY), other]
    event = MessagesSnapshotEvent(messages=[POLICY, other, POLICY, other, POLICY])
    [result] = await drive(monkeypatch, source, event, lambda data: data["messages"][0].update(content="mutated by inner"))
    assert [item.id for item in result.messages] == ["policy-result", "other"]


@pytest.mark.asyncio
async def test_non_snapshot_identity(monkeypatch):
    event = RunStartedEvent(thread_id="t", run_id="r")
    [result] = await drive(monkeypatch, history(), event)
    assert result is event


@pytest.mark.asyncio
async def test_public_tool_model_and_optional_null_serialize_consistently(monkeypatch):
    original = ToolMessage.model_validate({**POLICY, "error": None, "encryptedValue": None})
    event = MessagesSnapshotEvent(messages=[POLICY, POLICY])
    [result] = await drive(monkeypatch, [original], event)
    assert result.messages == event.messages[:1]
    assert result.messages[0].model_dump(mode="json", by_alias=True)["custom"] is None
    assert result.messages[0].metadata == {"receipt": None}


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"custom": {}}, {"metadata": {"receipt": float("nan")}}, {"encryptedValue": "a", "encrypted_value": "b"}, {"toolCallId": "policy-call", "tool_call_id": "policy-call"}, {"id": 17}])
async def test_changed_extra_or_invalid_history_grants_no_authority(monkeypatch, change):
    event = MessagesSnapshotEvent(messages=[POLICY, POLICY])
    [result] = await drive(monkeypatch, [{**POLICY, **change}], event)
    assert result is event


@pytest.mark.asyncio
async def test_one_conflicting_group_does_not_hide_its_copies_or_block_valid_group(monkeypatch):
    other = {**POLICY, "id": "other", "toolCallId": "policy-call"}
    event = MessagesSnapshotEvent(messages=[POLICY, other, {**POLICY, "content": "changed"}, other, POLICY])
    [result] = await drive(monkeypatch, [POLICY, other], event)
    assert [item.id for item in result.messages] == ["policy-result", "other", "policy-result", "policy-result"]
    assert result.messages == [event.messages[i] for i in [0, 1, 2, 4]]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["exhaustion", "error", "close", "cancel"])
async def test_immediate_inner_iterator_closed(monkeypatch, mode):
    from src.snapshot_compat import HistoricalToolSnapshotAgent
    closed = []
    waiting = asyncio.Event()

    async def inner(self, data):
        try:
            yield RunStartedEvent(thread_id="t", run_id="r")
            if mode == "error":
                raise RuntimeError("inner failure")
            if mode == "cancel":
                waiting.set()
                await asyncio.Event().wait()
        finally:
            closed.append(True)

    monkeypatch.setattr(AgentFrameworkAgent, "run", inner)
    stream = object.__new__(HistoricalToolSnapshotAgent).run({"messages": history()})
    await anext(stream)
    assert closed == []
    if mode == "close":
        await stream.aclose()
    elif mode == "error":
        with pytest.raises(RuntimeError, match="inner failure"):
            await anext(stream)
    elif mode == "cancel":
        task = asyncio.create_task(anext(stream))
        await waiting.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    else:
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
    assert closed == [True]
