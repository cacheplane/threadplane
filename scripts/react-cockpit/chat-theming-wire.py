"""Actual canonical compiled graph; deterministic local provider seam, never public."""
import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/theming/python"
sys.path.insert(0, str(PROJECT / "tests"))
from providers import AuthoredClient, AuthoredModel
from langchain_core.messages import HumanMessage, AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk
from langgraph.checkpoint.memory import InMemorySaver


class ReasoningModel(AuthoredModel):
    """Explicit local display-data seam; callbacks still originate in BaseChatModel."""
    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        if not self.title:
            yield ChatGenerationChunk(message=AIMessageChunk(
                content="", id=self.answer_id,
                additional_kwargs={"reasoning_content": "Considering the aviation question."},
            ))
        yield from super()._stream(messages, stop, run_manager, **kwargs)


async def main():
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("Wire input exceeds local bound")
    request = json.loads(raw)
    client = AuthoredClient(title=request.get("title"))
    source = PROJECT / "src/graph.py"
    def factory(**kwargs):
        return ReasoningModel(title=not kwargs.get("streaming", False),
            answer_id=request["answerId"], tags=kwargs.get("tags", []))
    with patch.object(socket.socket, "connect", side_effect=AssertionError(
        "Compiled fixture cannot connect to any service"
    )) as connect, patch("langchain_openai.ChatOpenAI", factory), patch(
        "langgraph_sdk.get_client", return_value=client,
    ):
        spec = importlib.util.spec_from_file_location("authored_theming_wire", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        graph = module.build_theming_graph().builder.compile(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": request["threadId"]}}
        messages = [
            (HumanMessage if m["type"] == "human" else AIMessage)(
                content=m["content"], id=m["id"], additional_kwargs=m.get("additional_kwargs", {}))
            for m in request["messages"]
        ]
        events = []
        async for kind, value in graph.astream({"messages": messages}, config, stream_mode=["messages", "values"]):
            if kind == "messages":
                message, metadata = value
                if metadata.get("langgraph_node") == "generate_title":
                    raise AssertionError("Title callbacks leaked")
                events.append([kind, [message.model_dump(mode="json"), metadata]])
            else:
                events.append([kind, {"messages": [m.model_dump(mode="json") for m in value["messages"]]}])
        state = graph.get_state(config)
        connect.assert_not_called()
    print(json.dumps({
        "events": events, "messages": [m.model_dump(mode="json") for m in state.values["messages"]],
        "next": list(state.next), "title": client.threads.title,
        "checkpoint": state.config["configurable"],
        "parentCheckpoint": state.parent_config["configurable"] if state.parent_config else None,
        "createdAt": state.created_at,
        "titleUpdates": client.threads.updates,
        "proof": {"actualCompiledGraph": True, "localProviderSeam": True,
            "reasoningProviderExtension": True,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(),
            "networkConnectAttempts": connect.call_count, "titleMessageCallbacks": 0},
    }))


asyncio.run(main())
