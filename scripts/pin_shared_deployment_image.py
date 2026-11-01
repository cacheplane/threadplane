"""Record exact pushed-image evidence and pin the existing shared deployment.

PATCH acceptance is desired configuration only. Provider activation is checked
separately; GET-before-PATCH is not an atomic compare-and-swap.
"""

import json
import os
import re
import subprocess
import sys
import urllib.request

REPOSITORY = "us-east4-docker.pkg.dev/langchain-prod/cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f/shared-dev"
DEPLOYMENT_ID = "6d350054-14ea-4031-8463-010ec27f9059"
URL = "https://api.host.langchain.com/v2/deployments/" + DEPLOYMENT_ID
LIMIT = 2 * 1024 * 1024
TIMEOUT = 25
DIAGNOSTIC_CODES = frozenset({
    "mode_invalid", "sha_invalid", "checkout_command_failed", "checkout_timeout",
    "checkout_mismatch", "inspect_command_failed", "inspect_timeout",
    "inspect_output_oversized", "inspect_json_invalid", "digest_shape_invalid",
    "digest_count_zero", "digest_count_multiple", "digest_repository_or_format_invalid",
    "output_write_failed",
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


def inspect_image(sha):
    try:
        checkout = subprocess.run(
            ["git", "rev-parse", "HEAD"], check=True, capture_output=True,
            text=True, timeout=TIMEOUT,
        ).stdout.strip()
    except subprocess.TimeoutExpired:
        raise EvidenceError("checkout_timeout") from None
    except Exception:
        raise EvidenceError("checkout_command_failed") from None
    require(checkout == sha, "checkout_mismatch")
    # Inspect only RepoDigests, never the image config (which may contain env).
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", REPOSITORY + ":" + sha,
             "--format", "{{json .RepoDigests}}"],
            check=True, capture_output=True, text=True, timeout=TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise EvidenceError("inspect_timeout") from None
    except Exception:
        raise EvidenceError("inspect_command_failed") from None
    require(len(result.stdout) <= LIMIT, "inspect_output_oversized")
    try:
        images = json.loads(result.stdout)
    except Exception:
        raise EvidenceError("inspect_json_invalid") from None
    require(isinstance(images, list), "digest_shape_invalid")
    require(len(images) != 0, "digest_count_zero")
    require(len(images) == 1, "digest_count_multiple")
    require(valid_image(images[0]), "digest_repository_or_format_invalid")
    return images[0]


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
        require(mode in (["evidence"], ["pin"]), "mode_invalid")
        sha = os.environ.get("GITHUB_SHA", "")
        require(re.fullmatch(r"[0-9a-f]{40}", sha), "sha_invalid")
        if mode == ["evidence"]:
            image = inspect_image(sha)
            output = f"source_sha={sha}\nimage_uri={image}\n"
            if os.environ.get("GITHUB_OUTPUT"):
                try:
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as target:
                        target.write(output)
                except Exception:
                    raise EvidenceError("output_write_failed") from None
            print(output, end="")
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
