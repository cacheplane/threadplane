"""Local OpenAI-only seam. Positive AG-UI always comes from the real bridge.

Every physical request is retained before validation. Expected successful request
counts are rejection thresholds, not a claimed physical-attempt cap. The real
SDK retains its own retry defaults; invalid input receives non-retryable HTTP 400.
At most eight explicit user turns/fresh histories per owner; no operation retry.
"""

import base64
import copy
import http.server
import json
import select
import socket
import threading
import time
import uuid

TOPIC = "Q3 roadmap review"
SLOT = "Tuesday 10:00"
BOOKED = f"Meeting booked for {SLOT}: {TOPIC}"
DECLINED = f"The human declined. Meeting NOT booked: {TOPIC}"
LOOKUP = {"day": "Tuesday", "slots": ["10:00", "15:00"]}


class Model(http.server.ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, mode):
        if mode not in ("approval", "batch", "cancel"):
            raise ValueError("Unknown fixture mode")
        super().__init__(("127.0.0.1", 0), Handler)
        self.mode = mode
        self.records = []
        self.closing = threading.Event()
        self.lock = threading.RLock()
        self.identity = uuid.uuid4().hex
        self.turn = 0
        self.users = []
        self.phase = "new"
        self.calls = []
        self.failed = False
        self.connections = 0

    def update_record(self, record, **values):
        with self.lock:
            record.update(values)

    def stats(self):
        with self.lock:
            return copy.deepcopy(
                {
                    "httpSeen": len(self.records),
                    "records": self.records,
                    "active": sum(not r["closed"] for r in self.records),
                    "heldActive": sum(
                        r.get("held", False) and not r["closed"] for r in self.records
                    ),
                    "connections": self.connections,
                }
            )

    def plan(self, body):
        if self.failed:
            raise ValueError("Scenario already failed; explicit reset required")
        if not isinstance(body, dict) or body.get("stream") is not True:
            raise ValueError("Expected streaming OpenAI request")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("Missing messages")
        users = [m for m in messages if m.get("role") == "user"]
        if not users:
            raise ValueError("Missing user turn")
        current = messages[
            max(i for i, m in enumerate(messages) if m.get("role") == "user") + 1 :
        ]
        # OpenAI does not receive native threadId. An empty current-turn history
        # starts a new explicit invocation; never infer thread identity from text.
        # Nonempty continuation must retain the exact owned user-history prefix.
        if not current:
            if self.turn >= 8:
                raise ValueError("Explicit turn budget exceeded")
            self.turn += 1
            self.users = copy.deepcopy(users)
            self.phase = "lookup"
            self.calls = [
                {
                    "id": f"fixture_{self.identity}_{self.turn}_{name}",
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)},
                }
                for name, args in [
                    ("check_availability", {"day": "Tuesday"}),
                    ("book_meeting", {"topic": TOPIC, "slot": SLOT}),
                ]
            ]
        elif users != self.users:
            raise ValueError("Continuation conversation changed")
        tools = [m for m in current if m.get("role") == "tool"]
        declarations = [
            call
            for m in current
            if m.get("role") == "assistant"
            for call in m.get("tool_calls", [])
        ]
        expected = 0 if self.phase == "lookup" else (1 if self.phase == "book" else 2)
        if self.phase == "complete":
            raise ValueError("Repeated completed operation")
        if len(tools) != expected or len(declarations) != expected:
            raise ValueError("Unexpected tool result/declaration count")
        for index, call in enumerate(declarations):
            target = self.calls[index]
            if (
                call.get("id") != target["id"]
                or call.get("function", {}).get("name") != target["function"]["name"]
                or json.loads(call["function"]["arguments"])
                != json.loads(target["function"]["arguments"])
            ):
                raise ValueError("Unrecognized tool declaration")
            if tools[index].get("tool_call_id") != target["id"]:
                raise ValueError("Unrecognized tool result")
        if tools and json.loads(tools[0]["content"]) != LOOKUP:
            raise ValueError("Unexpected read-only lookup result")
        if expected == 2:
            canonical = tools[1]["content"]
            if canonical not in (BOOKED, DECLINED):
                raise ValueError("Unexpected canonical booking result")
            self.phase = "complete"
            return (
                [
                    {"role": "assistant", "content": ""},
                    {"content": "The Q3 roadmap review booking decision is complete."},
                ],
                "stop",
                canonical,
            )
        if self.mode == "cancel":
            return None, None, None
        selected = (
            self.calls
            if self.mode == "batch"
            else [self.calls[0 if self.phase == "lookup" else 1]]
        )
        self.phase = (
            "finish" if self.mode == "batch" or self.phase == "book" else "book"
        )
        return (
            [
                {"role": "assistant", "content": ""},
                {
                    "tool_calls": [
                        {"index": i, **call} for i, call in enumerate(selected)
                    ]
                },
            ],
            "tool_calls",
            None,
        )


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(3)
        with self.server.lock:
            self.server.connections += 1

    def finish(self):
        try:
            super().finish()
        finally:
            with self.server.lock:
                self.server.connections -= 1

    def log_message(self, *args):
        pass

    def chunk(self, delta, finish=None):
        return {
            "id": "chatcmpl-fixture",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "fixture-loopback",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }

    def do_POST(self):
        model = self.server
        record = {
            "path": self.path,
            "method": self.command,
            "requestHeaders": list(self.headers.items()),
            "requestBase64": "",
            "responseBase64": "",
            "received": time.monotonic(),
            "closed": False,
        }
        with model.lock:
            record["index"] = len(model.records) + 1
            model.records.append(record)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 2_000_000:
                raise ValueError("Request body bound exceeded")
            raw = self.rfile.read(length)
            model.update_record(record, requestBase64=base64.b64encode(raw).decode())
            if self.command != "POST" or self.path != "/v1/chat/completions":
                raise ValueError("Unexpected provider route")
            if record["index"] > 24:
                raise ValueError("Total expected-success request budget exceeded")
            body = json.loads(raw)
            model.update_record(record, body=body)
            with model.lock:
                deltas, finish, canonical = model.plan(body)
            if canonical:
                model.update_record(record, canonicalContinuation=canonical)
            if deltas is None:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                data = (
                    "data: "
                    + json.dumps(self.chunk({"role": "assistant", "content": ""}))
                    + "\n\n"
                ).encode()
                model.update_record(
                    record, responseBase64=base64.b64encode(data).decode()
                )
                self.wfile.write(data)
                self.wfile.flush()
                model.update_record(record, held=True)
                deadline = time.monotonic() + 20
                while not model.closing.is_set() and time.monotonic() < deadline:
                    ready, _, _ = select.select([self.connection], [], [], 0.02)
                    if ready:
                        try:
                            closed = self.connection.recv(1, socket.MSG_PEEK) == b""
                        except (ConnectionResetError, OSError):
                            closed = True
                        if closed:
                            model.update_record(record, peerClosed=True)
                            model.update_record(record, peerClosedAt=time.monotonic())
                            break
                model.update_record(record, cleanupReleased=model.closing.is_set())
                model.update_record(
                    record,
                    heldDeadlineExceeded=not record.get("peerClosed", False)
                    and not model.closing.is_set(),
                )
                return
            data = b"".join(
                ("data: " + json.dumps(self.chunk(delta)) + "\n\n").encode()
                for delta in deltas + [{}]
            )
            data += (
                "data: " + json.dumps(self.chunk({}, finish)) + "\n\ndata: [DONE]\n\n"
            ).encode()
            model.update_record(record, responseBase64=base64.b64encode(data).decode())
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()
        except Exception as error:
            model.update_record(record, error=repr(error))
            with model.lock:
                model.failed = True
            try:
                self.send_error(400, "Invalid bounded fixture request")
            except OSError:
                pass
        finally:
            model.update_record(record, closed=True)
            self.close_connection = True

    do_GET = do_HEAD = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_POST
