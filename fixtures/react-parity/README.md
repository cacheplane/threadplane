# React parity foundations

This directory records the historical package foundations and the bounded shared
LangGraph runtime proof. Core now exposes framework-free contracts; private Angular
and React packages expose native observation bindings. A fixture-only private
LangGraph session runs through the existing transport and SDK in both bindings.
The existing Angular packages and release group remain the production path.

## Bounded runtime slice

The runtime owns immutable snapshots, request generations, stop/dispose, protected
errors, read-only reconciliation after uncertain failures and fixed function-tool
execution. The private session also supports explicit fixed-thread history loading
when its transport can read history. The latest checkpoint replaces the transcript;
equal reads preserve identity, failures preserve the prior snapshot, and loaded
tools never execute. Core contracts and native binding implementations are unchanged.
Angular and React borrow the app-owned session and observe it through their native
lifecycles. The installed consumers run ten scenarios each: inert mount, explicit
history load, equal refresh, empty replacement, text, weather tool
roundtrip, protected error, held partial text and Stop, reuse after Stop, and
unmount followed by explicit disposal and an aborted post-disposal submission.
Five live component submissions plus one tool continuation produce six exact wire
requests, with one handler invocation and zero page errors or unexpected requests.
The three explicit loads make three history reads and no run requests or handler
calls. This is partial T10 coverage: thread switching, pagination, branching, full
backend state and interrupt resume remain outside this proof.

A local HTTP/SSE fixture serves production-built apps and writes real held response
bytes. Browser assertions observe incremental DOM text and a native response-close
handshake on Stop. This is not compositor paint or a latency measurement. Production
React StrictMode does not replay development effects; separate native unit tests
exercise that subscription replay. See [runtime/README.md](./runtime/README.md) for
reproduction and [runtime/evidence.json](./runtime/evidence.json) for fresh commands,
counts, source provenance, cleanup assertions and limitations.

The current inventory has **1,453 records**: the historical 1,438 plus ten private
runtime production sources, three testing helpers, a runtime Vitest config and its
type-test config asset. Public export occurrences remain 550 with 514 distinct local
definitions. The original runtime extraction changed fourteen existing export
records' declaration/import text; history loading adds two private sources and
changes no legacy public export records. There are no legacy export-name additions
or removals. Existing task assignments
are preserved; touched extraction/configuration subsets are in progress, not whole
T03–T16 completion. Core and native package contracts remain outside this legacy
inventory scope and are checked by their own tests and package gates.

## Reviewed baseline

The historical foundation facts were generated from the uncommitted working tree at
base HEAD `7e80cebd607f5c605ef1ec81f11e5ebe3324f81b`. The baseline records the four
reviewed configuration changes: CI foundation projects and Angular consumer gate,
the direct semver tooling dependency, workspace lockfile links, and package aliases.
No inventoried API or implementation changed. This follows the main integration
at `a93977ff1e75796336ddd93a882eab2e40f0ca7b`, including v0.2.0 and its package-version
alignment fix. The foundation inventory contained **1,438 records**: 550 public export
occurrences (514 distinct local definitions), 102 decorated components in 100
files, 461 non-test source files, 128 package assets, 16 distribution/configuration
files, 12 entry points, 41 cockpit topics, and 128 documentation pages. These
counts cover the 16 existing libraries selected for migration; the four new packages
are checked separately by the boundary and packaging gates. The original empty
scaffold evidence remains in [baseline-evidence.json](./baseline-evidence.json).

The earlier research snapshot at `b1685838069c6b1ec56d5e97a1a01170b26aa125`
had 547 export occurrences and 1,435 records. Integration added `AgentRecovery`,
`AGENT_RECOVERY_MESSAGES`, and `AGENT_RECOVERY_DETAILS`. Reviewed changed contracts
also include optional `Agent.checkStatus`, `AgentError.recovery/detail`, recovery
UI actions, unexpected stream closure handling, and development-session observation.
The ownership ledger records these additions. A status check must remain read-only:
a dropped stream does not justify resubmitting work that may already have run.

## Inventory workflow

Run from the repository root after `npm ci`:

```sh
node --test scripts/react-parity/*.spec.mjs fixtures/react-parity/traces.spec.mjs
node scripts/react-parity/inventory.mjs --check
node scripts/react-parity/verify-boundaries.mjs
```

`baseline.json` records source facts and generation provenance; `dispositions.json`
assigns every fact to migration tasks. Both live in `scripts/react-parity/`.
`planned` means assigned future work, not implemented parity. Declaration hashes
include implementation bodies/templates; source and lockfile hashes catch changes
outside declaration names. The checker is a migration drift gate, not a semver
compatibility analyzer. It does not inspect external package declarations.

When a gate detects drift, review the changed API, implementation, asset, docs or
configuration. Update its disposition explicitly, then run:

```sh
node scripts/react-parity/inventory.mjs --write-baseline
node scripts/react-parity/inventory.mjs --check
```

Writing facts never rewrites dispositions. Review the diff, especially removed or
renamed entries, before committing both. CI routes changes to the inventory's
selected libraries, docs, topic definitions and configuration into these gates,
including rootless scripts and fixtures. This intentionally requires review when
an Angular fix or dependency update changes the migration baseline.

## Private package boundaries

| Current private package | Intended responsibility |
| --- | --- |
| `@threadplane/core` | Framework-free data, observation, execution and tool contracts |
| `@threadplane/content` | Shared Markdown, JSON, A2UI and rendering data processing |
| `@threadplane/angular` | Native Angular binding and presentation |
| `@threadplane/react` | Native React binding, rendering and presentation |

All four remain private version `0.0.0`. Core contracts and the native observation
bindings are populated; content and presentation entries remain scaffolds. Core,
content and React use plain ESM packaging; Angular uses Angular Package Format (APF).
The source/declaration verifier follows
module edges, including type-only imports, aliases and re-exports. It blocks
framework dependencies in neutral layers, UI dependencies in backend layers,
backend SDKs in framework layers, Angular/React crossover, and optional/testing
paths reachable from package roots. The populated chat, LangGraph, AG-UI and render
packages retain explicit Angular transition allowances, as does telemetry/browser.
Nx lint constraints provide an additional source gate. The final release gate
remains blocked until those transition allowances and retired packages are removed.

The final package map is a separate destination, not the implemented topology:

| Final package | Responsibility |
| --- | --- |
| `@threadplane/core` | Dependency-free data, observation, execution and tool contracts |
| `@threadplane/langgraph` | Neutral LangGraph transport and lifecycle |
| `@threadplane/ag-ui` | Neutral AG-UI transport and recovery |
| `@threadplane/render` | Neutral render data and registry contracts |
| `@threadplane/a2ui` | A2UI protocol data and processing |
| `@threadplane/content` | Optional Markdown, JSON and A2UI processing |
| `@threadplane/angular` | Angular binding, render components and UI |
| `@threadplane/react` | React binding, render components and UI |
| `@threadplane/telemetry` | Neutral collector; native Angular providers belong to `@threadplane/angular` |

There are no suffixed backend packages or separate React renderer in that map.
The runtime proof keeps the execution owner and publisher private to the backend;
it does not introduce a general shared store. The legacy LangGraph root and tarball
remain Angular. The neutral session is staged only into temporary fixture consumers.
The new tool contract deliberately omits a schema DSL, automatic argument
validation/transformation and validator-to-JSON-Schema conversion. Callers may
supply optional JSON Schema metadata and own any validation in their handlers.
The ledger retains these legacy capabilities as explicit migration omissions;
current Angular behavior is unchanged. Protocol schema assets, form validation and
transport decoding remain in scope.

```sh
NX_DAEMON=false CI=true npx nx run-many -t lint test type-tests build --projects=core,content,angular,react --parallel=2 --skip-nx-cache
NX_DAEMON=false npx nx run langgraph:runtime-quality --skip-nx-cache
NX_DAEMON=false npx nx run langgraph:runtime-type-tests --skip-nx-cache
NX_DAEMON=false CI=true npx nx run-many -t build --projects=chat,langgraph,ag-ui,render,a2ui,telemetry --configuration=production --parallel=1 --skip-nx-cache
npx playwright install --with-deps chromium
node scripts/react-parity/verify-boundaries.mjs --built
node scripts/react-parity/verify-packages.mjs
node scripts/react-parity/verify-angular-package.mjs
```

The plain packaging check packs core, content and React, validates their nine export
paths, README/license inclusion and production exclusions, then imports and
type-checks the tarballs outside workspace aliases with `skipLibCheck: false`.
Its core-only consumer checks all three core exports and rejects extra dependencies.
The separate Angular check packs the one Angular APF entry and proves CLI
compilation/linking with `skipLibCheck: false`. Both frameworks now run installed
production browser apps with the ten shared scenarios. Inferred native contract
probes reject invalid tool names/arguments/results and deep mutations. The private
runtime's narrow declaration is compiler-generated against installed core declarations,
never hand-written; the staged SDK bundle is fixture-only. Both inspect consumer
module inputs for unwanted parsers. Installation footprints include actual installed files;
lockfile locations also include optional platform packages. The Angular footprint
includes CLI/compiler/build tooling. Footprints, root-import probes and application
bundles measure separate surfaces; they are not runtime performance or SSR evidence.
Test-only imports currently add Nx dependencies on legacy package builds even though
the production graphs remain isolated. CI installs Chromium before the packed checks,
runs the isolated Node runtime targets, and preserves production-build-before-scan
ordering. Scenario-only/config-only changes schedule library verification. Stacked
PRs are supported; pushes and production deployment remain guarded to main.

## Existing Angular regression checks

```sh
NX_DAEMON=false CI=true npx nx run-many -t test --projects=chat,langgraph,ag-ui,render,a2ui,telemetry --parallel=1 --maxWorkers=2 --skip-nx-cache
NX_DAEMON=false CI=true npx nx run-many -t type-tests --projects=chat,langgraph,ag-ui --parallel=1 --skip-nx-cache
NX_DAEMON=false CI=true npx nx run-many -t build --projects=chat,langgraph,ag-ui,render,a2ui,telemetry --configuration=production --parallel=1 --skip-nx-cache
node --test examples/chat/smoke/*.spec.mjs scripts/verify-angular-support.spec.mjs
NX_DAEMON=false CI=true npx nx run telemetry:test-install-pack --skip-nx-cache
CI=true node examples/chat/smoke/cli.mjs --non-interactive --fresh --target tmp/react-parity/angular-21 --local-dist-root dist/libs --angular-major 21 --install --build --runtime
```

`--fresh` replaces the disposable generated consumer. The consumer uses local
Threadplane tarballs but independently resolves external ranges; that graph can
differ from the workspace lockfile. Its browser smoke is backend-free. Angular
20/21/22 remain separate existing CI lanes. See [baseline-evidence.json](./baseline-evidence.json)
for commands actually executed, environment and limitations.

## Deterministic traces and performance limits

`traces/*.sse` are newly authored synthetic fixtures with no captured user data or
credentials. Tests use the locked LangGraph SDK and AG-UI HTTP client, splitting
responses into three-byte chunks including a UTF-8 character boundary. They check
text/final state, request identity and terminal reduction without duplicate messages.
They establish decoder behavior, not parity between Threadplane framework bindings.

The existing LangGraph stream-manager/agent tests cover cancellation, delivery
generations, queues and staged results. AG-UI interruption, resume-wire and
persistence tests cover recovery and request serialization. Client-tool tests cover
claim/record, cancellation and completed-result reuse. Later migration tasks must
extend the bounded runtime/binding proof to the remaining migration capabilities.

The parser work test checks linear character processing under duplicate cumulative
argument updates. A single test duration is not a calibrated performance budget.
Consumer bundle warnings describe the canonical example, not the headless package.
T38 still requires stream-to-paint latency, React commit work, long tasks, retained
heap and emitted-module graphs on recorded hardware, including long transcripts,
burst streams and repeated agent/thread disposal.

## Maintenance and release

The foundation branch was `codex/react-support-baseline`; the runtime branch is
`codex/shared-runtime-quality`, based on `bdcc22ed31aa94f420077e046e88e1481088d453`.
The history-loading increment is `codex/langgraph-history-loading`; its verified
base and working-source fingerprint are recorded in `runtime/evidence.json`.
The local maintenance
branch `codex/angular-maintenance-v0.2` points to released tag `v0.2.0`
(`8daea78d35bfa27513474bd624d0e9495af3cfab`) and retains its released lockfile.
Creating that local branch does not establish an operated release lane: a maintainer
must own the backport/publication workflow before it is used. The legacy Angular
package roots retain their existing production path. Version/tag enforcement, remote maintenance
policy and a tested backport/rollback remain T37 work. The existing release group
is unchanged, and none of the new private packages is publishable.

## Task identifiers

The following task index makes the ownership ledger readable independently of local
research documents. It is a scope map, not evidence that the tasks are complete.
T01/T02 describe the foundation increment. The current G1 proof is deliberately limited
to shared LangGraph text streaming and fixed function-tool execution with borrowed native
Angular and React bindings: the runtime owns execution while each binding observes
it. Explicit fixed-thread history loading now covers a further subset of T10.
Renderer reuse and SSR are deferred gates, alongside the broader T01–T39 map.
This bounded runtime proof does not establish complete migration parity.

| Task | Scope |
| --- | --- |
| T01 | Establish the parity baseline and finding ledger |
| T02 | Create package scaffolding and dependency boundaries |
| T03 | Extract data contracts and error identity; omit tool schema ownership |
| T04 | Implement immutable publication and execution scope |
| T05 | Build behavioral replay and unchanged Angular consumer fixtures |
| T06 | Prove native binding and execution ownership; full SSR is deferred to T21 |
| T07 | Prove renderer reuse before writing the catalog |
| T08 | Extract LangGraph transport and request normalization |
| T09 | Extract LangGraph event reduction and delivery projection |
| T10 | Extract LangGraph cancellation, history, branching, queues and subagents |
| T11 | Rebind Angular LangGraph and extract thread services |
| T12 | Extract AG-UI event processing and transaction state |
| T13 | Extract AG-UI interrupts and durable recovery |
| T14 | Extract AG-UI lifecycle and rebind Angular |
| T15 | Extract client-tool declarations and execution; callers own argument validation |
| T16 | Unify tool coordination and correlate presentation results |
| T17 | Separate neutral telemetry from framework integration |
| T18 | Extract Markdown documents and citation projections |
| T19 | Extract JSON classification and A2UI surface processing |
| T20 | Extract render state, readiness and form-session helpers |
| T21 | Introduce safe SSR dehydration and browser boundaries |
| T22 | Build React component foundations, styles and overlays |
| T23 | Implement transcript, composer and basic chat composition |
| T24 | Implement React render registry, context and element lifecycle |
| T25 | Implement render actions, host events and tool views |
| T26 | Implement all Markdown views and citation UI |
| T27 | Implement A2UI surface and all 18 catalog views |
| T28 | Implement approvals, tools, reasoning and subagent UI |
| T29 | Implement thread/project/search/history/timeline/debug surfaces |
| T30 | Implement popup, sidebar and sidenav compositions |
| T31 | Create canonical React applications and public testing utilities |
| T32 | Add frontend identity to registry and runtime bridge |
| T33 | Build React cockpit host and all 41 scenario variants |
| T34 | Make docs routes, navigation and search framework-aware |
| T35 | Author and generate React documentation and agent context |
| T36 | Expand CI and packed consumer compatibility |
| T37 | Prepare prerelease, publishing, provenance and rollback |
| T38 | Measure and optimize streaming, bundles and retention |
| T39 | Complete accessibility, parity audit and maintenance handoff |
