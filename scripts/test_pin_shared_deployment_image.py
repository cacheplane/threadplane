"""Offline tests: no Docker daemon, provider requests, or real credentials."""

import contextlib
import importlib.util
import io
import json
import os
import signal
import stat
import tempfile
import time
import urllib.error
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("pin_shared_deployment_image.py")
SHA = "1" * 40
REPOSITORY = "us-east4-docker.pkg.dev/langchain-prod/cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f/shared-dev"
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
        self.position = 0

    def read(self, limit):
        result = self.body[self.position:self.position + limit]
        self.position += len(result)
        return result

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class BaseTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("pin_image", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.env = {"GITHUB_SHA": SHA, "IMAGE_URI": IMAGE, "LANGSMITH_API_KEY": SECRET}



class ImageTests(BaseTests):
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



class ReceiptTests(BaseTests):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.docker = self.root / "real-docker"
        self.docker.write_text("#!/usr/bin/env python3\nimport os,sys,time,signal\n" +
            "open(os.environ['ARGS'], 'w').write(repr(sys.argv[1:]))\n" +
            "exec(os.environ['PROGRAM'])\n")
        self.docker.chmod(0o700)
        self.env.update(GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1",
            RUNNER_TEMP=str(self.root), GITHUB_ENV=str(self.root / "env"),
            GITHUB_PATH=str(self.root / "path"), GITHUB_OUTPUT=str(self.root / "output"),
            PATH=os.environ["PATH"], ARGS=str(self.root / "args"), PROGRAM="")
        self.envpatch = patch.dict(os.environ, self.env, clear=True)
        self.envpatch.start()
        self.addCleanup(self.envpatch.stop)
        self.checkout = patch.object(self.module.subprocess, "run", return_value=
            subprocess.CompletedProcess([], 0, SHA + "\n", ""))
        self.checkout.start()
        self.addCleanup(self.checkout.stop)
        self.which = patch.object(self.module.shutil, "which", return_value=str(self.docker))
        self.which.start()
        self.addCleanup(self.which.stop)

    def runmode(self, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = self.module.main(args)
        self.assertNotIn(SECRET, out.getvalue() + err.getvalue())
        return result, out.getvalue(), err.getvalue()

    def prepare(self):
        result, out, err = self.runmode(["prepare"])
        self.assertEqual((result, out, err), (0, "", ""))
        for line in (self.root / "env").read_text().splitlines():
            key, value = line.split("=", 1)
            os.environ[key] = value
        self.state = Path(os.environ["SHARED_PUSH_STATE"])
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)

    def push(self, output=None, exit_code=0, program=None, args=None):
        receipt = SHA + ": digest: sha256:" + "a" * 64 + " size: 42\n"
        os.environ["PROGRAM"] = program if program is not None else (
            "sys.stdout.buffer.write(" + repr((receipt if output is None else output).encode()) +
            ");sys.stdout.flush();sys.exit(" + str(exit_code) + ")")
        return self.runmode(["shim", *(args or ["--config", SECRET, "push", REPOSITORY + ":" + SHA])])

    def test_prepare_push_receipt_and_evidence(self):
        self.prepare()
        self.assertEqual(self.push()[0], 0)
        self.assertEqual((self.root / "args").read_text(), repr(["--config", SECRET, "push", REPOSITORY + ":" + SHA]))
        self.assertEqual(self.runmode(["evidence"]), (0, f"source_sha={SHA}\nimage_uri={IMAGE}\n", ""))
        self.assertEqual((self.root / "output").read_text(), f"source_sha={SHA}\nimage_uri={IMAGE}\n")
        for p in self.state.iterdir():
            if p.is_file():
                self.assertNotIn(SECRET, p.read_text())

    def test_fallback_notes_unicode_ansi_and_crlf_are_discarded(self):
        self.prepare()
        receipt = SHA + ": digest: sha256:" + "a" * 64 + " size: 42\r\n"
        notes = "progress ☃ \x1b[31msha256:" + "b" * 64 + "\x1b[0m\n" + SECRET + "\n"
        self.assertEqual(self.push(notes + receipt + notes)[0], 0)
        self.assertEqual(self.runmode(["evidence"])[0], 0)

    def test_malformed_and_untrusted_receipts_fail(self):
        good = SHA + ": digest: sha256:" + "a" * 64 + " size: 42\n"
        cases = ["", REPOSITORY + ":" + SHA + "\n", "sha256:" + "a" * 64 + "\n",
            good * 2, good + good.replace("a" * 64, "b" * 64), good.rstrip("\n"),
            good.replace(SHA, "2" * 40), good.replace("a" * 64, "A" * 64),
            good.replace("42", "0"), good.replace("42", str(2**63)),
            good.replace("sha256", "sha512"), good.replace(": digest:", ": digest:BAD"),
            "\x1b[31m" + good, good + "foreign: digest: sha256:" + "a" * 64 + " size: 42\n"]
        for output in cases:
            with self.subTest(output=output):
                self.prepare()
                self.assertEqual(self.push(output)[0], 1)
                self.assertEqual(self.runmode(["evidence"])[0], 1)
                os.environ.pop("SHARED_PUSH_STATE", None)

    def test_nonzero_signal_and_130_are_failures(self):
        for code in [1, 130, -signal.SIGTERM]:
            self.prepare()
            program = None if code >= 0 else "os.kill(os.getpid(), signal.SIGTERM)"
            self.assertEqual(self.push(exit_code=code, program=program)[0], 1)
            self.assertEqual(self.runmode(["evidence"])[0], 1)
            os.environ.pop("SHARED_PUSH_STATE", None)

    def test_failed_retry_success_and_terminal_duplicate(self):
        self.prepare()
        self.assertEqual(self.push(exit_code=1)[0], 1)
        self.assertEqual(self.push()[0], 0)
        (self.root / "args").unlink()
        for _ in range(3):
            self.assertEqual(self.push()[0], 1)
            self.assertFalse((self.root / "args").exists())
            self.assertEqual(self.runmode(["evidence"])[0], 1)

    def test_foreign_push_after_success_is_also_terminal(self):
        self.prepare()
        self.assertEqual(self.push()[0], 0)
        (self.root / "args").unlink()
        self.assertEqual(self.push(args=["--config", SECRET, "push", "foreign"])[0], 1)
        self.assertFalse((self.root / "args").exists())
        self.assertEqual(self.runmode(["evidence"])[0], 1)
        self.assertEqual(self.push()[0], 1)
        self.assertFalse((self.root / "args").exists())

    def test_only_three_attempts(self):
        self.prepare()
        for _ in range(3):
            self.assertEqual(self.push(exit_code=1)[0], 1)
        (self.root / "args").unlink()
        self.assertEqual(self.push()[0], 1)
        self.assertFalse((self.root / "args").exists())

    def test_nonpush_argv_and_login_stdin_are_passthrough(self):
        self.prepare()
        for args in [["--config", SECRET, "login", "--password-stdin"], ["build", "--label", "push"], ["version"], ["info"], ["tag", "push", "other"], ["buildx", "build", "."]]:
            with patch.object(self.module.os, "execv") as execute:
                self.assertEqual(self.runmode(["shim", *args])[0], 0)
                execute.assert_called_once_with(str(self.docker), [str(self.docker), *args])
        self.assertFalse((self.root / "args").exists())

    def test_pinned_pull_and_buildx_cleanup_passthrough_unchanged(self):
        self.prepare()
        for args in [["pull", "langchain/langgraph-api:3.12"], ["--config", SECRET, "pull", "langchain/langgraph-api:3.12"], ["buildx", "rm", "temporary-builder"], ["build", "-f", "-", "-t", "langgraph-deploy-tmp:123", "--build-context", "extra=/public/context", "."], ["buildx", "build", "-f", "-", "-t", "langgraph-deploy-tmp:123", "--platform", "linux/amd64", "--load", "--progress=quiet", "--label", "push", "."]]:
            with patch.object(self.module.os, "execv") as execute:
                self.assertEqual(self.runmode(["shim", *args])[0], 0)
                execute.assert_called_once_with(str(self.docker), [str(self.docker), *args])

    def test_explicit_untracked_publishing_forms_never_execute(self):
        for successful in [False, True]:
            for args in [["build", "--push", "."], ["buildx", "build", "--push", "."], ["buildx", "imagetools", "create", "--tag", "foreign", "image"], ["buildx", "build", "--output=type=registry", "."], ["build", "--output", "type=image,push=true", "."], ["buildx", "build", "-otype=registry", "."], ["buildx", "build", "--cache-to=type=registry,ref=foreign", "."]]:
                self.prepare()
                if successful: self.assertEqual(self.push()[0], 0)
                with patch.object(self.module.os, "execv") as execute:
                    self.assertEqual(self.runmode(["shim", *args])[0], 1)
                    execute.assert_not_called()
                self.assertEqual(self.runmode(["evidence"])[0], 1)
                os.environ.pop("SHARED_PUSH_STATE", None)

    def test_unsupported_push_shapes_never_launch(self):
        self.prepare()
        for args in [["push", REPOSITORY + ":" + SHA], ["image", "push", REPOSITORY + ":" + SHA], ["--config", SECRET, "push", "foreign"], ["--config", SECRET, "push", REPOSITORY + ":" + SHA, "--quiet"], ["--config", SECRET, "--debug", "push", REPOSITORY + ":" + SHA]]:
            self.assertEqual(self.push(args=args)[0], 1)
            self.assertFalse((self.root / "args").exists())

    def test_timeout_eof_hang_overflow_and_cancellation_reap(self):
        for program in ["time.sleep(10)", "os.close(1);time.sleep(10)", "sys.stdout.write('x'*70000);sys.stdout.flush();time.sleep(10)", "sys.stdout.write(('x'*100+'\\n')*25000);sys.stdout.flush();time.sleep(10)"]:
            self.prepare()
            start = time.monotonic()
            with patch.object(self.module, "PUSH_TIMEOUT", 0.15):
                self.assertEqual(self.push(program=program)[0], 1)
            self.assertLess(time.monotonic() - start, 3)
            self.assertEqual(self.runmode(["evidence"])[0], 1)
            os.environ.pop("SHARED_PUSH_STATE", None)

    def test_stream_and_line_bounds_report_overflow_and_reap(self):
        for program in ["sys.stdout.write('x'*70000);sys.stdout.flush();time.sleep(10)", "sys.stdout.write('progress\\n'*10000);sys.stdout.flush();time.sleep(10)"]:
            self.prepare()
            real_popen = self.module.subprocess.Popen
            children = []
            def start(*args, **kwargs):
                child = real_popen(*args, **kwargs); children.append(child); return child
            with patch.object(self.module, "PUSH_LIMIT", 65536), patch.object(self.module.subprocess, "Popen", side_effect=start):
                result, _, err = self.push(program=program)
            self.assertEqual(result, 1)
            self.assertIn("push_overflow", err)
            self.assertIsNotNone(children[0].poll())
            with self.assertRaises(ProcessLookupError): os.killpg(children[0].pid, 0)
            os.environ.pop("SHARED_PUSH_STATE", None)

    def test_timeout_reaps_the_process_after_eof(self):
        self.prepare()
        real_popen = self.module.subprocess.Popen
        children = []
        def start(*args, **kwargs):
            child = real_popen(*args, **kwargs); children.append(child); return child
        with patch.object(self.module, "PUSH_TIMEOUT", 0.15), patch.object(self.module.subprocess, "Popen", side_effect=start):
            result, _, err = self.push(program="os.close(1);time.sleep(10)")
        self.assertEqual(result, 1)
        self.assertIn("push_timeout", err)
        self.assertIsNotNone(children[0].poll())
        with self.assertRaises(ProcessLookupError): os.killpg(children[0].pid, 0)

    def test_contention_does_not_start_or_poison_holder(self):
        self.prepare()
        import fcntl
        with (self.state / "lock").open("r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.push()[0], 1)
            self.assertFalse((self.root / "args").exists())
        self.assertEqual(self.push()[0], 0)

    def test_owned_receipt_file_attacks_and_strict_json_fail(self):
        for attack in ["symlink", "fifo", "hardlink", "mode", "oversize", "duplicate", "extra", "bool", "partial"]:
            self.prepare()
            self.assertEqual(self.push()[0], 0)
            receipt = self.state / "receipt.json"
            original = receipt.read_text()
            if attack in ["symlink", "fifo", "hardlink"]:
                receipt.unlink()
                if attack == "symlink": receipt.symlink_to(self.root / "never-open")
                if attack == "fifo": os.mkfifo(receipt, 0o600)
                if attack == "hardlink":
                    target = self.root / "hardlink"
                    target.write_text(original)
                    os.link(target, receipt)
            elif attack == "mode": receipt.chmod(0o666)
            elif attack == "oversize": receipt.write_text("x" * 20000)
            elif attack == "duplicate": receipt.write_text(original[:-1] + ',"source_sha":"' + SHA + '"}')
            elif attack == "extra": receipt.write_text(original[:-1] + ',"extra":1}')
            elif attack == "bool": receipt.write_text(original.replace('"push_size":42', '"push_size":true'))
            elif attack == "partial": receipt.write_text('{')
            self.assertEqual(self.runmode(["evidence"])[0], 1)
            self.assertFalse((self.root / "output").exists())
            os.environ.pop("SHARED_PUSH_STATE", None)

    def test_stale_state_run_sha_and_directory_rejected(self):
        self.prepare()
        self.assertEqual(self.push()[0], 0)
        for key, value in [("GITHUB_RUN_ID", "124"), ("GITHUB_RUN_ATTEMPT", "2"), ("GITHUB_SHA", "2" * 40), ("SHARED_PUSH_STATE", str(self.root))]:
            with patch.dict(os.environ, {key: value}):
                self.assertEqual(self.runmode(["evidence"])[0], 1)
        self.state.chmod(0o777)
        self.assertEqual(self.runmode(["evidence"])[0], 1)

    def test_prepare_rejects_canonical_temp_controls_before_writing(self):
        for index, control in enumerate(["\n", "\r", "\x01", "\x7f"]):
            target = self.root / ("unsafe" + control + str(index))
            target.mkdir()
            link = self.root / ("safe-temp-" + str(index))
            link.symlink_to(target, target_is_directory=True)
            with patch.dict(os.environ, {"RUNNER_TEMP": str(link)}):
                result, out, _ = self.runmode(["prepare"])
            self.assertEqual((result, out), (1, ""))
            self.assertEqual(list(target.iterdir()), [])
            self.assertFalse((self.root / "env").exists())
            self.assertFalse((self.root / "path").exists())

    def test_prepare_rejects_injection_and_checkout_mismatch(self):
        for key, value in [("SHARED_PUSH_STATE", str(self.root)), ("GITHUB_RUN_ID", "bad\n"), ("RUNNER_TEMP", str(self.root) + "\n")]:
            with patch.dict(os.environ, {key: value}):
                self.assertEqual(self.runmode(["prepare"])[0], 1)
        self.checkout.stop()
        with patch.object(self.module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "2" * 40, SECRET)):
            self.assertEqual(self.runmode(["prepare"])[0], 1)

    def test_state_lock_and_manifest_fifo_symlink_mode_and_owner_attacks(self):
        for name in ["state.json", "manifest.json", "lock"]:
            for kind in ["fifo", "symlink", "mode", "owner"]:
                self.prepare()
                self.assertEqual(self.push()[0], 0)
                target = self.state / name
                if kind in ["fifo", "symlink"]:
                    target.unlink()
                    if kind == "fifo": os.mkfifo(target, 0o600)
                    else: target.symlink_to(self.root / "no-open")
                    self.assertEqual(self.runmode(["evidence"])[0], 1)
                elif kind == "mode":
                    target.chmod(0o666)
                    self.assertEqual(self.runmode(["evidence"])[0], 1)
                else:
                    original = self.module.os.fstat
                    def foreign_owner(fd):
                        info = original(fd)
                        if stat.S_ISREG(info.st_mode):
                            fields = list(info); fields[4] = os.geteuid() + 1
                            return os.stat_result(fields)
                        return info
                    with patch.object(self.module.os, "fstat", side_effect=foreign_owner):
                        self.assertEqual(self.runmode(["evidence"])[0], 1)
                os.environ.pop("SHARED_PUSH_STATE", None)

    def test_atomic_receipt_failure_never_permits_evidence(self):
        self.prepare()
        original = self.module.os.replace
        def fail_receipt(src, dst, **kwargs):
            if dst == "receipt.json": raise OSError(SECRET)
            return original(src, dst, **kwargs)
        with patch.object(self.module.os, "replace", side_effect=fail_receipt):
            self.assertEqual(self.push()[0], 1)
        self.assertEqual(self.runmode(["evidence"])[0], 1)
        self.assertFalse((self.state / "receipt.json").exists())
        self.assertFalse(any(p.name.startswith(".write-") for p in self.state.iterdir()))
        self.assertEqual(self.push()[0], 0)

    def test_pending_state_and_missing_receipt_never_fallback(self):
        self.prepare()
        self.assertEqual(self.runmode(["evidence"])[0], 1)
        self.assertEqual(self.push()[0], 0)
        (self.state / "receipt.json").unlink()
        self.assertEqual(self.runmode(["evidence"])[0], 1)
        (self.state / "state.json").write_text('{"status":"attempt","attempts":1}')
        self.assertEqual(self.runmode(["evidence"])[0], 1)

    def test_launch_errors_and_stdout_stderr_sentinels_are_private(self):
        self.prepare()
        with patch.object(self.module.subprocess, "Popen", side_effect=OSError(SECRET)):
            self.assertEqual(self.push()[0], 1)
        good = SHA + ": digest: sha256:" + "a" * 64 + " size: 42\n"
        program = "sys.stderr.write(" + repr(SECRET) + ");sys.stdout.write(" + repr(SECRET + "\n" + good) + ")"
        self.assertEqual(self.push(program=program)[0], 0)
        for path in self.state.iterdir():
            self.assertNotIn(SECRET, path.read_text())

    def test_cancellation_kills_and_reaps_separate_group(self):
        self.prepare()
        real_popen = self.module.subprocess.Popen
        children = []
        def start(*args, **kwargs):
            child = real_popen(*args, **kwargs); children.append(child); return child
        selector = self.module.selectors.DefaultSelector
        class CancelSelector:
            def __init__(self): self.inner = selector()
            def register(self, *args): return self.inner.register(*args)
            def get_map(self): return self.inner.get_map()
            def select(self, timeout):
                signal.raise_signal(signal.SIGTERM)
            def close(self): self.inner.close()
        with patch.object(self.module.subprocess, "Popen", side_effect=start), patch.object(self.module.selectors, "DefaultSelector", CancelSelector):
            self.assertEqual(self.push(program="time.sleep(10)")[0], 1)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())
        with self.assertRaises(ProcessLookupError): os.killpg(children[0].pid, 0)
        self.assertEqual(self.runmode(["evidence"])[0], 1)

    def test_passthrough_actual_stdin_stdout_stderr_and_environment(self):
        self.prepare()
        shim = self.state / "docker"
        env = dict(os.environ, PROGRAM="sys.stdout.write(sys.stdin.read());sys.stderr.write(os.environ['PUBLIC_VALUE'])", PUBLIC_VALUE="public-marker")
        self.checkout.stop()
        result = subprocess.run([str(shim), "--config", SECRET, "login", "--password-stdin"], input=SECRET, text=True, capture_output=True, env=env, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, SECRET, "public-marker"))
        self.assertEqual((self.root / "args").read_text(), repr(["--config", SECRET, "login", "--password-stdin"]))
        self.assertFalse((self.state / "receipt.json").exists())

    def test_main_invalid_modes_sha_and_fixed_diagnostics(self):
        for mode in [[], [SECRET], ["pin", SECRET]]:
            result, out, err = self.runmode(mode)
            self.assertEqual((result, out), (1, "")); self.assertIn("mode_invalid", err)
        with patch.dict(os.environ, {"GITHUB_SHA": SHA + "\n"}):
            self.assertEqual(self.runmode(["evidence"])[0], 1)
        for exception in [RuntimeError(SECRET), self.module.EvidenceError(SECRET)]:
            with patch.object(self.module, "receipt_image", side_effect=exception):
                self.assertEqual(self.runmode(["evidence"]), (1, "", "Shared deployment image validation failed.\n"))

    def test_output_failure_precedes_stdout_and_never_leaks(self):
        self.prepare()
        self.assertEqual(self.push()[0], 0)
        with patch("builtins.open", side_effect=OSError(SECRET)):
            result, out, err = self.runmode(["evidence"])
        self.assertEqual((result, out), (1, ""))
        self.assertIn("output_write_failed", err)


class ReadinessTests(BaseTests):
    def ready(self, **changes):
        return deployment(IMAGE, status="READY", active_revision_id=REVISION, **changes)

    def revision(self, **changes):
        return dict(id=REVISION, status="DEPLOYED", source="internal_docker", source_revision_config={"image_uri": IMAGE}) | changes

    def verify(self, values, budget=60):
        calls = []
        ticks = [0.0]
        def clock(): return ticks[0]
        def sleep(seconds): ticks[0] += seconds
        def request(req, timeout):
            calls.append((req.method, req.full_url, timeout))
            value = values.pop(0)
            if isinstance(value, Exception): raise value
            if callable(value): value = value(ticks)
            return value if isinstance(value, Response) else Response(value)
        with patch.object(self.module.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = request
            try:
                result = self.module.verify_image(IMAGE, SECRET, budget=budget, clock=clock, sleep=sleep)
                return result, calls
            except self.module.EvidenceError:
                return None, calls

    def test_stable_same_image_current_revision_passes_get_only(self):
        result, calls = self.verify([self.ready(), self.revision(), self.ready()])
        self.assertEqual(result, REVISION)
        self.assertEqual([x[0] for x in calls], ["GET"] * 3)
        self.assertEqual([x[1] for x in calls], [self.module.URL, self.module.URL + "/revisions/" + REVISION, self.module.URL])

    def test_pending_revision_and_active_then_ready(self):
        pending = self.ready() | {"active_revision_id": None}
        result, calls = self.verify([pending, self.revision(status="DEPLOYING"), self.ready(), self.revision(), pending, self.ready(), self.revision(), self.ready()])
        self.assertEqual(result, REVISION)
        self.assertEqual(len(calls), 8)

    def test_all_closed_statuses_and_foreign_images(self):
        for value in [self.ready() | {"status": s} for s in ["UNUSED", "AWAITING_DELETE", "AWAITING_FINAL_DELETE", "UNKNOWN", SECRET]] + [self.ready() | {"source": "github"}, self.ready() | {"source_revision_config": {"image_uri": None}}, self.ready() | {"source_revision_config": {}}]:
            self.assertIsNone(self.verify([value])[0])
        for status in ["CREATE_FAILED", "BUILD_FAILED", "DEPLOY_FAILED", "SKIPPED", "INTERRUPTED", "UNKNOWN", SECRET]:
            self.assertIsNone(self.verify([self.ready(), self.revision(status=status)])[0])
        for change in [{"id": "other"}, {"source": "github"}, {"source_revision_config": {}}, {"source_revision_config": {"image_uri": None}}, {"source_revision_config": {"image_uri": REPOSITORY + ":" + SHA}}]:
            self.assertIsNone(self.verify([self.ready(), self.revision(**change)])[0])

    def test_missing_ids_are_not_null_and_schema_is_closed(self):
        for name in ["active_revision_id", "latest_revision_id", "status", "source", "id", "source_revision_config"]:
            value = self.ready(); value.pop(name)
            self.assertIsNone(self.verify([value])[0])
        for name in ["active_revision_id", "latest_revision_id"]:
            self.assertIsNone(self.verify([self.ready() | {name: SECRET}])[0])

    def test_supersession_within_and_between_cycles_fails(self):
        other = "ad846882-b58d-4d97-b47a-c5e0517eaaed"
        new = self.ready() | {"latest_revision_id": other, "active_revision_id": other}
        self.assertIsNone(self.verify([self.ready(), self.revision(), new])[0])
        self.assertIsNone(self.verify([self.ready(), self.revision(status="DEPLOYING"), new])[0])

    def test_http_error_order_permanent_vs_transient_and_deadline(self):
        for code in [301, 302, 307, 308, 400, 401, 403, 404, 422]:
            error = urllib.error.HTTPError("hidden", code, SECRET, {}, None)
            result, calls = self.verify([error])
            self.assertIsNone(result); self.assertEqual(len(calls), 1)
        for error in [urllib.error.URLError(SECRET), urllib.error.HTTPError("hidden", 503, SECRET, {}, None)]:
            result, calls = self.verify([error, self.ready(), self.revision(), self.ready()])
            self.assertEqual(result, REVISION); self.assertEqual(len(calls), 4)
        self.assertIsNone(self.verify([urllib.error.URLError(SECRET)] * 10, budget=20)[0])

    def test_every_documented_pending_revision_status_can_poll(self):
        for status in ["CREATING", "QUEUED", "AWAITING_BUILD", "BUILDING", "AWAITING_DEPLOY", "DEPLOYING"]:
            result, _ = self.verify([self.ready(), self.revision(status=status), self.ready(), self.revision(), self.ready()])
            self.assertEqual(result, REVISION)

    def test_null_latest_database_transition_and_no_success_until_stable_d2(self):
        pending = self.ready() | {"status": "AWAITING_DATABASE", "latest_revision_id": None, "active_revision_id": None}
        self.assertEqual(self.verify([pending, self.ready(), self.revision(), self.ready()])[0], REVISION)
        second = self.ready() | {"status": "AWAITING_DATABASE"}
        self.assertEqual(self.verify([self.ready(), self.revision(), second, self.ready(), self.revision(), self.ready()])[0], REVISION)
        self.assertIsNone(self.verify([self.ready(), self.revision(), self.ready() | {"source_revision_config": {"image_uri": "foreign"}}])[0])

    def test_main_verify_has_only_safe_success_or_failure_projection(self):
        for value in [REVISION, self.module.EvidenceError("verify_timeout"), RuntimeError(SECRET)]:
            out, err = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, self.env, clear=True), patch.object(self.module, "verify_image") as verify, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                if isinstance(value, Exception): verify.side_effect = value
                else: verify.return_value = value
                result = self.module.main(["verify"])
            self.assertNotIn(SECRET, out.getvalue() + err.getvalue())
            self.assertEqual(result, int(isinstance(value, Exception)))
            self.assertEqual(out.getvalue(), "" if isinstance(value, Exception) else "observed_active_revision_id=" + REVISION + "\n")

    def test_late_success_oversize_duplicate_and_invalid_json_fail(self):
        def late(ticks):
            ticks[0] = 61
            return self.ready()
        self.assertIsNone(self.verify([self.ready(), self.revision(), late])[0])
        for response in [Response(b"x" * (2 * 1024 * 1024 + 1)), Response(b'{"id":1,"id":2}'), Response(SECRET.encode()), Response(self.ready(), 302)]:
            self.assertIsNone(self.verify([response])[0])


if __name__ == "__main__":
    unittest.main()
