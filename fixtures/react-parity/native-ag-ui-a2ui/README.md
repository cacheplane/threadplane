# Installed native AG-UI A2UI transport proof

This contributor fixture checks whether the installed native AG-UI Session can
settle four aviation turns against the canonical
`cockpit/ag-ui/a2ui/python/src/graph.py`, its compiled graph and MemorySaver, and
the `LangGraphAgent` adapter resolved from that topic's frozen `uv.lock`.
It does not register a React topic or change the native runtime.

## Prerequisites

- Run from the repository root with the root `npm` dependencies already installed
  from `package-lock.json` (`npm ci` in a clean checkout).
- Have Node 22, npm, uv, and Python 3.12 installed. `node`, `uv`, and `python3.12`
  must be on the launcher's PATH. No Python download is allowed by the commands
  below. The Library job reuses its existing pinned Python setup.
- Have access to package registries for the frozen Python sync and isolated npm
  consumer installation, or have the needed packages cached. The graph run itself
  uses no provider credentials or external services.
- Use a platform supporting loopback HTTP, process identity inspection with
  `/bin/ps`, and process signals. The verifier fails if owned-child closure or
  process absence cannot be established.

## Run

These Bash commands resolve the installed tools once, create a new exclusive owner
directory, then close inherited environment variables for every tool invocation.
They neither source the root `.env` nor pass credentials, tracing, or
`NODE_OPTIONS`. Canonicalize the owner before deriving paths so `/tmp` symlinks
also satisfy the installed-owner path checks. Keep each attempt's owner directory;
do not reuse `proof`.

```bash
set -euo pipefail
node_path="$(command -v node)"
uv_path="$(command -v uv)"
python_bin="$(command -v python3.12)"
owner="$(mktemp -d /tmp/tpa2.XXXXXX)"
owner="$(env -i "$node_path" -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$owner")"
fixture_home="$owner/home"
fixture_cache="$owner/cache"
fixture_tmp="$owner/tmp"
fixture_environment="$owner/environment"
fixture_path="$(dirname "$node_path"):$(dirname "$uv_path"):$(dirname "$python_bin"):/usr/bin:/bin"
mkdir "$fixture_home" "$fixture_cache" "$fixture_tmp"
: > "$fixture_home/npm-user"
: > "$fixture_home/npm-global"
proof_env() {
  env -i HOME="$fixture_home" PATH="$fixture_path" TMPDIR="$fixture_tmp" LANG=C.UTF-8 \
    NX_LOAD_DOT_ENV_FILES=false NX_DAEMON=false NX_TUI=false \
    NX_CACHE_DIRECTORY="$fixture_cache/nx" NX_WORKSPACE_DATA_DIRECTORY="$fixture_cache/nx-data" \
    NX_SOCKET_DIR="$owner" \
    npm_config_cache="$fixture_cache/npm" \
    npm_config_userconfig="$fixture_home/npm-user" npm_config_globalconfig="$fixture_home/npm-global" \
    UV_PROJECT_ENVIRONMENT="$fixture_environment" UV_CACHE_DIR="$fixture_cache/uv" \
    PYTHONDONTWRITEBYTECODE=1 LANGSMITH_TRACING=false LANGCHAIN_TRACING_V2=false \
    "$@"
}
proof_env "$node_path" -e 'if (process.versions.node.split(".")[0] !== "22") process.exit(1)'
python_path="$(proof_env "$uv_path" python find --no-project --no-config --no-python-downloads 3.12)"
proof_env npx nx build core --skip-nx-cache
proof_env "$uv_path" sync --frozen --no-install-project --no-config \
  --no-python-downloads --python "$python_path" --project cockpit/ag-ui/a2ui/python
proof_env "$node_path" --test --test-timeout=10000 \
  scripts/react-parity/verify-ag-ui-a2ui.spec.mjs \
  fixtures/react-parity/native-ag-ui-a2ui/server.spec.mjs scripts/ci-scope.spec.mjs
proof_env "$node_path" scripts/react-parity/verify-ag-ui-a2ui.mjs \
  --retain "$owner/proof" --python "$fixture_environment/bin/python" \
  --environment "$fixture_environment" --home "$fixture_home" --tmpdir "$fixture_tmp"
```

The core build supplies the local packaged prerequisite. The verifier emits and
packs the AG-UI candidate, installs it and the local core tarball into
`proof/consumer`, checks the actual installed bytes, typechecks the consumer in
strict NodeNext and Bundler modes, and bundles the installed probe with an input
inventory. It does not install into the repository root. Calling the verifier
without arguments prints the five required path flags and does not launch it.

For checks that do not sync, install, or launch the actual Python worker, use
the same owned `proof_env` wrapper:

```bash
proof_env "$node_path" --test --test-timeout=10000 \
  scripts/react-parity/verify-ag-ui-a2ui.spec.mjs \
  fixtures/react-parity/native-ag-ui-a2ui/server.spec.mjs scripts/ci-scope.spec.mjs
proof_env "$node_path" scripts/react-parity/inventory.mjs --check
proof_env "$node_path" scripts/react-parity/verify-boundaries.mjs
```

The Library lane runs the installed proof after its existing foundation builds
and AG-UI candidate checks. Its separate owner is
`${{ runner.temp }}/threadplane-agui-a2ui`; it does not borrow the client-tools
environment or lock. Both the CI step and the worker/request operations have
finite deadlines. Local automation should also set an outer deadline and retain
the directory on failure.

## What the evidence establishes

One positive owner uses one thread and four real POSTs against one worker,
compiled graph, and checkpointer: seeded LAX/JFK booking; edited
SFO/SEA/2027-02-17/3/Business search; UA204 selection and confirmation; then
modify-search restoring those values. Native success, idle state and matching
root `RUN_FINISHED` must agree with separately inspected graph checkpoints and
canonical 2/4/6/8-message histories. A successful graph checkpoint cannot rescue a
failed, paused, interrupted, pending, or uncertain native outcome.

The deterministic model and local title-metadata client replace remote I/O only.
The actual graph functions, prompts, structured-output parsing and retry, title
model call, aviation tools, envelopes, adapter serialization, and saved root state
still execute. No graph nodes, checkpointer, HTTP response, terminal snapshot, or
wire events are substituted. The worker denies external IP sockets, DNS,
connections and sends; denied attempts remain failure evidence.

Adapter events are retained unchanged and in order. The worker buffers each
adapter run before the Node bridge sends the encoded SSE, so this proves buffered
transport and terminal agreement, not real-time chunk delivery. Intermediate
native callbacks are retained, including transient structured/title rows. They
are observations, not authority for a settled A2UI surface; terminal validation
requires the exact ordinary transcript, unchanged prefix, identities and authored
human/final-assistant rows. Native and graph evidence remain separate.

## Retained files and failures

Inspect `proof/provenance.json` for status, stages, failures, source stability and
cleanup. The directory also retains:

- `selected-source/`, `source-before.json`, `source-after.json`, worker identity
  and source/package records, linking the attempt to its actual inputs.
- The emitted `candidate/`, local `.tgz` files, `packed.json`, payload records,
  full installed `consumer/` and inventory, owner resolution, strict declaration
  inputs/diagnostics, and bundle metafile/input records.
- `server-turn-*.json`, `server-final.json`, `accepted-turn-*.json`, and
  `native/` with actual request/wire, native callbacks, completion
  outcomes, checkpoints/history, model/title/metadata traces and tool receipts.
- Child start/process and closure receipts; early failures retain whichever
  stages completed. A missing or incomplete receipt is not acceptance.

Separately labeled fake-transport controls use real native owners for a transport
fault, Stop, and New. The coordinator preserves the actual native Stop outcome,
retires its generation, quarantines and disposes that owner, rejects stale or
overlapping actions, and admits New only with a distinct owner/thread. These
controls are not positive adapter evidence. Cleanup must establish child exit,
stdio drain/closure and listener closure; unknown cleanup fails verification.

CI uploads the complete `proof` directory on success or failure, with hidden files
included to preserve installed inventory such as `node_modules/.package-lock.json`.
It excludes the Python environment, home, cache and temporary directory. Retain
failed attempts separately; do not overwrite evidence or relax validators after
observing a failure.

This is a transport feasibility fixture. It makes no claim about React UI
composition or rendering, public/provider acceptance, an 18-component catalog,
SSR, package publication, or readiness of a combined AG-UI/A2UI rendering profile.
