"""Emit real compiled Chat Messages graph events using network-free providers."""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/messages/python"
sys.path.insert(0, str(PROJECT / "tests"))
from providers import AuthoredClient, AuthoredModel
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.checkpoint.memory import InMemorySaver


async def main():
    request = json.load(sys.stdin)
    client = AuthoredClient(title=request.get("title"))
    source = PROJECT / "src/graph.py"
    def factory(**kwargs):
        return AuthoredModel(title=not kwargs.get("streaming", False),
            answer_id=request["answerId"], tags=kwargs.get("tags", []))
    with patch.object(socket.socket, "connect", side_effect=AssertionError(
        "Compiled fixture must never connect to a remote service"
    )) as connect, patch("langchain_openai.ChatOpenAI", factory), patch(
        "langgraph_sdk.get_client", return_value=client,
    ):
        spec = importlib.util.spec_from_file_location("authored_messages_wire", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        graph = module.build_messages_graph().builder.compile(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": request["threadId"]}}
        messages = [
            (HumanMessage if m["type"] == "human" else AIMessage)(content=m["content"], id=m["id"])
            for m in request["messages"]
        ]
        events = []
        async for kind, value in graph.astream({"messages": messages}, config, stream_mode=["messages", "values"]):
            if kind == "messages":
                message, metadata = value
                if metadata.get("langgraph_node") == "generate_title":
                    raise AssertionError("Title callbacks leaked into the answer stream")
                events.append([kind, [message.model_dump(mode="json"), metadata]])
            else:
                events.append([kind, {"messages": [m.model_dump(mode="json") for m in value["messages"]]}])
        state = graph.get_state(config)
        connect.assert_not_called()
    print(json.dumps({
        "events": events,
        "messages": [m.model_dump(mode="json") for m in state.values["messages"]],
        "next": list(state.next),
        "title": client.threads.updates[0][1]["title"] if client.threads.updates else request.get("title"),
        "proof": {"actualCompiledGraph": True, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(),
            "networkConnectAttempts": connect.call_count, "titleMessageCallbacks": 0},
    }))


asyncio.run(main())
