"""Bounded newline-JSON worker running the unchanged compiled Planning builder."""
import asyncio
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket
import sys
import traceback
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/deep-agents/planning/python"
sys.path.insert(0, str(PROJECT / "tests"))
from test_streaming import LocalModel, build, call, responses, todo

SOURCES = ("src/graph.py", "prompts/planning.md", "uv.lock")
MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported graph wire value")


def checkpoint(state):
    return {
        "values": state.values, "next": list(state.next),
        "checkpoint": {k: v for k, v in state.config["configurable"].items()
                       if k in ("thread_id", "checkpoint_id", "checkpoint_ns", "checkpoint_map")},
        "parent_checkpoint": dict(state.parent_config["configurable"]) if state.parent_config else None,
        "created_at": state.created_at, "metadata": state.metadata,
        "tasks": [{"id": t.id, "name": t.name,
                   **({"error": t.error} if t.error is not None else {}),
                   "interrupts": [{"id": item.id, "value": item.value} for item in t.interrupts]}
                  for t in state.tasks],
    }


def batches(scenario, identity):
    write = lambda items, suffix: call(items, identity + "-" + suffix)
    if scenario == "no-write":
        return []
    if scenario == "oversized":
        return [[write([todo(f"Item {i}") for i in range(51)], "oversized")]]
    if scenario == "empty-content":
        return [[write([todo("")], "empty-content")]]
    if scenario == "long-content":
        return [[write([todo("<script>literal</script>" + "x" * 1976)], "long-content")]]
    if scenario == "empty":
        return [[write([], "clear")]]
    if scenario == "duplicates":
        return [[write([todo("Old"), todo("Removed")], "old")],
                [write([todo("Duplicate", "completed"), todo("Duplicate", "in_progress"), todo("First")], "replace")]]
    parallel = [write([todo("Rejected A")], "parallel-a"), write([todo("Rejected B")], "parallel-b")]
    if scenario == "parallel":
        return [parallel]
    if scenario == "recovery":
        return [parallel, [write([todo("Recovered", "in_progress")], "recover")]]
    if scenario == "schema":
        return [[write([todo("Invalid", "invented")], "invalid")]]
    plan = [todo("Check departure weather"), todo("Check destination elevation"),
            todo("Check runway"), todo("Assess mountain conditions")]
    final = [todo(row["content"], "completed" if i < 3 else "in_progress") for i, row in enumerate(plan)]
    lookup = {"name": "lookup_field_elevation", "args": {"airport": "KASE"},
              "id": identity + "-elevation", "type": "tool_call"}
    return [[write(plan, "initial")], [lookup], [write(final, "revision")]]


async def main():
    model = LocalModel()
    scenario = "normal"
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network:
        with redirect_stdout(sys.stderr):
            graph = build(model)
        while line := sys.stdin.buffer.readline(MAX_REQUEST + 1):
            request = {}
            try:
                if len(line) > MAX_REQUEST or not line.endswith(b"\n"):
                    raise ValueError("Oversized request")
                request = json.loads(line)
                with redirect_stdout(sys.stderr):
                    config = {"configurable": {"thread_id": request.get("threadId", "")}}
                    if "checkpoint" in request:
                        requested_checkpoint = request["checkpoint"]
                        if (not isinstance(requested_checkpoint, dict)
                                or requested_checkpoint.get("thread_id") != config["configurable"]["thread_id"]
                                or set(requested_checkpoint) - {"thread_id", "checkpoint_id", "checkpoint_ns", "checkpoint_map"}):
                            raise ValueError("Checkpoint owner mismatch or unsupported fields")
                        config["configurable"].update({k: v for k, v in requested_checkpoint.items() if k != "thread_id"})
                    op = request["op"]
                    if op == "configure":
                        scenario = request["scenario"]
                        if scenario not in ("normal", "empty", "duplicates", "parallel", "recovery", "schema", "no-write", "oversized", "empty-content", "long-content"):
                            raise ValueError("Unsupported scenario")
                        result = {}
                    elif op == "state":
                        result = {"state": checkpoint(await graph.aget_state(config))}
                    elif op == "history":
                        result = {"history": [checkpoint(s) async for s in graph.aget_state_history(config)]}
                    elif op == "submit":
                        identity = request["messages"][0]["id"]
                        model.responses = responses(batches(scenario, identity), identity)
                        model.cursor = 0
                        events = []
                        async for kind, event in graph.astream(
                            {"messages": request["messages"]}, config,
                            stream_mode=["messages", "values", "updates", "checkpoints"]):
                            events.append([kind, deepcopy(event)])
                        result = {"events": events, "state": checkpoint(await graph.aget_state(config))}
                    else:
                        raise ValueError("Unsupported operation")
                    network.assert_not_called()
                result["proof"] = {
                    "actualCompiledGraph": True, "op": op,
                    "threadId": request.get("threadId"), "scenario": scenario,
                    "sourceSha256": {p: hashlib.sha256((PROJECT / p).read_bytes()).hexdigest() for p in SOURCES},
                    "networkConnectAttempts": network.call_count,
                }
                result["requestId"] = request["requestId"]
                wire = json.dumps(result, default=encode)
                if len(wire.encode()) > MAX_RESPONSE:
                    raise ValueError("Oversized response")
                print(wire, flush=True)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"requestId": request.get("requestId"), "error": "Graph operation failed"}), flush=True)


asyncio.run(main())
