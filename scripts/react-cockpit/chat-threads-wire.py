"""Persistent network-free worker executing the actual compiled Threads graph."""
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
PROJECT = ROOT / "cockpit/chat/threads/python"
sys.path.insert(0, str(PROJECT))
sys.path.insert(0, str(PROJECT / "tests"))
from providers import AuthoredClient, model_factory
from langgraph.checkpoint.memory import InMemorySaver


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported graph wire value")


def checkpoint(state):
    return {
        "values": state.values, "next": list(state.next),
        "checkpoint": state.config["configurable"],
        "parent_checkpoint": state.parent_config["configurable"] if state.parent_config else None,
        "created_at": state.created_at, "metadata": state.metadata,
        "tasks": [{"id": task.id, "name": task.name,
                   "interrupts": [{"id": item.id, "value": item.value} for item in task.interrupts]}
                  for task in state.tasks],
    }


async def main():
    client = AuthoredClient()
    source = PROJECT / "src/graph.py"
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as connect, patch(
        "langchain_openai.ChatOpenAI", model_factory,
    ), patch("langgraph_sdk.get_client", return_value=client):
        with redirect_stdout(sys.stderr):
            spec = importlib.util.spec_from_file_location("authored_threads_wire", source)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_threads_graph().builder.compile(checkpointer=InMemorySaver())
        for line in sys.stdin:
            request = json.loads(line)
            try:
                with redirect_stdout(sys.stderr):
                    config = {"configurable": {"thread_id": request.get("threadId", "")}}
                    if request["op"] == "history":
                        result = {"history": [checkpoint(state) for state in graph.get_state_history(config)]}
                    elif request["op"] == "title":
                        result = {"thread": await client.threads.get(request["threadId"])}
                    elif request["op"] == "configure":
                        client.threads.fail_read = request.get("failMetadata", False)
                        result = {}
                    elif request["op"] == "submit":
                        events = []
                        failure = False
                        try:
                            async for kind, event in graph.astream({"messages": request["messages"]}, config, stream_mode=["messages", "values", "updates"]):
                                if kind == "messages" and event[1].get("langgraph_node") == "generate_title":
                                    raise AssertionError("Title callbacks leaked into answer stream")
                                events.append([kind, event])
                        except RuntimeError:
                            failure = True
                            events.append(["error", {"error": "GraphExecutionError", "message": "The conversation request failed."}])
                        result = {"events": events, "state": checkpoint(graph.get_state(config)), "graphFailure": failure}
                    else:
                        raise ValueError("Unsupported graph operation")
                    connect.assert_not_called()
                result["proof"] = {
                    "actualCompiledGraph": True,
                    "op": request["op"], "threadId": request.get("threadId"),
                    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(),
                    "networkConnectAttempts": connect.call_count, "titleMessageCallbacks": 0,
                }
                result["requestId"] = request["requestId"]
                print(json.dumps(result, default=encode), flush=True)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"requestId": request["requestId"], "error": "Graph operation failed"}), flush=True)


asyncio.run(main())
