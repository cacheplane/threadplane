# React parity foundations

This directory supports the first migration increment: a reviewed Angular baseline
and six private, empty package scaffolds. It does not provide React components,
state management, backend adapters, or an approved shared-runtime architecture.
The existing Angular packages and release group remain the production path.

## Reviewed baseline

The source baseline is main commit `a93977ff1e75796336ddd93a882eab2e40f0ca7b`
(21 September 2026 integration). It includes the v0.2.0 release and the upstream
package-version alignment fix. It contains **1,438 records**: 550 public export
occurrences (514 distinct local definitions), 102 decorated components in 100
files, 461 non-test source files, 128 package assets, 16 distribution/configuration
files, 12 entry points, 41 cockpit topics, and 128 documentation pages. These
counts cover the 16 existing libraries selected for migration; the six new empty
packages are checked separately by the boundary and packaging gates.

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

| Package | Intended responsibility |
| --- | --- |
| `@threadplane/core` | Framework-free contracts, immutable publication, execution ownership, tool contracts |
| `@threadplane/content` | Shared Markdown, JSON, A2UI and rendering data processing |
| `@threadplane/langgraph-core` | LangGraph transport, reduction and lifecycle |
| `@threadplane/ag-ui-core` | AG-UI transport, reduction and durable recovery |
| `@threadplane/react-render` | React rendering registry and lifecycle |
| `@threadplane/react` | React subscriptions, chat components and compositions |

All six are private version `0.0.0`, with empty ESM entry points. Their intended
responsibilities are not implemented. The source/declaration verifier follows
module edges, including type-only imports, aliases and re-exports. It blocks
framework dependencies in neutral layers, UI dependencies in backend layers,
backend SDKs in React layers, Angular/React crossover, and optional/testing paths
reachable from package roots. Nx lint constraints provide an additional source gate.

```sh
NX_DAEMON=false CI=true npx nx run-many -t lint test type-tests build --projects=core,content,langgraph-core,ag-ui-core,react-render,react --parallel=2 --skip-nx-cache
node scripts/react-parity/verify-boundaries.mjs --built
node scripts/react-parity/verify-packages.mjs
```

The packaging check packs all six builds, validates all 24 export targets,
README/license inclusion, production exclusions and `use client` directives, then
imports and type-checks the tarballs outside workspace aliases. Its first consumer
installs only core and rejects any additional dependency. This proves empty-package
isolation; it does not establish React SSR or shared-runtime correctness.

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
replay these behaviors through the extracted runtime and both bindings.

The parser work test checks linear character processing under duplicate cumulative
argument updates. A single test duration is not a calibrated performance budget.
Consumer bundle warnings describe the canonical example, not the headless package.
T38 still requires stream-to-paint latency, React commit work, long tasks, retained
heap and emitted-module graphs on recorded hardware, including long transcripts,
burst streams and repeated agent/thread disposal.

## Maintenance and release

The integrated candidate is `codex/react-support-baseline`. The local maintenance
branch `codex/angular-maintenance-v0.2` points to released tag `v0.2.0`
(`8daea78d35bfa27513474bd624d0e9495af3cfab`) and retains its released lockfile.
Creating that local branch does not establish an operated release lane: a maintainer
must own the backport/publication workflow before it is used. No Angular facade
currently depends on a new package. Version/tag enforcement, remote maintenance
policy and a tested backport/rollback remain T37 work. The existing release group
is unchanged, and none of the scaffolds is publishable.

## Task identifiers

The following task index makes the ownership ledger readable independently of local
research documents. It is a scope map, not evidence that the tasks are complete.
T01/T02 are this foundation increment; G1 still needs actual runtime extraction,
unchanged Angular consumer behavior, React lifecycle/SSR tests and renderer proof.

| Task | Scope |
| --- | --- |
| T01 | Establish the parity baseline and finding ledger |
| T02 | Create package scaffolding and dependency boundaries |
| T03 | Extract data contracts, schemas, and error identity |
| T04 | Implement immutable publication and execution scope |
| T05 | Build behavioral replay and unchanged Angular consumer fixtures |
| T06 | Prove React binding, ownership, and packed SSR import |
| T07 | Prove renderer reuse before writing the catalog |
| T08 | Extract LangGraph transport and request normalization |
| T09 | Extract LangGraph event reduction and delivery projection |
| T10 | Extract LangGraph cancellation, history, branching, queues and subagents |
| T11 | Rebind Angular LangGraph and extract thread services |
| T12 | Extract AG-UI event processing and transaction state |
| T13 | Extract AG-UI interrupts and durable recovery |
| T14 | Extract AG-UI lifecycle and rebind Angular |
| T15 | Extract client-tool declarations, guards and execution service |
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
