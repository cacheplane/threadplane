"""The cockpit subagents graph, served in the activity convention.

The graph in ``cockpit/ag-ui/subagents/python`` reports each delegation as
``subagent_activity`` custom events. Its own server expands them into the
protocol's ``SUBAGENT_*`` events. Before the protocol had those, the same
events were published as one ``ACTIVITY`` record per child, with
``activityType: "subagent"`` (the capture is in that project's
``docs/wire-capture-subagents.md``). Backends written then still send that
shape, and the session reads it.

This service is that earlier server: the unchanged graph behind the real
``ag-ui-langgraph`` bridge, with the custom events published as activity
records. Run it from the subagents project directory, so ``src`` is the
graph's package.

One identifier differs from the capture. There the record's ``messageId`` was
the delegation's tool call id, and the tool result had an id of its own.
Today's graph gives the tool result the tool call id, and a session keeps one
record per identifier, so the activity record is named ``<tool call id>:activity``
and relates to its call through ``content.toolCallId``, as before.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator

from ag_ui.core import (
    ActivityDeltaEvent,
    ActivitySnapshotEvent,
    BaseEvent,
    EventType,
)
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import FastAPI

from src.graph import graph
from src.streaming.subagent_emitting_agent import _declare_version, _payload


def _record_id(tool_call_id: str) -> str:
    return f"{tool_call_id}:activity"


class ActivityEmittingAgent(LangGraphAgent):
    """Publishes each delegation as one activity record, keyed by its tool call."""

    async def run(self, *args: Any, **kwargs: Any) -> AsyncGenerator[BaseEvent, None]:
        text: dict[str, str] = {}
        async for event in super().run(*args, **kwargs):
            event = _declare_version(event)
            payload = _payload(event)
            if payload is None:
                yield event
                continue
            tid = payload.get("subagent_id")
            phase = payload.get("phase")
            if not isinstance(tid, str) or not isinstance(phase, str):
                continue
            if phase == "started":
                text[tid] = ""
                yield ActivitySnapshotEvent(
                    type=EventType.ACTIVITY_SNAPSHOT,
                    message_id=_record_id(tid),
                    activity_type="subagent",
                    content={
                        "toolCallId": tid,
                        "name": str(payload.get("name") or tid),
                        "status": "running",
                        "text": "",
                    },
                    replace=True,
                )
            elif phase == "message":
                delta = payload.get("delta")
                if not isinstance(delta, str) or not delta:
                    continue
                text[tid] = text.get(tid, "") + delta
                yield ActivityDeltaEvent(
                    type=EventType.ACTIVITY_DELTA,
                    message_id=_record_id(tid),
                    activity_type="subagent",
                    patch=[{"op": "replace", "path": "/text", "value": text[tid]}],
                )
            elif phase in ("finished", "error"):
                patch = [
                    {
                        "op": "replace",
                        "path": "/status",
                        "value": "complete" if phase == "finished" else "error",
                    }
                ]
                if phase == "error":
                    patch.append(
                        {
                            "op": "add",
                            "path": "/state",
                            "value": {"error": str(payload.get("message") or "")},
                        }
                    )
                yield ActivityDeltaEvent(
                    type=EventType.ACTIVITY_DELTA,
                    message_id=_record_id(tid),
                    activity_type="subagent",
                    patch=patch,
                )


agent = ActivityEmittingAgent(name="subagents", graph=graph)
app = FastAPI(title="native-ag-ui-live-activity")
add_langgraph_fastapi_endpoint(app, agent, path="/agent")


@app.get("/ok")
def ok() -> dict:
    return {"ok": True}
