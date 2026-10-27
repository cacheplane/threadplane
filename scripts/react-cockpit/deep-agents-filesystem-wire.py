"""Bounded newline-JSON worker running the unchanged compiled Filesystem builder."""
import asyncio
from dataclasses import asdict, is_dataclass
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
PROJECT = ROOT / "cockpit/deep-agents/filesystem/python"
sys.path.insert(0, str(PROJECT / "tests"))
from test_streaming import LocalModel, build, call, responses, write

SOURCES = ("src/graph.py", "prompts/filesystem.md", "uv.lock")
MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if is_dataclass(value):
        return asdict(value)
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
                   **({"state": t.state} if t.state is not None else {}),
                   "interrupts": [{"id": item.id, "value": item.value} for item in t.interrupts]}
                  for t in state.tasks],
    }


SCENARIOS = ("normal", "no-files", "unchanged", "read-only", "empty", "overwrite", "report-overwrite", "edit", "delete", "batch", "duplicates", "reject-reproposal", "write-error", "protected-edit", "mixed")

def batches(scenario, identity):
    w = lambda path, text, suffix: write(path, text, identity + "-" + suffix)
    note = w("/notes/kase.txt", "KASE field elevation is 7820 ft.", "note")
    report = w("/reports/kase.md", "KASE assessment ready.", "report")
    if scenario in ("no-files", "unchanged"):
        return []
    if scenario == "read-only":
        return [[call("ls", {"path":"/"}, identity+"-ls")]]
    if scenario == "empty":
        return [[w("/notes/empty.txt", "", "empty")]]
    if scenario == "write-error":
        return [[call("write_file", {"file_path":"/notes/invalid.txt", "content":42}, identity+"-invalid")]]
    if scenario == "mixed":
        return [[note, report, call("read_file", {"file_path":"/notes/kase.txt"}, identity+"-read")]]
    if scenario == "protected-edit":
        return [[w("/reports/existing.md", "old old", "initial")], [call("edit_file", {"file_path":"/reports/existing.md", "old_string":"old", "new_string":"new", "replace_all":True}, identity+"-edit")]]
    if scenario == "report-overwrite":
        return [[w("/reports/existing.md", "Prior report", "initial")],
                [w("/reports/existing.md", "Replacement report", "replacement")]]
    if scenario == "overwrite":
        return [[note], [w("/notes/kase.txt", "Replacement", "overwrite")]]
    if scenario == "edit":
        return [[note], [call("edit_file", {"file_path":"/notes/kase.txt", "old_string":"KASE", "new_string":"Aspen", "replace_all":True}, identity+"-edit")]]
    if scenario == "delete":
        return [[report], [call("delete", {"file_path":"/reports"}, identity+"-delete")]]
    if scenario in ("batch", "duplicates"):
        path = "/reports/kase.md" if scenario == "duplicates" else "/reports/second.md"
        return [[note], [report, w(path, "Second report", "second")]]
    if scenario == "reject-reproposal":
        return [[note], [report], [w("/reports/kase.md", "Revised assessment", "reproposal")]]
    return [[note], [report]]


async def main():
    model = LocalModel()
    scenario = "normal"
    owners = set()
    seen = set()
    scripts = {}
    request_ids = set()
    provenance = {}
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as network:
        with redirect_stdout(sys.stderr):
            graph = build(model)
        while line := sys.stdin.buffer.readline(MAX_REQUEST + 1):
            request = {}
            try:
                if len(line) > MAX_REQUEST or not line.endswith(b"\n"):
                    raise ValueError("Oversized request")
                request = json.loads(line)
                if not isinstance(request, dict) or set(request) - {"requestId", "op", "threadId", "scenario", "checkpoint", "messages", "command"}:
                    raise ValueError("Malformed request")
                if type(request.get("requestId")) is not int or request["requestId"] <= 0 or request["requestId"] in request_ids or len(request_ids) >= 2000:
                    raise ValueError("Invalid/replayed request id or lifetime limit")
                request_ids.add(request["requestId"])
                with redirect_stdout(sys.stderr):
                    config = {"configurable": {"thread_id": request.get("threadId", "")}}
                    op = request["op"]
                    fields = {"create": {"threadId"}, "configure": {"scenario"}, "state": {"threadId", "checkpoint"},
                              "history": {"threadId"}, "submit": {"threadId", "messages"}, "resume": {"threadId", "command"}}
                    if op not in fields or set(request) - ({"requestId", "op"} | fields[op]):
                        raise ValueError("Unsupported operation fields")
                    if op == "create":
                        if not isinstance(request.get("threadId"), str) or not request["threadId"] or request["threadId"] in owners or len(owners) >= 100:
                            raise ValueError("Invalid or duplicate owner")
                        owners.add(request["threadId"])
                    elif op != "configure" and request.get("threadId") not in owners:
                        raise ValueError("Unknown owner")
                    if "checkpoint" in request:
                        requested_checkpoint = request["checkpoint"]
                        if (not isinstance(requested_checkpoint, dict)
                                or requested_checkpoint.get("thread_id") != config["configurable"]["thread_id"]
                                or set(requested_checkpoint) - {"thread_id", "checkpoint_id", "checkpoint_ns", "checkpoint_map"}
                                or not isinstance(requested_checkpoint.get("checkpoint_id"), str)
                                or not requested_checkpoint["checkpoint_id"]
                                or not isinstance(requested_checkpoint.get("checkpoint_ns"), str)):
                            raise ValueError("Checkpoint owner mismatch or unsupported fields")
                        if "checkpoint_map" in requested_checkpoint and (
                            not isinstance(requested_checkpoint["checkpoint_map"], dict)
                            or set(requested_checkpoint["checkpoint_map"]) != {requested_checkpoint["checkpoint_ns"]}
                            or requested_checkpoint["checkpoint_map"][requested_checkpoint["checkpoint_ns"]] != requested_checkpoint["checkpoint_id"]):
                            raise ValueError("Checkpoint owner mismatch or unsupported fields")
                        known = [s async for s in graph.aget_state_history(config)]
                        if not any(s.config["configurable"].get("checkpoint_id") == requested_checkpoint.get("checkpoint_id") and s.config["configurable"].get("checkpoint_ns", "") == requested_checkpoint.get("checkpoint_ns") for s in known):
                            raise ValueError("Unknown checkpoint")
                        config["configurable"].update({k: v for k, v in requested_checkpoint.items() if k != "thread_id"})
                    op = request["op"]
                    if op == "configure":
                        scenario = request["scenario"]
                        if scenario not in SCENARIOS:
                            raise ValueError("Unsupported scenario")
                        result = {}
                    elif op == "create":
                        result = {}
                    elif op == "state":
                        result = {"state": checkpoint(await graph.aget_state(config))}
                    elif op == "history":
                        result = {"history": [checkpoint(s) async for s in graph.aget_state_history(config)]}
                    elif op == "submit":
                        current = await graph.aget_state(config)
                        if any(t.interrupts for t in current.tasks):
                            raise ValueError("Cannot submit over paused batch")
                        messages = request.get("messages")
                        if not isinstance(messages, list) or len(messages) != 1:
                            raise ValueError("Expected one human message")
                        message = messages[0]
                        if not isinstance(message, dict) or set(message) != {"type", "id", "content"} or message["type"] != "human" or not isinstance(message["id"], str) or not message["id"].strip() or not isinstance(message["content"], str):
                            raise ValueError("Invalid human message")
                        identity = message["id"]
                        if (request["threadId"], identity) in seen:
                            raise ValueError("Replayed human message")
                        seen.add((request["threadId"], identity))
                        model.responses = responses(batches(scenario, identity), identity)
                        model.cursor = 0
                        provenance[request["threadId"]] = scenario
                        events = []
                        async for kind, event in graph.astream(
                            {"messages": request["messages"]}, config,
                            stream_mode=["messages", "values", "updates", "checkpoints"]):
                            events.append([kind, deepcopy(event)])
                        scripts[request["threadId"]] = (model.responses, model.cursor)
                        result = {"events": events, "state": checkpoint(await graph.aget_state(config))}
                    elif op == "resume":
                        from langgraph.types import Command
                        current = await graph.aget_state(config)
                        interrupts = [i for t in current.tasks for i in t.interrupts]
                        command = request.get("command")
                        if not isinstance(command, dict) or set(command) != {"resume"} or not isinstance(command["resume"], dict) or set(command["resume"]) != {"decisions"} or len(interrupts) != 1:
                            raise ValueError("No current batch or invalid command")
                        decisions = command["resume"]["decisions"]
                        batch = interrupts[0].value
                        if not isinstance(decisions, list) or len(decisions) != len(batch["action_requests"]):
                            raise ValueError("Decision count mismatch")
                        for decision, review in zip(decisions, batch["review_configs"]):
                            if not isinstance(decision, dict) or set(decision) != {"type"} or decision["type"] not in ("approve", "reject") or decision["type"] not in review["allowed_decisions"]:
                                raise ValueError("Unsupported decision")
                        model.responses, model.cursor = scripts[request["threadId"]]
                        events = []
                        async for kind, event in graph.astream(Command(resume=command["resume"]), config,
                            stream_mode=["messages", "values", "updates", "checkpoints"]):
                            events.append([kind, deepcopy(event)])
                        scripts[request["threadId"]] = (model.responses, model.cursor)
                        result = {"events": events, "state": checkpoint(await graph.aget_state(config))}
                    else:
                        raise ValueError("Unsupported operation")
                    network.assert_not_called()
                result["proof"] = {
                    "actualCompiledGraph": True, "op": op,
                    "threadId": request.get("threadId"), "scenario": provenance.get(request.get("threadId"), scenario),
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
                print(json.dumps({"requestId": (request.get("requestId") if isinstance(request, dict) else None), "error": "Graph operation failed"}), flush=True)


asyncio.run(main())
