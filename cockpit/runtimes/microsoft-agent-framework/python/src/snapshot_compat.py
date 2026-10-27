"""Example-owned compatibility for pinned MAF historical tool snapshots.

Only exact repeats of an unambiguous request-history root tool record can
be removed. Conflicting or novel identities remain for the client to reject.
"""
import json
from collections import Counter, defaultdict
from collections.abc import Mapping
from contextlib import aclosing

from ag_ui.core import EventType, ToolMessage
from agent_framework.ag_ui import AgentFrameworkAgent
from pydantic import ValidationError


def _record(value):
    if isinstance(value, Mapping):
        return dict(value)
    return value.model_dump(mode="json", by_alias=True)


def _root(record):
    return not any(record.get(key) is not None for key in ("subagentRunId", "subagent_run_id"))


def _canonical_tool(value):
    """Own a full JSON value, using the public model's optional-field serializer."""
    try:
        record = _record(value)
        # Duplicate aliases are ambiguous even when Python equality says equal.
        for name, field in ToolMessage.model_fields.items():
            if field.alias != name and name in record and field.alias in record:
                return None
        if record.get("role") != "tool" or not _root(record):
            return None
        # Reject non-JSON extras and NaN before model serialization can coerce them.
        json.dumps(record, allow_nan=False)
        model = ToolMessage.model_validate(record, strict=True)
        if not model.id or not model.tool_call_id:
            return None
        return json.dumps(model.model_dump(mode="json", by_alias=True), sort_keys=True, allow_nan=False, separators=(",", ":"))
    except (AttributeError, TypeError, ValueError, ValidationError):
        return None


def _historical_tools(messages):
    records = []
    for message in messages:
        try:
            records.append(_record(message))
        except (AttributeError, TypeError, ValueError):
            continue
    counts = Counter(record.get("id") for record in records if isinstance(record.get("id"), str))
    return {
        record["id"]: normalized
        for record in records
        if isinstance(record.get("id"), str) and counts[record["id"]] == 1
        and (normalized := _canonical_tool(record)) is not None
    }


def _snapshot(event, historical):
    if event.type != EventType.MESSAGES_SNAPSHOT or not _root({**vars(event), **(event.model_extra or {})}):
        return event
    groups = defaultdict(list)
    for message in event.messages:
        record = _record(message)
        identity = record.get("id")
        if isinstance(identity, str):
            groups[identity].append(message)
    removable = {
        identity for identity, copies in groups.items()
        if len(copies) > 1 and identity in historical
        and all(_canonical_tool(copy) == historical[identity] for copy in copies)
    }
    if not removable:
        return event
    seen = set()
    messages = []
    for message in event.messages:
        identity = _record(message).get("id")
        if identity in removable:
            if identity in seen:
                continue
            seen.add(identity)
        messages.append(message)
    return event.model_copy(update={"messages": messages})


class HistoricalToolSnapshotAgent(AgentFrameworkAgent):
    """Keep the public bridge API while repairing only proven historical repeats."""

    async def run(self, input_data):
        # Capture owned values before the inner iterator can mutate request history.
        historical = _historical_tools(input_data.get("messages", []))
        async with aclosing(super().run(input_data)) as inner:
            async for event in inner:
                yield _snapshot(event, historical)
