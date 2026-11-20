# AG-UI package proof

`@threadplane/ag-ui` is a framework-neutral package: its root exports
`createSession` and the rest of the session runtime, and it contains no Angular
code. This proof packs the package the release publishes, `dist/libs/ag-ui`,
installs the tarball into isolated consumers and runs them.

With the repository's existing npm dependencies, Python 3.12 and `uv` available,
build the prerequisites and install both exact local service locks:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react,ag-ui --skip-nx-cache --outputStyle=stream
npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund
export THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT=/tmp/threadplane-agui-client-tools-native-fixture-env
UV_PYTHON=3.12 UV_PROJECT_ENVIRONMENT="$THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT" uv sync --frozen --no-install-project --project cockpit/ag-ui/client-tools/python
node --test scripts/react-parity/ag-ui-package.spec.mjs fixtures/react-parity/native-ag-ui-client-tools/server.spec.mjs
node scripts/react-parity/verify-ag-ui-client-tools.mjs
node scripts/react-parity/verify-ag-ui-package.mjs
```

The verifier stages `dist/libs/ag-ui` and proves it current: every compiled
module and declaration equals a fresh compile of `libs/ag-ui/src`, and the
source is exactly the reviewed module list in `ag-ui-package.mjs`. The manifest
is public ESM whose root is `src/public-api`, with peers on `@threadplane/core`,
`@ag-ui/client` and `rxjs` only and the shared install hook. Every module
imports only the package's own files, core, the AG-UI client and RxJS, which is
the client's own stream type; an Angular or chat import fails. The tarball is
installed with real core, React and Angular tarballs. The APF output and the
framework-only SDK installation ban remain separate required checks.

The pinned AG-UI client 1.0.1 uses real vendor dependencies, including RxJS and
Zod. The existing root npm override `rxjs: ~7.8.0` selects locked RxJS 7.8.2 despite
the SDK's raw 7.8.1 dependency declaration. The candidate records that supported
override, validates its effective range and checks the complete installed graph
against the root lock. Shared vendors receive exact top-level and recursive pins;
conflicting versions require review instead of flattening them. In particular,
the shared protobuf dependency remains 2.11.0. No dependency is upgraded.
The mixed consumer also pins and compares the complete owner-relative closure
of its framework and type-package roots, including scheduler, csstype and
undici-types. Package hoisting paths may differ; resolved versions and dependency
edges must match. The backend owner's vendor graph is recorded separately.

Plain Node verifies zero fetch attempts during import, construction, observation
and disposal. Strict NodeNext and browser checks use the full installed
declarations with `skipLibCheck: false`. Framework bindings retain the native
snapshot type. Core is required by those declarations; its implementation need
not occur in the backend's runtime graph.
The sole additional bare subpath is a type-only `@threadplane/core/tools`
declaration dependency resolved from the actual packed core tools entry.
The root's runtime exports are an exact list: `createSession`, whose session is
a core `AgentSession`; the selectors `projectTextTranscript`, `projectMessages`,
`projectToolCalls` and `projectStreamingToolCalls`; `decisionState` and
`interruptSession`; `httpReplay`; `bridgeCitationsState`; and `FakeAgent`.
Heterogeneous authored handler argument and result contracts are verified under
NodeNext and Bundler, including readonly projections, an empty catalog and the
original no-catalog snapshot contract.

The installed client-tools proof uses `createSession(options, catalog)` against
an owned loopback server and the actual canonical compiled Python graph,
repository middleware and locked adapter. Only the model is replaced with an
offline scripted model. In separate nonstream and stream worker lifetimes, one
human submission causes two distinct physical runs, one handler invocation,
an exact authored result carried into the real model, a final answer and an
exact native result echo. Snapshot-only calls and streamed argument repair are
verified from genuine adapter events. Unknown calls, held-terminal cancellation
and noncooperative handler cancellation are separate negative scenarios. Each
receipt records sources, module identities, exact Python patch and package
versions, denied socket/DNS operations and owned resource closure.

The Library CI job uses its existing Python 3.12 setup and performs the frozen
client-tools sync before the scoped worker tests and full candidate proof.
`uv run --frozen --no-sync` deliberately relies on that completed sync. To verify
a clean environment locally, choose a new empty directory for
`THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT` and repeat the sync and checks above.
The fixture accepts any Python 3.12 patch and records the actual patch in its
provenance. It requires no provider credentials or paid model requests.

The installed browser uses the same application and independent HTTP oracle as
the original native review: all 13 controls, two owners, both frameworks, child
text/tool observations, native resume, view removal/remount, stop and disposal.
All four exact requests must physically close before cleanup. The same extracted
Mastra runner also verifies approval, decline, cancellation and a deliberately
lost terminal through the actual local service: eight exact requests, actual tool
results and closure before cleanup. The owner SDK is resolved relative to its
installed package, separately from the service SDK. Scripted service setup and
the loopback fetch guard retain their original ownership and cleanup rules.

To preserve successful artifacts, choose a new directory:

```sh
node scripts/react-parity/verify-ag-ui-package.mjs --retain /tmp/threadplane-ag-ui-package
node scripts/react-parity/verify-ag-ui-package.mjs --review /tmp/threadplane-ag-ui-package
```

Review serves the checked candidate bundle without rebuilding, installing or
opening a browser. Run it twice for independent Chrome and in-app browser
sessions. Follow the displayed sequence from First through Try disposed.
`/stats` exposes the existing independent request verdicts and physical closure
evidence. Reload creates a fresh review ID without resetting other pages. Ctrl+C
closes only that command's server and leaves retained files available.

`provenance.json` records source/emission hashes, tarballs, complete installed
Threadplane files and declarations, resolved versions, owner-relative SDK
identity, type/build inputs, browser bytes and browser/provider results. Normal
build hashes and installed artifact hashes describe different stages: npm can
omit build-only metadata such as `.npmignore`. Installed bytes are compared to
the actual unpacked tarball, not to an assumed identical dist directory.

This establishes the specified local native client-tool execution and automatic
continuation with an offline scripted model. It does not establish hosted model
access, universal provider support, durable cancellation or execution, persistence,
history loading, reconnect, SSR or hydration. The source review and source Mastra executables remain separate
required proofs; they alone do not prove package installation.
