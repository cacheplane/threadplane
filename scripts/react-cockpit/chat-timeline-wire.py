"""Persistent network-free worker executing the actual compiled Timeline graph."""
import asyncio
from contextlib import redirect_stdout
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import traceback
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/timeline/python"
sys.path.insert(0, str(PROJECT))
sys.path.insert(0, str(PROJECT / "tests"))
from test_streaming import LocalModel

class Metadata:
    def __init__(self):
        self.titles = {}
        self.fail_read = False
        self.fail_write = False

    async def get(self, thread_id):
        if self.fail_read:
            raise RuntimeError("Metadata unavailable")
        return {"thread_id": thread_id, "metadata": self.titles.get(thread_id, {})}

    async def update(self, thread_id, metadata):
        if self.fail_write:
            raise RuntimeError("Metadata unavailable")
        self.titles[thread_id] = dict(metadata)

class AuthoredClient:
    def __init__(self):
        self.threads = Metadata()

from langgraph.checkpoint.memory import InMemorySaver


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported graph wire value")


def checkpoint(state, mapped=False):
    result = {
        "values": state.values, "next": list(state.next),
        "checkpoint": {k: v for k, v in state.config["configurable"].items() if k in ["thread_id", "checkpoint_ns", "checkpoint_id", "checkpoint_map"]},
        "parent_checkpoint": dict(state.parent_config["configurable"]) if state.parent_config else None,
        "created_at": state.created_at, "metadata": state.metadata,
        "tasks": [{"id": task.id, "name": task.name,
                   "interrupts": [{"id": item.id, "value": item.value} for item in task.interrupts]}
                  for task in state.tasks],
    }
    if mapped:
        result["checkpoint"]["checkpoint_map"] = {"": result["checkpoint"]["checkpoint_id"]}
        if result["parent_checkpoint"]:
            result["parent_checkpoint"]["checkpoint_map"] = {"": result["parent_checkpoint"]["checkpoint_id"]}
    return result


async def main():
    client = AuthoredClient()
    options = {"fail_title": False, "mapped": False}
    def model_factory(**kwargs):
        return LocalModel(title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []), fail_title=options["fail_title"])
    source = PROJECT / "src/graph.py"
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as connect, patch(
        "langchain_openai.ChatOpenAI", model_factory,
    ), patch("langgraph_sdk.get_client", return_value=client):
        with redirect_stdout(sys.stderr):
            spec = importlib.util.spec_from_file_location("authored_timeline_wire", source)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_timeline_graph().builder.compile(checkpointer=InMemorySaver())
        for line in sys.stdin:
            request = json.loads(line)
            try:
                with redirect_stdout(sys.stderr):
                    config = {"configurable": {"thread_id": request.get("threadId", "")}}
                    if request.get("checkpoint"):
                        config["configurable"].update(request["checkpoint"])
                    if request["op"] == "state":
                        result = {"state": checkpoint(graph.get_state(config), options["mapped"])}
                    elif request["op"] == "history":
                        result = {"history": [checkpoint(state, options["mapped"]) for state in graph.get_state_history(config)]}
                    elif request["op"] == "configure":
                        client.threads.fail_read = request.get("failMetadata", False)
                        client.threads.fail_write = request.get("failWrite", False)
                        options["fail_title"] = request.get("failTitle", False)
                        options["mapped"] = request.get("mapped", options["mapped"])
                        result = {}
                    elif request["op"] == "submit":
                        events = []
                        terminal_config = config
                        failure = False
                        try:
                            async for kind, event in graph.astream({"messages": request["messages"]}, config, stream_mode=["messages", "values", "updates", "checkpoints"]):
                                if kind == "messages" and event[1].get("langgraph_node") == "generate_title":
                                    raise AssertionError("Title callbacks leaked into answer stream")
                                if kind == "checkpoints":
                                    event["config"]["configurable"]["run_id"] = request["runId"]
                                    if options["mapped"]:
                                        position = event["config"]["configurable"]
                                        position["checkpoint_map"] = {"": position["checkpoint_id"]}
                                    terminal_config = event["config"]
                                events.append([kind, event])
                        except RuntimeError:
                            failure = True
                            events.append(["error", {"error": "GraphExecutionError", "message": "The conversation request failed."}])
                        result = {"events": events, "state": checkpoint(graph.get_state(terminal_config), options["mapped"]), "graphFailure": failure}
                    else:
                        raise ValueError("Unsupported graph operation")
                    connect.assert_not_called()
                result["proof"] = {
                    "actualCompiledGraph": True,
                    "op": request["op"], "threadId": request.get("threadId"),
                    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(),
                    "networkConnectAttempts": connect.call_count, "titleMessageCallbacks": 0,
                    "httpCheckpointRepresentation": "root-map" if options["mapped"] else "native",
                }
                result["requestId"] = request["requestId"]
                print(json.dumps(result, default=encode), flush=True)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"requestId": request["requestId"], "error": "Graph operation failed"}), flush=True)


asyncio.run(main())
