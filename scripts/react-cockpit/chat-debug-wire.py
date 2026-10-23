"""Local JSONL adapter of the actual Debug graph, never a platform server.

StateSnapshot.config.configurable is the SDK checkpoint object; parent_config,
created_at, next and tasks come from the real saver snapshot. Message model_dump
is the same public LangChain JSON shape consumed by the installed JS SDK.
The messages stream is replayed as SSE `messages` tuples (SDK messages-tuple).
No callback/title filtering or graph-authored authority is introduced here.
"""
import sys

# Closed local failure fixtures run before importing the graph stack. They never
# inspect environment, open sockets, or execute caller-supplied code.
if len(sys.argv) == 2 and sys.argv[1].startswith("--fault="):
    import signal
    import time
    fault = sys.argv[1].split("=", 1)[1]
    if fault == "malformed":
        sys.stdout.write("not-json\n")
        sys.stdout.flush()
    elif fault == "partial-oversize":
        sys.stdout.write("x" * 65537)
        sys.stdout.flush()
    elif fault == "stderr-overflow":
        sys.stderr.write("x" * 65537)
        sys.stderr.flush()
    elif fault == "ignore-term":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    elif fault == "late-result":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        sys.stdin.buffer.readline(65537)
        time.sleep(0.2)
        sys.stdout.write('{"requestId":1,"result":{"late":true}}\n')
        sys.stdout.flush()
    else:
        sys.exit(2)
    time.sleep(30)
    sys.exit(0)

import asyncio
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/debug/python"
SOURCE = PROJECT / "src/graph.py"
MAX_FRAME = 65536
attempts = 0


class BoundedSink:
    """Discard content, retain bounded counts; never echo exception/secret text."""
    def __init__(self):
        self.bytes = 0

    def write(self, text):
        self.bytes = min(65537, self.bytes + len(text.encode("utf-8")))
        if self.bytes > 65536:
            raise ValueError("diagnostics bound")
        return len(text)

    def flush(self):
        pass


def reject_network(*args, **kwargs):
    global attempts
    attempts += 1
    raise AssertionError("network forbidden")


def serialize(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "_asdict"):
        return {k: serialize(v) for k, v in value._asdict().items()}
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    return value


def state_wire(state):
    return {
        "values": serialize(state.values), "next": list(state.next),
        "checkpoint": state.config["configurable"],
        "parent_checkpoint": state.parent_config["configurable"] if state.parent_config else None,
        "created_at": state.created_at, "metadata": serialize(state.metadata),
        "tasks": serialize(state.tasks),
    }


def validate(request):
    if not isinstance(request, dict):
        raise ValueError("schema")
    command = request.get("command")
    keys = {
        "create": {"threadId"}, "send": {"threadId", "human"},
        "current": {"threadId"}, "history": {"threadId", "limit"},
        "checkpoint": {"threadId", "checkpoint"}, "reset": set(), "close": set(),
    }
    if command not in keys or set(request) != {"requestId", "command"} | keys[command]:
        raise ValueError("schema")
    if not isinstance(request["requestId"], int) or isinstance(request["requestId"], bool) or request["requestId"] < 1:
        raise ValueError("request identity")
    if "threadId" in request:
        from uuid import UUID
        if str(UUID(request["threadId"])) != request["threadId"]:
            raise ValueError("thread identity")
    if command == "send":
        human = request["human"]
        if not isinstance(human, dict) or set(human) != {"type", "id", "content"}:
            raise ValueError("human")
        if human["type"] != "human" or not isinstance(human["id"], str) or not 1 <= len(human["id"]) <= 128:
            raise ValueError("human identity")
        if not isinstance(human["content"], str) or not 1 <= len(human["content"]) <= 2000:
            raise ValueError("human content")
    if command == "history" and (type(request["limit"]) is not int or not 1 <= request["limit"] <= 10):
        raise ValueError("history bound")
    if command == "checkpoint":
        cp = request["checkpoint"]
        if not isinstance(cp, dict) or set(cp) - {"thread_id", "checkpoint_ns", "checkpoint_id", "checkpoint_map"}:
            raise ValueError("checkpoint")
        if cp.get("thread_id") != request["threadId"] or cp.get("checkpoint_ns") != "" or not isinstance(cp.get("checkpoint_id"), str):
            raise ValueError("checkpoint identity")


async def main():
    threads = {}
    count = 0
    seen = set()
    with ExitStack() as stack:
        for owner, name in ((socket.socket, "connect"), (socket.socket, "connect_ex"),
                            (socket, "getaddrinfo"), (socket, "gethostbyname"),
                            (socket, "gethostbyname_ex"), (socket, "gethostbyaddr"),
                            (socket, "getnameinfo")):
            stack.enter_context(patch.object(owner, name, reject_network))
        sink = BoundedSink()
        with redirect_stdout(sink), redirect_stderr(sink):
            sys.path.insert(0, str(PROJECT / "tests"))
            from providers import AuthoredClient, AuthoredProvider, AuthoredModel, Invocation
            from langgraph.checkpoint.memory import InMemorySaver
            from langchain_core.messages import HumanMessage
            arguments = sys.argv[1:]
            if (len(arguments) != len(set(arguments))
                    or any(arg not in {"--variant=unicode", "--metadata-failure=read", "--metadata-failure=update"}
                           for arg in arguments)
                    or sum(arg.startswith("--metadata-failure=") for arg in arguments) > 1):
                raise ValueError("invalid worker variant")
            variant = "unicode" if "--variant=unicode" in arguments else "natural"
            metadata_failure = next((arg.split("=", 1)[1] for arg in arguments
                                     if arg.startswith("--metadata-failure=")), None)

            class UnicodeModel(AuthoredModel):
                """Explicit provider seam: only generated A gains an astral prefix.

                BaseChatModel still owns callbacks/streaming and the actual graph
                computes analysis from this generated content. Natural runs use
                the accepted AuthoredProvider unchanged.
                """
                def _begin(self, messages):
                    call = super()._begin(messages)
                    if call.node == "generate":
                        call = Invocation(call.node, "🛩️ " + call.content, call.id)
                        self._provider.calls[-1] = call
                    return call

            class UnicodeProvider(AuthoredProvider):
                def model_factory(self, **kwargs):
                    model = UnicodeModel(title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []))
                    model._provider = self
                    return model
        while True:
            raw = sys.stdin.buffer.readline(MAX_FRAME + 1)
            if not raw:
                break
            if len(raw) > MAX_FRAME or not raw.endswith(b"\n"):
                raise ValueError("frame bound")
            request_id = None
            close = False
            try:
                request = json.loads(raw)
                if isinstance(request, dict):
                    request_id = request.get("requestId")
                validate(request)
                request_id = request["requestId"]
                if request_id in seen or count >= 64:
                    raise ValueError("command bound or duplicate")
                seen.add(request_id)
                count += 1
                command = request["command"]
                with redirect_stdout(sink), redirect_stderr(sink):
                    if command == "create":
                        thread_id = request["threadId"]
                        if thread_id in threads or len(threads) >= 4:
                            raise ValueError("thread bound or duplicate")
                        provider = UnicodeProvider() if variant == "unicode" else AuthoredProvider()
                        client = AuthoredClient(fail_read=metadata_failure == "read", fail_update=metadata_failure == "update")
                        with patch("langchain_openai.ChatOpenAI", provider.model_factory), patch("langgraph_sdk.get_client", return_value=client):
                            spec = importlib.util.spec_from_file_location(f"local_debug_{len(threads)}", SOURCE)
                            module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(module)
                            graph = module.build_debug_graph().builder.compile(checkpointer=InMemorySaver())
                        threads[thread_id] = (graph, provider, client)
                        result = {"thread_id": thread_id}
                    elif command in {"reset", "close"}:
                        threads.clear()
                        close = command == "close"
                        result = {}
                    else:
                        graph, provider, client = threads[request["threadId"]]
                        config = {"configurable": {"thread_id": request["threadId"]}}
                        with patch("langchain_openai.ChatOpenAI", provider.model_factory), patch("langgraph_sdk.get_client", return_value=client):
                            if command == "send":
                                human = request["human"]
                                if any(m.id == human["id"] for m in graph.get_state(config).values.get("messages", [])):
                                    raise ValueError("duplicate human")
                                events = []
                                async for kind, value in graph.astream({"messages": [HumanMessage(content=human["content"], id=human["id"])]}, config,
                                                                     stream_mode=["messages", "values", "updates"]):
                                    events.append([kind, serialize(value)])
                                result = {"events": events, "state": state_wire(graph.get_state(config)),
                                          "title": client.threads.title, "titleUpdates": serialize(client.threads.updates),
                                          "proof": {"actualCompiledGraph": True, "networkAttempts": attempts,
                                                    "providerVariant": variant,
                                                    "metadataFailure": metadata_failure,
                                                    "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                                                    "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest()}}
                            elif command == "history":
                                result = [state_wire(s) for s in graph.get_state_history(config, limit=request["limit"])]
                            else:
                                if command == "checkpoint":
                                    config = {"configurable": request["checkpoint"]}
                                result = state_wire(graph.get_state(config))
                                if command == "checkpoint" and result["checkpoint"] != request["checkpoint"]:
                                    raise ValueError("exact checkpoint mismatch")
                if attempts:
                    raise AssertionError("network attempt swallowed")
                response = {"requestId": request_id, "result": result}
            except Exception:
                response = {"requestId": request_id, "error": "Local graph request rejected"}
            finally:
                if attempts:
                    raise AssertionError("network attempt swallowed")
            encoded = json.dumps(response, ensure_ascii=False).encode("utf-8") + b"\n"
            if len(encoded) > MAX_FRAME:
                raise ValueError("response frame bound")
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
            if close:
                break
        if sink.bytes:
            sys.stderr.write("Local graph diagnostics suppressed\n")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        sys.stderr.write("Local graph worker terminated safely\n")
        sys.exit(1)
