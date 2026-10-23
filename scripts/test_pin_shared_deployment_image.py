"""Offline tests: no Docker daemon, provider requests, or real credentials."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("pin_shared_deployment_image.py")
SHA = "1" * 40
REPOSITORY = "us-central1-docker.pkg.dev/langchain-prod/cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f/shared-dev"
IMAGE = REPOSITORY + "@sha256:" + "a" * 64
DEPLOYMENT = "6d350054-14ea-4031-8463-010ec27f9059"
REVISION = "ed846882-b58d-4d97-b47a-c5e0517eaaed"
SECRET = "offline-secret-never-log"


def deployment(image=REPOSITORY + ":" + SHA, **changes):
    return dict({"id": DEPLOYMENT, "source": "internal_docker",
                 "source_revision_config": {"image_uri": image},
                 "latest_revision_id": REVISION,
                 "active_revision_id": "older-active-revision"}, **changes)


class Response:
    def __init__(self, body, status=200):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.status = status

    def read(self, limit):
        return self.body[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class ImageTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("pin_image", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.env = {"GITHUB_SHA": SHA, "IMAGE_URI": IMAGE, "LANGSMITH_API_KEY": SECRET}

    def invoke(self, responses, env=None):
        calls = []
        def request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if not responses:
                raise AssertionError("Unexpected network attempt")
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(self.module.os.environ, env or self.env, clear=True), \
                patch.object(self.module.urllib.request, "build_opener") as opener, \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            opener.return_value.open.side_effect = lambda req, timeout: request(
                req.method, req.full_url, data=req.data, headers=req.headers, timeout=timeout)
            result = self.module.main(["pin"])
        self.assertNotIn(SECRET, out.getvalue() + err.getvalue())
        return result, calls, out.getvalue(), err.getvalue()

    def test_exact_minimal_patch_then_known_shape_get(self):
        result, calls, out, err = self.invoke([
            Response(deployment()), Response(b""), Response(deployment(IMAGE))])
        self.assertEqual(result, 0)
        self.assertEqual([c[0] for c in calls], ["GET", "PATCH", "GET"])
        self.assertTrue(all(c[1] == "https://api.host.langchain.com/v2/deployments/" + DEPLOYMENT for c in calls))
        self.assertTrue(all(c[2]["timeout"] == 25 for c in calls))
        self.assertEqual(json.loads(calls[1][2]["data"]), {
            "revision_source": "internal_docker", "source_revision_config": {"image_uri": IMAGE}})
        self.assertEqual(out, "desired_revision_id=" + REVISION + "\n")
        self.assertEqual(err, "")

    def test_same_digest_is_idempotent(self):
        result, calls, _, _ = self.invoke([Response(deployment(IMAGE))])
        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 1)

    def test_invalid_inputs_never_request(self):
        for name, value in [("GITHUB_SHA", "bad"), ("IMAGE_URI", "bad"),
                            ("LANGSMITH_API_KEY", ""), ("LANGSMITH_API_KEY", "bad\nkey")]:
            with self.subTest(name=name, value=value):
                result, calls, _, _ = self.invoke([], {**self.env, name: value})
                self.assertEqual(result, 1)
                self.assertEqual(calls, [])

    def test_invalid_desired_source_never_patches(self):
        invalid = [deployment(id="other"), deployment(source="github"),
                   deployment(REPOSITORY + ":" + "2" * 40),
                   deployment(source_revision_config=None), [], {},
                   deployment(latest_revision_id="unsafe\nrevision")]
        for value in invalid:
            with self.subTest(value=value):
                result, calls, _, _ = self.invoke([Response(value)])
                self.assertEqual(result, 1)
                self.assertEqual([c[0] for c in calls], ["GET"])

    def test_bounded_failure_has_no_body_leak_or_retry(self):
        for response in [Response((SECRET + "badJSON").encode()),
                         Response(b"x" * (2 * 1024 * 1024 + 1)),
                         Response(SECRET.encode(), 302), Response(SECRET.encode(), 500),
                         OSError(SECRET)]:
            with self.subTest(response=response):
                result, calls, _, _ = self.invoke([response])
                self.assertEqual(result, 1)
                self.assertEqual(len(calls), 1)

    def test_patch_failure_does_not_replay(self):
        for response in [Response(SECRET.encode(), 307), Response(SECRET.encode(), 500),
                         Response(b"x" * (2 * 1024 * 1024 + 1)), OSError(SECRET)]:
            result, calls, _, _ = self.invoke([Response(deployment()), response])
            self.assertEqual(result, 1)
            self.assertEqual([c[0] for c in calls], ["GET", "PATCH"])

    def test_followup_get_must_confirm_exact_digest(self):
        for value in [deployment(), deployment(IMAGE, id="other"), {},
                      deployment(IMAGE, latest_revision_id=None)]:
            result, calls, out, _ = self.invoke([
                Response(deployment()), Response(b"arbitrary accepted body"), Response(value)])
            self.assertEqual(result, 1)
            self.assertEqual(len(calls), 3)
            self.assertEqual(out, "")

    def test_redirect_handler_refuses_without_following(self):
        handler = self.module.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://other.invalid"))

    def test_inspect_rejects_malformed_or_ambiguous_structured_evidence(self):
        values = [b"not-json", b"null", b"{}", b'"image"',
                  json.dumps([IMAGE, IMAGE]).encode(),
                  json.dumps([IMAGE, "foreign@sha256:" + "a" * 64]).encode()]
        for value in values:
            with self.subTest(value=value), \
                    patch.dict(self.module.os.environ, self.env, clear=True), \
                    patch.object(self.module.subprocess, "run", side_effect=[
                        subprocess.CompletedProcess([], 0, SHA + "\n", ""),
                        subprocess.CompletedProcess([], 0, value.decode(), "")]), \
                    contextlib.redirect_stdout(io.StringIO()) as out, \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(self.module.main(["evidence"]), 1)
                self.assertEqual(out.getvalue(), "")
                self.assertNotIn(SECRET, err.getvalue())

    def test_subprocess_failure_never_leaks_output(self):
        for failure in [subprocess.CalledProcessError(1, [SECRET], output=SECRET),
                        subprocess.TimeoutExpired([SECRET], 25, output=SECRET),
                        FileNotFoundError(SECRET)]:
            with patch.dict(self.module.os.environ, self.env, clear=True), \
                    patch.object(self.module.subprocess, "run", side_effect=failure), \
                    contextlib.redirect_stdout(io.StringIO()) as out, \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(self.module.main(["evidence"]), 1)
                self.assertEqual(out.getvalue(), "")
                self.assertNotIn(SECRET, err.getvalue())


if __name__ == "__main__":
    unittest.main()
