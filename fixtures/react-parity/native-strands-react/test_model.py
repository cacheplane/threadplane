"""Exercise real loopback provider requests, including rejected physical attempts."""

import importlib.util
import json
import socket
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class ModelTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.find_spec("model")
        self.assertIsNotNone(spec, "Native Strands model seam must exist")
        from model import Model

        self.Model = Model
        self.owners = []

    def tearDown(self):
        for model, thread in self.owners:
            model.closing.set()
            model.shutdown()
            model.server_close()
            thread.join(2)
            self.assertFalse(thread.is_alive())

    def start(self, mode="approval"):
        model = self.Model(mode)
        thread = threading.Thread(target=model.serve_forever)
        thread.start()
        self.owners.append((model, thread))
        return model

    def post(self, model, messages, path="/v1/chat/completions"):
        raw = json.dumps({"messages": messages, "stream": True}).encode()
        with urlopen(
            Request(f"http://127.0.0.1:{model.server_port}" + path, data=raw), timeout=2
        ) as response:
            data = response.read().decode()
        return [
            json.loads(line[6:])
            for line in data.splitlines()
            if line.startswith("data: {")
        ]

    def initial(self):
        return [{"role": "user", "content": "Book Q3 roadmap review on Tuesday"}]

    def assistant(self, calls):
        return {"role": "assistant", "tool_calls": calls}

    def calls(self, chunks):
        return chunks[1]["choices"][0]["delta"]["tool_calls"]

    def lookup(self, call_id):
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "content": json.dumps({"day": "Tuesday", "slots": ["10:00", "15:00"]}),
        }

    def test_sequential_requires_actual_lookup_and_canonical_decision_results(self):
        for approved in (True, False):
            model = self.start()
            history = self.initial()
            calls = self.calls(self.post(model, history))
            self.assertEqual(calls[0]["function"]["name"], "check_availability")
            history += [self.assistant(calls), self.lookup(calls[0]["id"])]
            calls = self.calls(self.post(model, history))
            self.assertEqual(calls[0]["function"]["name"], "book_meeting")
            canonical = (
                "Meeting booked for Tuesday 10:00: Q3 roadmap review"
                if approved
                else "The human declined. Meeting NOT booked: Q3 roadmap review"
            )
            history += [
                self.assistant(calls),
                {"role": "tool", "tool_call_id": calls[0]["id"], "content": canonical},
            ]
            final = self.post(model, history)
            self.assertEqual(
                final[1]["choices"][0]["delta"]["content"],
                "The Q3 roadmap review booking decision is complete.",
            )
            self.assertEqual(
                model.stats()["records"][-1]["canonicalContinuation"], canonical
            )
            self.assertEqual(model.stats()["httpSeen"], 3)

    def test_batch_requires_both_original_results_before_continuation(self):
        model = self.start("batch")
        history = self.initial()
        calls = self.calls(self.post(model, history))
        self.assertEqual(
            [x["function"]["name"] for x in calls],
            ["check_availability", "book_meeting"],
        )
        history += [
            self.assistant(calls),
            self.lookup(calls[0]["id"]),
            {
                "role": "tool",
                "tool_call_id": calls[1]["id"],
                "content": "The human declined. Meeting NOT booked: Q3 roadmap review",
            },
        ]
        self.post(model, history)
        self.assertEqual(model.stats()["httpSeen"], 2)

    def test_rejected_requests_keep_raw_physical_ledger_and_are_non_retryable(self):
        for invalid in (
            "wrong-path",
            "unknown-tool",
            "wrong-lookup",
            "quoted-result",
            "overflow",
        ):
            model = self.start()
            history = self.initial()
            calls = self.calls(self.post(model, history))
            history += [self.assistant(calls), self.lookup(calls[0]["id"])]
            path = "/v1/chat/completions"
            if invalid == "wrong-path":
                path = "/wrong"
            elif invalid == "unknown-tool":
                history[-1]["tool_call_id"] = "alien"
            elif invalid == "wrong-lookup":
                history[-1]["content"] = "invented slots"
            elif invalid == "quoted-result":
                calls = self.calls(self.post(model, history))
                history += [
                    self.assistant(calls),
                    {
                        "role": "tool",
                        "tool_call_id": calls[0]["id"],
                        "content": json.dumps(
                            "Meeting booked for Tuesday 10:00: Q3 roadmap review"
                        ),
                    },
                ]
            elif invalid == "overflow":
                calls = self.calls(self.post(model, history))
                history += [
                    self.assistant(calls),
                    {
                        "role": "tool",
                        "tool_call_id": calls[0]["id"],
                        "content": "Meeting booked for Tuesday 10:00: Q3 roadmap review",
                    },
                ]
                self.post(model, history)
            before = model.stats()["httpSeen"]
            with self.assertRaises(HTTPError) as error:
                self.post(model, history, path)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            stats = model.stats()
            self.assertEqual(stats["httpSeen"], before + 1)
            self.assertTrue(stats["records"][-1]["requestBase64"])
            self.assertTrue(stats["records"][-1]["error"])

    def test_second_user_turn_has_new_ids_and_ignores_prior_completed_results(self):
        model = self.start("batch")
        history = self.initial()
        first = self.calls(self.post(model, history))
        history += [
            self.assistant(first),
            self.lookup(first[0]["id"]),
            {
                "role": "tool",
                "tool_call_id": first[1]["id"],
                "content": "Meeting booked for Tuesday 10:00: Q3 roadmap review",
            },
        ]
        self.post(model, history)
        history += [
            {"role": "assistant", "content": "Decision complete."},
            {"role": "user", "content": "Book again"},
        ]
        second = self.calls(self.post(model, history))
        self.assertTrue(set(c["id"] for c in first).isdisjoint(c["id"] for c in second))
        history += [
            self.assistant(second),
            self.lookup(second[0]["id"]),
            {
                "role": "tool",
                "tool_call_id": second[1]["id"],
                "content": "The human declined. Meeting NOT booked: Q3 roadmap review",
            },
        ]
        self.post(model, history)
        self.assertEqual(model.stats()["httpSeen"], 4)

    def test_fresh_history_after_pause_issues_new_owned_calls(self):
        model = self.start("batch")
        first = self.calls(self.post(model, self.initial()))
        second = self.calls(self.post(model, self.initial()))
        self.assertTrue(set(c["id"] for c in first).isdisjoint(c["id"] for c in second))

    def test_unexpected_method_is_ledgered_and_rejected_without_retry_status(self):
        model = self.start()
        with self.assertRaises(HTTPError) as error:
            urlopen(
                Request(
                    f"http://127.0.0.1:{model.server_port}/v1/chat/completions",
                    method="GET",
                ),
                timeout=2,
            )
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(model.stats()["httpSeen"], 1)
        self.assertEqual(model.stats()["records"][0]["method"], "GET")

    def test_expected_success_budget_rejects_but_retains_all_excess_physical_attempts(
        self,
    ):
        model = self.start()
        for _ in range(8):
            history = self.initial()
            calls = self.calls(self.post(model, history))
            history += [self.assistant(calls), self.lookup(calls[0]["id"])]
            calls = self.calls(self.post(model, history))
            history += [
                self.assistant(calls),
                {
                    "role": "tool",
                    "tool_call_id": calls[0]["id"],
                    "content": "Meeting booked for Tuesday 10:00: Q3 roadmap review",
                },
            ]
            self.post(model, history)
        for _ in range(2):
            with self.assertRaises(HTTPError) as error:
                self.post(model, self.initial())
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        self.assertEqual(model.stats()["httpSeen"], 26)
        self.assertTrue(
            all(record.get("error") for record in model.stats()["records"][24:])
        )

    def test_held_peer_closure_is_observed_before_cleanup(self):
        model = self.start("cancel")
        peer = socket.create_connection(("127.0.0.1", model.server_port))
        raw = json.dumps({"messages": self.initial(), "stream": True}).encode()
        peer.sendall(
            b"POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nContent-Length: "
            + str(len(raw)).encode()
            + b"\r\n\r\n"
            + raw
        )
        self.assertIn(b"200", peer.recv(4096))
        peer.close()
        deadline = time.monotonic() + 2
        while not model.stats()["records"][0]["closed"] and time.monotonic() < deadline:
            time.sleep(0.01)
        record = model.stats()["records"][0]
        self.assertTrue(record["peerClosed"])
        self.assertFalse(record["cleanupReleased"])


if __name__ == "__main__":
    unittest.main()
