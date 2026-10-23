"""Direct unchanged generated Strands ASGI service; passive body/profile taps.

Captured bytes are ASGI bodies, not HTTP framing or TCP packets. Profile None
returns at interrupt are unwinds, never counted as completed bookings.
"""

import base64
import hashlib
import importlib.metadata
import json
import os
import re
from pathlib import Path
import signal
import socket
import sys
import threading
from contextlib import nullcontext
from model import Model, BOOKED, DECLINED

ROOT = Path(os.environ["STRANDS_FIXTURE_ROOT"])
model = Model(os.environ["STRANDS_FIXTURE_MODE"])
model_thread = threading.Thread(target=model.serve_forever)
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex
blocked = []


def checked_address(address):
    if not isinstance(address, tuple) or address[:2] != (
        "127.0.0.1",
        model.server_port,
    ):
        blocked.append(repr(address))
        raise RuntimeError("Fixture blocked non-owned model destination")


def connect(self, address):
    checked_address(address)
    return original_connect(self, address)


def connect_ex(self, address):
    checked_address(address)
    return original_connect_ex(self, address)


socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
os.environ["OPENAI_BASE_URL"] = f"http://127.0.0.1:{model.server_port}/v1"
sys.path.insert(0, str(ROOT / "deployments/ag-ui-dev/deps/aws_strands"))
from src import server, agent, subagent_emitter  # noqa: E402 - redirect/guard before provider imports

target = agent.book_meeting.__wrapped__.__code__
profile_events = []


def profile(frame, event, arg):
    if frame.f_code is target and event in ("call", "return"):
        profile_events.append(
            {
                "event": event,
                "line": frame.f_lineno,
                "result": arg if isinstance(arg, str) else None,
            }
        )


sys.setprofile(profile)
threading.setprofile(profile)
requests = []
observed_snapshots = []


class Tap:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope["path"] == "/fixture-stats":
            if (
                dict(scope["headers"]).get(b"x-internal-token")
                != os.environ["AG_UI_INTERNAL_TOKEN"].encode()
            ):
                await send(
                    {"type": "http.response.start", "status": 403, "headers": []}
                )
                await send({"type": "http.response.body", "body": b""})
                return
        if scope["path"] != "/agent":
            return await self.app(scope, receive, send)
        incoming = bytearray()
        outgoing = bytearray()
        pending = bytearray()
        record = {
            "requestBase64": "",
            "responseBase64": "",
            "closed": False,
            "headers": [(k.decode(), v.decode()) for k, v in scope["headers"]],
        }
        requests.append(record)

        async def recv():
            message = await receive()
            if message["type"] == "http.request":
                incoming.extend(message.get("body", b""))
                record["requestBase64"] = base64.b64encode(incoming).decode()
            return message

        async def emit(message):
            if message["type"] == "http.response.start":
                record["status"] = message["status"]
            if message["type"] == "http.response.body":
                outgoing.extend(message.get("body", b""))
                record["responseBase64"] = base64.b64encode(outgoing).decode()
                # Read only after retaining the untouched ASGI body bytes.
                pending.extend(message.get("body", b""))
                while match := re.search(rb"\r?\n\r?\n", pending):
                    frame = bytes(pending[: match.start()])
                    del pending[: match.end()]
                    for line in frame.splitlines():
                        if line.startswith(b"data: "):
                            try:
                                event = json.loads(line[6:])
                            except (ValueError, UnicodeDecodeError):
                                continue
                            if event.get("type") == "STATE_SNAPSHOT":
                                observed_snapshots.append(event["snapshot"])

            await send(message)

        try:
            await self.app(scope, recv, emit)
        finally:
            record["closed"] = True


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@server.app.get("/fixture-stats")
def stats():
    return {
        "entries": sum(e["event"] == "call" for e in profile_events),
        "interruptedUnwinds": sum(
            e["event"] == "return" and e["result"] is None for e in profile_events
        ),
        "completedReturns": [
            e
            for e in profile_events
            if e["event"] == "return" and e["result"] in (BOOKED, DECLINED)
        ],
        "profile": profile_events,
        "backendState": agent._state,
        "observedState": observed_snapshots[-1] if observed_snapshots else None,
        "requests": requests,
        "blocked": blocked,
        "model": model.stats(),
        "pid": os.getpid(),
        "python": sys.version,
        "modelPort": model.server_port,
        "modules": {
            name: {"path": module.__file__, "sha256": sha(module.__file__)}
            for name, module in [
                ("server", server),
                ("agent", agent),
                ("subagent_emitter", subagent_emitter),
            ]
        },
        "versions": {
            name: importlib.metadata.version(name)
            for name in [
                "ag-ui-strands",
                "ag-ui-protocol",
                "strands-agents",
                "openai",
                "fastapi",
                "uvicorn",
            ]
        },
    }


if __name__ == "__main__":
    import uvicorn

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    model_started = False
    try:
        # Allocate and retain the socket; no unowned port crosses processes.
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        owned = uvicorn.Server(
            uvicorn.Config(
                Tap(server.app),
                host="127.0.0.1",
                port=0,
                log_level="warning",
                timeout_graceful_shutdown=2,
            )
        )
        owned.capture_signals = nullcontext
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: setattr(owned, "should_exit", True))
        model_thread.start()
        model_started = True
        host, port = listener.getsockname()
        print(
            "STRANDS_FIXTURE_READY "
            + json.dumps({"host": host, "port": port, "pid": os.getpid()}),
            flush=True,
        )
        owned.run(sockets=[listener])
    finally:
        listener.close()
        model.closing.set()
        if model_started:
            model.shutdown()
        model.server_close()
        if model_started:
            model_thread.join(3)
        print(
            "\n"
            + json.dumps(
                {
                    "fixtureClosed": True,
                    "modelThreadClosed": not model_thread.is_alive(),
                    "model": model.stats(),
                    "backendState": agent._state,
                    "observedState": observed_snapshots[-1]
                    if observed_snapshots
                    else None,
                }
            ),
            flush=True,
        )
