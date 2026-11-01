"""Record exact pushed-image evidence and pin the existing shared deployment.

PATCH acceptance is desired configuration only. Provider activation is checked
separately; GET-before-PATCH is not an atomic compare-and-swap.
"""

import contextlib
import fcntl
import json
import os
import re
import secrets
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

REPOSITORY = "us-east4-docker.pkg.dev/langchain-prod/cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f/shared-dev"
DEPLOYMENT_ID = "6d350054-14ea-4031-8463-010ec27f9059"
URL = "https://api.host.langchain.com/v2/deployments/" + DEPLOYMENT_ID
LIMIT = 2 * 1024 * 1024
TIMEOUT = 25
DIAGNOSTIC_CODES = frozenset({
    "mode_invalid", "sha_invalid", "checkout_command_failed", "checkout_timeout",
    "checkout_mismatch", "output_write_failed",
})


class EvidenceError(Exception):
    """Safe fixed-message failure; never include subprocess or provider data."""

    def __init__(self, code=None):
        self.code = code if type(code) is str and code in DIAGNOSTIC_CODES else None
        super().__init__()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition, code=None):
    if not condition:
        raise EvidenceError(code)


def valid_image(image):
    return isinstance(image, str) and re.fullmatch(
        re.escape(REPOSITORY) + r"@sha256:[0-9a-f]{64}", image
    ) is not None


# Private runner state is an accidental/stale-state boundary, not a defense
# against malicious code executing as the same runner UID.
STATE_ENV = "SHARED_PUSH_STATE"
STATE_LIMIT = 8192
PUSH_TIMEOUT = 900
LINE_LIMIT = 65536
PUSH_LIMIT = 8 * 1024 * 1024
MAX_SIZE = 2**63 - 1
UUID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
MANIFEST_KEYS = {"schema_version", "run_id", "run_attempt", "source_sha", "expected_tag", "docker", "helper", "python"}
RECEIPT_KEYS = {"schema_version", "run_id", "run_attempt", "source_sha", "expected_tag", "image_uri", "push_size"}
DIAGNOSTIC_CODES = DIAGNOSTIC_CODES | frozenset({
    "prepare_invalid", "state_invalid", "state_busy", "push_shape_invalid",
    "push_failed", "push_timeout", "push_overflow", "push_receipt_invalid",
    "push_duplicate", "push_attempts_exhausted", "push_cancelled",
    "verify_input_invalid", "verify_schema_invalid", "verify_identity_invalid",
    "verify_status_invalid", "verify_superseded", "verify_http_failed",
    "verify_timeout", "verify_body_invalid",
})


# Literal role maps keep diagnostics bounded. No inspected value contributes
# to a diagnostic; Python is the interpreter already running this helper.
EXECUTABLE_DIAGNOSTICS = {
    "docker": {
        "path": "prepare_docker_path_invalid", "stat": "prepare_docker_stat_failed",
        "type": "prepare_docker_type_invalid", "owner": "prepare_docker_owner_invalid",
        "group": "prepare_docker_group_writable", "world": "prepare_docker_world_writable",
        "access": "prepare_docker_not_executable",
    },
    "python": {
        "path": "prepare_python_path_invalid", "stat": "prepare_python_stat_failed",
        "type": "prepare_python_type_invalid", "owner": "prepare_python_owner_invalid",
        "group": "prepare_python_group_writable", "world": "prepare_python_world_writable",
        "access": "prepare_python_not_executable",
    },
}
DIAGNOSTIC_CODES = DIAGNOSTIC_CODES | frozenset({
    "prepare_state_present", "prepare_run_identity_invalid", "prepare_temp_missing",
    "prepare_temp_path_invalid", "prepare_temp_not_directory",
    "prepare_docker_missing", "prepare_docker_resolve_failed",
    "prepare_python_missing", "prepare_python_resolve_failed",
    "prepare_helper_path_invalid", "prepare_docker_recursive",
    "prepare_github_path_invalid", "prepare_github_env_invalid",
    "prepare_state_create_failed", "prepare_state_write_failed",
    "prepare_launcher_write_failed", "prepare_github_path_write_failed",
    "prepare_github_env_write_failed",
}) | frozenset(code for role in EXECUTABLE_DIAGNOSTICS.values() for code in role.values())


@contextlib.contextmanager
def prepare_stage(code):
    try:
        yield
    except Exception:
        raise EvidenceError(code) from None


def safe_path(value, code="state_invalid"):
    require(type(value) is str and value.startswith("/") and
            all(ord(c) >= 32 and ord(c) != 127 for c in value), code)
    require(os.path.normpath(value) == value, code)
    return value


def checked_sha(sha):
    try:
        checkout = subprocess.run(["git", "rev-parse", "HEAD"], check=True,
                                  capture_output=True, text=True, timeout=TIMEOUT).stdout.strip()
    except subprocess.TimeoutExpired:
        raise EvidenceError("checkout_timeout") from None
    except Exception:
        raise EvidenceError("checkout_command_failed") from None
    require(checkout == sha, "checkout_mismatch")


def run_identity():
    values = [os.environ.get(k, "") for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")]
    require(all(re.fullmatch(r"[1-9][0-9]{0,19}", v) for v in values), "state_invalid")
    return values


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "state_invalid")
        result[key] = value
    return result


def decode_json(body):
    return json.loads(body, object_pairs_hook=unique_object)


def regular(fd, mode=0o600):
    info = os.fstat(fd)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and
            info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == mode and
            info.st_size <= STATE_LIMIT, "state_invalid")
    return info


def owned_open(directory, name):
    # NONBLOCK must precede fstat: opening an injected FIFO must never wait.
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                 dir_fd=directory)
    try:
        regular(fd)
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_owned(directory, name):
    fd = owned_open(directory, name)
    try:
        body = os.read(fd, STATE_LIMIT + 1)
        require(len(body) <= STATE_LIMIT, "state_invalid")
        value = decode_json(body)
        require(type(value) is dict, "state_invalid")
        return value
    finally:
        os.close(fd)


def atomic_json(directory, name, value):
    temporary = ".write-" + secrets.token_hex(12)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
                 os.O_CLOEXEC, 0o600, dir_fd=directory)
    try:
        body = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("ascii")
        require(len(body) <= STATE_LIMIT, "state_invalid")
        with os.fdopen(fd, "wb") as target:
            fd = None
            target.write(body)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass


def executable(path, role="docker"):
    codes = EXECUTABLE_DIAGNOSTICS[role]
    safe_path(path, codes["path"])
    with prepare_stage(codes["stat"]):
        info = os.lstat(path)
    require(stat.S_ISREG(info.st_mode), codes["type"])
    require(info.st_uid in (0, os.geteuid()), codes["owner"])
    require(not (info.st_mode & 0o020), codes["group"])
    require(not (info.st_mode & 0o002), codes["world"])
    with prepare_stage(codes["access"]):
        accessible = os.access(path, os.X_OK)
    require(accessible, codes["access"])
    return path


def prepare(sha):
    require(STATE_ENV not in os.environ, "prepare_state_present")
    checked_sha(sha)
    with prepare_stage("prepare_run_identity_invalid"):
        run_id, run_attempt = run_identity()
    require(bool(os.environ.get("RUNNER_TEMP", "")), "prepare_temp_missing")
    with prepare_stage("prepare_temp_path_invalid"):
        temporary = safe_path(os.path.realpath(safe_path(os.environ.get("RUNNER_TEMP", ""))))
    with prepare_stage("prepare_temp_not_directory"):
        require(os.path.isdir(temporary))
    with prepare_stage("prepare_docker_resolve_failed"):
        docker_path = shutil.which("docker")
    require(bool(docker_path), "prepare_docker_missing")
    with prepare_stage("prepare_docker_resolve_failed"):
        docker_path = os.path.realpath(docker_path)
    docker = executable(docker_path, "docker")
    require(bool(sys.executable), "prepare_python_missing")
    with prepare_stage("prepare_python_resolve_failed"):
        python_path = os.path.realpath(sys.executable)
    python = executable(python_path, "python")
    with prepare_stage("prepare_helper_path_invalid"):
        helper = os.path.realpath(__file__)
        safe_path(helper)
    require(docker != helper and os.path.basename(os.path.dirname(docker))[:12] != "shared-push-", "prepare_docker_recursive")
    # Validate command file paths before creating any state or appending output.
    outputs = [safe_path(os.environ.get(k, ""), code) for k, code in (
        ("GITHUB_PATH", "prepare_github_path_invalid"), ("GITHUB_ENV", "prepare_github_env_invalid"))]
    with prepare_stage("prepare_state_create_failed"):
        root = safe_path(tempfile.mkdtemp(prefix="shared-push-", dir=temporary))
        os.chmod(root, 0o700)
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        with prepare_stage("prepare_state_write_failed"):
            atomic_json(directory, "manifest.json", dict(schema_version=1, run_id=run_id,
                run_attempt=run_attempt, source_sha=sha, expected_tag=REPOSITORY + ":" + sha,
                docker=docker, helper=helper, python=python))
            atomic_json(directory, "state.json", {"status": "prepared", "attempts": 0})
            lock = os.open("lock", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                           0o600, dir_fd=directory)
            os.close(lock)
        with prepare_stage("prepare_launcher_write_failed"):
            launcher = "#!" + python + "\nimport os\nos.execv(" + repr(python) + ", [" + repr(python) + ", " + repr(helper) + ", 'shim', *__import__('sys').argv[1:]])\n"
            fd = os.open("docker", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o700, dir_fd=directory)
            with os.fdopen(fd, "w", encoding="ascii") as target:
                target.write(launcher)
        with prepare_stage("prepare_github_path_write_failed"):
            with open(outputs[0], "a", encoding="utf8") as target:
                target.write(root + "\n")
        with prepare_stage("prepare_github_env_write_failed"):
            with open(outputs[1], "a", encoding="utf8") as target:
                target.write(STATE_ENV + "=" + root + "\n")
    finally:
        os.close(directory)


@contextlib.contextmanager
def prepared_state(sha):
    root = safe_path(os.environ.get(STATE_ENV, ""))
    parent = safe_path(os.path.realpath(safe_path(os.environ.get("RUNNER_TEMP", ""))))
    require(os.path.dirname(root) == parent and os.path.basename(root).startswith("shared-push-"), "state_invalid")
    before = os.lstat(root)
    require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.geteuid() and
            stat.S_IMODE(before.st_mode) == 0o700, "state_invalid")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        after = os.fstat(directory)
        require((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), "state_invalid")
        manifest = read_owned(directory, "manifest.json")
        run_id, run_attempt = run_identity()
        require(set(manifest) == MANIFEST_KEYS and type(manifest["schema_version"]) is int and
                manifest["schema_version"] == 1 and manifest["run_id"] == run_id and
                manifest["run_attempt"] == run_attempt and manifest["source_sha"] == sha and
                manifest["expected_tag"] == REPOSITORY + ":" + sha and
                manifest["helper"] == os.path.realpath(__file__) and
                manifest["python"] == os.path.realpath(sys.executable), "state_invalid")
        executable(manifest["docker"])
        yield directory, manifest
    finally:
        os.close(directory)


@contextlib.contextmanager
def state_lock(directory):
    fd = os.open("lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                 dir_fd=directory)
    try:
        require(regular(fd).st_size == 0, "state_invalid")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise EvidenceError("state_busy") from None
        yield
    finally:
        os.close(fd)


def read_status(directory):
    state = read_owned(directory, "state.json")
    require(set(state) == {"status", "attempts"} and type(state["attempts"]) is int and
            0 <= state["attempts"] <= 3 and state["status"] in
            ("prepared", "attempt", "failed", "success", "terminal-duplicate"), "state_invalid")
    require((state["status"] == "prepared") == (state["attempts"] == 0), "state_invalid")
    return state


def erase_receipt(directory):
    try:
        os.unlink("receipt.json", dir_fd=directory)
    except FileNotFoundError:
        pass


def capture_push(docker, args, sha):
    child = None
    selector = selectors.DefaultSelector()
    handlers = {}
    def cancelled(*_):
        raise EvidenceError("push_cancelled")
    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            handlers[sig] = signal.signal(sig, cancelled)
        child = subprocess.Popen([docker, *args], stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + PUSH_TIMEOUT
        selector.register(child.stdout, selectors.EVENT_READ)
        pending = b""
        total = 0
        found = None
        pattern = re.compile(re.escape(sha.encode()) + rb": digest: sha256:([0-9a-f]{64}) size: ([1-9][0-9]{0,18})")
        while selector.get_map():
            remaining = deadline - time.monotonic()
            require(remaining > 0, "push_timeout")
            for key, _ in selector.select(remaining):
                data = os.read(key.fd, 16384)
                if not data:
                    selector.unregister(key.fileobj)
                    break
                total += len(data)
                require(total <= PUSH_LIMIT, "push_overflow")
                pending += data
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    require(len(line) <= LINE_LIMIT, "push_overflow")
                    if line.endswith(b"\r"):
                        line = line[:-1]
                    candidate = pattern.fullmatch(line)
                    if candidate:
                        require(found is None, "push_receipt_invalid")
                        size = int(candidate[2])
                        require(size <= MAX_SIZE, "push_receipt_invalid")
                        found = (REPOSITORY + "@sha256:" + candidate[1].decode("ascii"), size)
                    elif b": digest" in line.lower() or line.startswith(sha.encode() + b":"):
                        raise EvidenceError("push_receipt_invalid")
                require(len(pending) <= LINE_LIMIT, "push_overflow")
        require(not pending, "push_receipt_invalid")
        remaining = deadline - time.monotonic()
        require(remaining > 0, "push_timeout")
        try:
            code = child.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise EvidenceError("push_timeout") from None
        require(time.monotonic() < deadline, "push_timeout")
        require(code == 0, "push_failed")
        require(found is not None, "push_receipt_invalid")
        return found
    except BaseException:
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        raise
    finally:
        selector.close()
        if child is not None and child.stdout is not None:
            child.stdout.close()
        for sig, handler in handlers.items():
            signal.signal(sig, handler)


def shim(sha, args):
    with prepared_state(sha) as (directory, manifest):
        # Only command positions are inspected. A label, password or image name
        # literally equal to "push" in a known nonpush command is ordinary data.
        command = args[2] if len(args) >= 3 and args[0] == "--config" else (args[0] if args else "")
        command_index = 2 if len(args) >= 3 and args[0] == "--config" else 0
        tail = args[command_index + 1:]
        # CLI 0.4.21: pull BASE; build -f - -t LOCAL [--build-context K=V];
        # on non-amd64, buildx build adds --platform linux/amd64 --load
        # [--progress=quiet]. Its cleanup may run buildx rm. This workflow
        # supplies no docker_build_args or output/export flags. Keep ordinary
        # data such as a label value "push" opaque, but reject explicit publish
        # flags/exports and other buildx subcommands (e.g. imagetools create).
        building = command == "build" or (command == "buildx" and tail[:1] == ["build"])
        exporting = any(value in ("--push", "--output", "-o", "--cache-to") or
            value.startswith(("--push=", "--output=", "--cache-to=", "-o")) for value in tail)
        passthrough = command in {"version", "info", "tag", "login", "pull"} or (
            building and not exporting) or (command == "buildx" and tail[:1] == ["rm"])
        if passthrough:
            os.execv(manifest["docker"], [manifest["docker"], *args])
            return
        with state_lock(directory):
            state = read_status(directory)
            if state["status"] in ("success", "terminal-duplicate"):
                erase_receipt(directory)
                atomic_json(directory, "state.json", {**state, "status": "terminal-duplicate"})
                raise EvidenceError("push_duplicate")
            require(len(args) == 4 and args[0] == "--config" and bool(args[1]) and
                    command == "push" and args[3] == manifest["expected_tag"], "push_shape_invalid")
            require(state["status"] in ("prepared", "failed"), "state_invalid")
            require(state["attempts"] < 3, "push_attempts_exhausted")
            attempts = state["attempts"] + 1
            erase_receipt(directory)
            atomic_json(directory, "state.json", {"status": "attempt", "attempts": attempts})
            try:
                image, size = capture_push(manifest["docker"], args, sha)
                receipt = {k: manifest[k] for k in ("schema_version", "run_id", "run_attempt", "source_sha", "expected_tag")}
                receipt.update(image_uri=image, push_size=size)
                atomic_json(directory, "receipt.json", receipt)
                atomic_json(directory, "state.json", {"status": "success", "attempts": attempts})
            except BaseException:
                erase_receipt(directory)
                atomic_json(directory, "state.json", {"status": "failed", "attempts": attempts})
                raise


def receipt_image(sha):
    checked_sha(sha)
    with prepared_state(sha) as (directory, manifest), state_lock(directory):
        require(read_status(directory)["status"] == "success", "state_invalid")
        receipt = read_owned(directory, "receipt.json")
        require(set(receipt) == RECEIPT_KEYS and all(
            type(receipt[k]) is type(manifest[k]) and receipt[k] == manifest[k]
            for k in ("schema_version", "run_id", "run_attempt", "source_sha", "expected_tag")), "state_invalid")
        require(valid_image(receipt["image_uri"]) and type(receipt["push_size"]) is int and
                0 < receipt["push_size"] <= MAX_SIZE, "state_invalid")
        return receipt["image_uri"]


class TransientGet(Exception):
    pass


def verify_image(image, key, budget=900, clock=None, sleep=None):
    """Observe exact-image readiness. Separate GETs do not provide an atomic
    snapshot or independently attest the running container's measured digest.
    Socket operations may overrun the monotonic budget by their bounded timeout.
    """
    require(valid_image(image) and isinstance(key, str) and bool(key) and
            all(32 < ord(c) < 127 for c in key), "verify_input_invalid")
    clock = clock or time.monotonic
    sleep = sleep or time.sleep
    deadline = clock() + budget
    opener = urllib.request.build_opener(NoRedirect())
    anchor = None

    def remaining():
        value = deadline - clock()
        require(value > 0, "verify_timeout")
        return value

    def get(url):
        timeout = min(TIMEOUT, remaining())
        req = urllib.request.Request(url, method="GET", headers={"X-Api-Key": key, "Accept": "application/json"})
        try:
            with opener.open(req, timeout=timeout) as response:
                if response.status in (408, 429) or 500 <= response.status <= 599:
                    raise TransientGet()
                require(response.status == 200, "verify_http_failed")
                chunks = []
                total = 0
                # read1 avoids waiting to fill a large buffer on a trickling
                # HTTP stream; each socket operation still has its own timeout.
                read = getattr(response, "read1", response.read)
                while True:
                    remaining()
                    chunk = read(min(65536, LIMIT + 1 - total))
                    remaining()
                    total += len(chunk)
                    require(total <= LIMIT, "verify_body_invalid")
                    if not chunk:
                        break
                    chunks.append(chunk)
                try:
                    value = decode_json(b"".join(chunks))
                except Exception:
                    raise EvidenceError("verify_body_invalid") from None
                remaining()
                return value
        except urllib.error.HTTPError as error:
            if error.code in (408, 429) or 500 <= error.code <= 599:
                raise TransientGet() from None
            raise EvidenceError("verify_http_failed") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise TransientGet() from None

    def identity(value, expected_id):
        require(type(value) is dict and all(k in value for k in
            ("id", "source", "source_revision_config", "status")), "verify_schema_invalid")
        require(value["id"] == expected_id and value["source"] == "internal_docker", "verify_identity_invalid")
        config = value["source_revision_config"]
        require(type(config) is dict and config.get("image_uri") == image, "verify_identity_invalid")

    def deployment(value):
        nonlocal anchor
        identity(value, DEPLOYMENT_ID)
        for key_name in ("active_revision_id", "latest_revision_id"):
            require(key_name in value, "verify_schema_invalid")
            field = value[key_name]
            require(field is None or (type(field) is str and re.fullmatch(UUID, field)), "verify_schema_invalid")
        require(value["status"] in ("READY", "AWAITING_DATABASE"), "verify_status_invalid")
        latest = value["latest_revision_id"]
        if anchor is not None:
            require(latest == anchor, "verify_superseded")
        elif latest is not None:
            anchor = latest
        return value["status"] == "READY" and anchor is not None and value["active_revision_id"] == anchor and latest == anchor

    for _ in range(100):
        remaining()
        try:
            first_ready = deployment(get(URL))
            if anchor is not None:
                revision = get(URL + "/revisions/" + anchor)
                identity(revision, anchor)
                require(revision["status"] in ("CREATING", "QUEUED", "AWAITING_BUILD", "BUILDING", "AWAITING_DEPLOY", "DEPLOYING", "DEPLOYED"), "verify_status_invalid")
                if revision["status"] == "DEPLOYED":
                    second_ready = deployment(get(URL))
                    remaining()
                    if first_ready and second_ready:
                        return anchor
        except TransientGet:
            pass
        sleep(min(10, remaining()))
    raise EvidenceError("verify_timeout")


def desired(deployment, images):
    require(isinstance(deployment, dict))
    require(deployment.get("id") == DEPLOYMENT_ID)
    require(deployment.get("source") == "internal_docker")
    config = deployment.get("source_revision_config")
    require(isinstance(config, dict) and config.get("image_uri") in images)
    revision = deployment.get("latest_revision_id")
    require(isinstance(revision, str) and re.fullmatch(
        r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", revision
    ))
    return revision


def pin_image(sha, image, key):
    require(valid_image(image))
    require(isinstance(key, str) and bool(key) and all(32 < ord(c) < 127 for c in key))
    opener = urllib.request.build_opener(NoRedirect())

    def request(method, payload=None):
        req = urllib.request.Request(
            URL, method=method,
            headers={"X-Api-Key": key, "Accept": "application/json",
                     "Content-Type": "application/json"},
            data=json.dumps(payload).encode() if payload is not None else None,
        )
        with opener.open(req, timeout=TIMEOUT) as response:
            require(200 <= response.status < 300)
            body = response.read(LIMIT + 1)
            require(len(body) <= LIMIT)
        # No assumptions about the PATCH response schema. Read back the known
        # deployment schema after acceptance; an uncertain PATCH is never retried.
        return json.loads(body) if method == "GET" else None

    current = request("GET")
    revision = desired(current, [REPOSITORY + ":" + sha, image])
    if current["source_revision_config"]["image_uri"] != image:
        request("PATCH", {"revision_source": "internal_docker",
                          "source_revision_config": {"image_uri": image}})
        revision = desired(request("GET"), [image])
    return revision


def main(args=None):
    try:
        mode = (sys.argv[1:] if args is None else args)
        require(mode and (mode in (["prepare"], ["evidence"], ["pin"], ["verify"]) or mode[0] == "shim"), "mode_invalid")
        sha = os.environ.get("GITHUB_SHA", "")
        require(re.fullmatch(r"[0-9a-f]{40}", sha), "sha_invalid")
        if mode == ["prepare"]:
            prepare(sha)
        elif mode[0] == "shim":
            shim(sha, mode[1:])
        elif mode == ["evidence"]:
            image = receipt_image(sha)
            output = f"source_sha={sha}\nimage_uri={image}\n"
            if os.environ.get("GITHUB_OUTPUT"):
                try:
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as target:
                        target.write(output)
                except Exception:
                    raise EvidenceError("output_write_failed") from None
            print(output, end="")
        elif mode == ["verify"]:
            revision = verify_image(os.environ.get("IMAGE_URI", ""), os.environ.get("LANGSMITH_API_KEY", ""))
            print("observed_active_revision_id=" + revision)
        else:
            revision = pin_image(sha, os.environ.get("IMAGE_URI", ""),
                                 os.environ.get("LANGSMITH_API_KEY", ""))
            print("desired_revision_id=" + revision)
        return 0
    except Exception as failure:
        # Exceptions may contain credentials, image config, or provider bodies.
        code = failure.code if isinstance(failure, EvidenceError) else None
        suffix = " [" + code + "]" if type(code) is str and code in DIAGNOSTIC_CODES else ""
        print("Shared deployment image validation failed." + suffix, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
