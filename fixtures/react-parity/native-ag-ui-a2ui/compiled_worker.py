"""Explicit offline worker: actual module.graph and canonical locked adapter.

The model and title metadata seam replace remote I/O only. No graph nodes,
checkpointer, prompts, callback streams or adapter events are replaced.
"""
import asyncio
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys

ROOT = Path(__file__).resolve().parents[3]
PROJECT = ROOT / "cockpit/ag-ui/a2ui/python"
SOURCE = PROJECT / "src/graph.py"
MAX_BYTES = 16 * 1024 * 1024
MAX_INPUT = 2_000_000


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported evidence value")


def checkpoint(state):
    return {"values": state.values, "next": list(state.next), "checkpoint": state.config.get("configurable", {}), "parent_checkpoint": state.parent_config.get("configurable") if state.parent_config else None, "created_at": state.created_at, "metadata": state.metadata, "tasks": [{"id": task.id, "name": task.name, "error": task.error, "interrupts": [{"id": item.id, "value": item.value} for item in task.interrupts]} for task in state.tasks]}


async def main():
    assert sys.version_info[:2] == (3, 12), "Python 3.12 required"
    # Do not inherit provider/tracing/injection settings even with a bad caller.
    keep = {key: value for key, value in os.environ.items() if key in {"HOME", "TMPDIR", "PATH", "VIRTUAL_ENV", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE"}}
    os.environ.clear()
    os.environ.update(keep)
    os.environ.update(OPENAI_API_KEY="offline-unused-not-a-secret", LANGSMITH_TRACING="false", LANGCHAIN_TRACING_V2="false")
    denied = []

    def deny(event, detail=None):
        if len(denied) < 64:
            denied.append({"event": event, "detail": str(detail)[:128]})
        raise RuntimeError("External network/DNS forbidden in canonical offline worker")

    def audit(event, args):
        if event == "socket.__new__" and args[1] in (socket.AF_INET, socket.AF_INET6):
            deny(event, int(args[1]))
        if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr", "socket.getnameinfo", "socket.sendto", "socket.sendmsg"}:
            deny(event)

    sys.addaudithook(audit)
    socket.socket.connect = lambda *args, **kwargs: deny("socket.connect")
    socket.socket.connect_ex = lambda *args, **kwargs: deny("socket.connect_ex")
    socket.socket.sendto = lambda *args, **kwargs: deny("socket.sendto")
    socket.socket.sendmsg = lambda *args, **kwargs: deny("socket.sendmsg")
    # This guard makes IPv6 unavailable; advertise that before dependency
    # feature probes. Actual IP sockets, DNS, connects and sends stay denied.
    socket.has_ipv6 = False
    sys.path.insert(0, str(PROJECT))
    with redirect_stdout(sys.stderr):
        from ag_ui.core import RunAgentInput
        from ag_ui.encoder import EventEncoder
        from ag_ui_langgraph import LangGraphAgent
        from model import FixtureModel, Metadata
        module = importlib.import_module("src.graph")
        model = FixtureModel(airports=module.AIRPORT_CODES, fares=module.FARE_CLASSES, invalid_attempts=1)
        title = FixtureModel(title=True)
        metadata = Metadata()
        module._llm = model

        def title_model(**kwargs):
            assert kwargs == {"model": module._TITLE_MODEL, "temperature": 0}, "Unexpected title settings"
            return title

        module.ChatOpenAI = title_model
        client = type("LocalMetadataClient", (), {"threads": metadata})()

        def metadata_client(*, url=None):
            assert url is None, "Remote metadata URL forbidden"
            return client

        module.get_client = metadata_client
        graph = module.graph
        agent = LangGraphAgent(name="a2ui", graph=graph)
        encoder = EventEncoder(accept="text/event-stream")

    def emit(value):
        wire = json.dumps(value, default=encode, separators=(",", ":"))
        if len(wire.encode()) > MAX_BYTES:
            raise ValueError("Worker output bound")
        print(wire, flush=True)

    modules = {name: str(Path(sys.modules[name].__file__).resolve()) for name in ["src.graph", "ag_ui_langgraph.agent", "ag_ui_langgraph.endpoint", "ag_ui.encoder.encoder", "langchain_core.language_models.chat_models"]}
    paths = [Path(__file__), Path(__file__).with_name("model.py"), SOURCE, PROJECT / "src/server.py", PROJECT / "pyproject.toml", PROJECT / "uv.lock", *map(Path, modules.values())]
    identity = {"pid": os.getpid(), "python": sys.version.split()[0], "executable": str(Path(sys.executable).resolve()), "environment": sys.prefix, "modules": modules, "versions": {name: importlib.metadata.version(name) for name in ["ag-ui-langgraph", "ag-ui-protocol", "langgraph", "langchain-core"]}, "sources": [{"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in dict.fromkeys(paths)]}
    emit({"ready": identity})
    seen, thread, count = set(), None, 0
    tools = []

    def profile(frame, event, arg):
        if event == "return" and frame.f_code.co_filename == str(SOURCE) and frame.f_code.co_name in {"_find_routes_impl", "_lookup_flight_impl"}:
            tools.append({"name": frame.f_code.co_name, "args": deepcopy({key: frame.f_locals[key] for key in frame.f_code.co_varnames[:frame.f_code.co_argcount]}), "output": deepcopy(arg)})

    while True:
        line = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_INPUT + 1)
        if not line:
            return
        events, wire = [], []
        try:
            count += 1
            assert len(line) <= MAX_INPUT and line.endswith(b"\n") and count <= 4, "Worker request bound"
            request = RunAgentInput.model_validate(json.loads(line))
            assert request.run_id not in seen, "Duplicate run"
            assert thread in (None, request.thread_id), "Foreign thread"
            seen.add(request.run_id)
            thread = request.thread_id
            tools.clear()
            offsets = [len(model.traces), len(title.traces), len(metadata.traces)]

            async def collect():
                # Canonical endpoint clones agent state for each request while
                # the original compiled graph/checkpointer remain shared.
                request_agent = agent.clone()
                async for event in request_agent.run(request):
                    assert len(events) < 512, "Worker event bound"
                    events.append(event.model_dump(mode="json", by_alias=True, exclude_none=True))
                    wire.append(encoder.encode(event))
                    assert sum(len(part.encode()) for part in wire) <= MAX_BYTES // 2, "Adapter wire bound"

            with redirect_stdout(sys.stderr):
                sys.setprofile(profile)
                try:
                    await asyncio.wait_for(collect(), timeout=15)
                finally:
                    sys.setprofile(None)
                config = {"configurable": {"thread_id": thread}}
                state = checkpoint(graph.get_state(config))
                history = [checkpoint(item) for item in graph.get_state_history(config)]
            emit({"events": events, "wire": wire, "observations": {"requestCount": count, "workerPid": os.getpid(), "graphIdentity": id(graph), "checkpointerIdentity": id(graph.checkpointer), "state": state, "history": history, "models": model.traces[offsets[0]:], "title": title.traces[offsets[1]:], "metadata": metadata.traces[offsets[2]:], "tools": tools, "deniedNetwork": denied}})
        except Exception as error:
            emit({"error": str(error)[:2048], "events": events, "wire": wire, "deniedNetwork": denied})
            return


if __name__ == "__main__":
    asyncio.run(main())
