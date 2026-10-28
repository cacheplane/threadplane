# React parity foundations

The private chat package includes a bounded controlled `OverflowMenu` with exact
readonly item/prop contracts and a required React DOM ^19.2.4 peer. The headless
root remains DOM-import-free. Native full directories compose an exact-ID copy
item while retaining app-owned command lifetime and feedback; compact rails stay
selection-only. The installed plain-package fixture additionally checks multi-item
keyboard navigation, natural Tab destinations, local RTL/theme/font across the
portal, unavailable-anchor suppression and edge placement at 1280/390/600px.
Context-menu requests compose `ThreadList` with the same controlled menu. The
application supplies pointer coordinates, invoking rows and open state; the menu
manages focus return and natural Tab traversal. Point changes preserve the
mounted menu and surviving focused item. Native composition keeps request
identity separate from conversation ID and retains existing clipboard/session lifetimes.
The Node check proves DOM-free module import and pre-mount menu trigger rendering
with either controlled open value. These bounded proofs do not establish general
SSR/hydration or release parity. Typeahead and thread lifecycle,
project commands remain future work.

This directory records the historical package foundations and the bounded shared
LangGraph runtime proof. Core now exposes framework-free contracts; private Angular
and React packages expose native observation bindings. A fixture-only private
LangGraph session runs through the existing transport and SDK in both bindings.
The existing Angular packages and release group remain the production path.

## Bounded runtime slice

The private runtime owns immutable aggregate snapshots, command generations,
stop/dispose, protected errors, uncertain-dispatch safeguards, and fixed
function-tool execution. Both native bindings borrow the application-owned
session: subscribing or mounting does not submit work, and unmounting does not
implicitly dispose the owner.

Session-owned native SDK streams and same-run joins request canonical checkpoint
events; supplied custom transports and legacy defaults remain unchanged.
Exact-run failure and uncertainty still prevent successful completion. Unsaved
title and schema callbacks are not canonical application data and still need
separate application admission work.

Explicit fixed-thread history loading replaces the transcript from the latest
checkpoint. Equal reads preserve identity, failures preserve the previous
snapshot, and loaded tools never execute. Readonly application `values` and full
interrupt batches publish atomically with messages. `undefined` means unobserved
values; `{}` means an observed empty map. Child, update and custom envelopes do
not overwrite root application values.

Backend-private submission accepts text or `{ message, state }`. Plain application
state accompanies only that submission's initial POST; tool continuations and
owned-run reconnect never replay it. Runtime messages and the fixed client-tool
catalog retain ownership of their input fields. Submitted state does not
optimistically change observed values. The input contract is broad plain data,
not an inferred or validated application schema.

Explicit `resume()` sends an authored response for observed interrupts without a
synthetic human message. `reconnect()` joins the latest retained owned physical
run only with safe cursor evidence. Captured run identity requires exact-run
status confirmation before successful completion or tool execution; known-run
uncertainty cannot fall back to thread history. Reconnection preserves anonymous
message identity and does not replay submission or resume commands.

Readonly `subgraphs` expose child messages, values, interrupts and protected errors
under exact full namespace tuples. Siblings may reuse message IDs without sharing
state. Child observations never become root messages or executable tool calls.
Physical-run ownership limits reconnect rebasing; pause finalizes authoritative
child text, and an independent submission replaces the prior child collection.

The installed React and Angular consumers each verify fifteen scenarios through
real SDK requests to a local HTTP/SSE fixture. The complete twenty-action review
includes three history reads, ten run POSTs, one cursor join GET and two exact-run
status GETs; one function-tool handler executes. Tool and Drop carry
canonical-shaped application state; continuations and later text submissions
must omit it. Held response bytes demonstrate incremental DOM updates and local
cancellation, not compositor paint or a latency benchmark. React development
effect replay is covered separately in native unit tests.

These are bounded subsets of T08–T10 and related ownership/tool tasks. Thread
switching, pagination, branching, state-only writes, resume state updates, broader
run options, child tool attribution/navigation and complete public adapter migration remain
future work. The factory is private; this proof does not establish an Angular-free
published LangGraph package or full React component parity. See
[runtime/README.md](./runtime/README.md) for precise semantics and reproduction,
and [runtime/evidence.json](./runtime/evidence.json) for fresh verification,
source/artifact identities and limitations.

The foundation/runtime increment recorded **1,459 records**: the historical 1,438 plus sixteen
private runtime production sources, three testing helpers, a runtime Vitest
config and its type-test config asset. That increment recorded 550 export
occurrences with 514 distinct local definitions. Current facts live in
[`baseline.json`](../../scripts/react-parity/baseline.json); run
`node scripts/react-parity/inventory.mjs --check` to verify them against source.
Existing task assignments are preserved;
implementation subsets remain in progress, not whole-task completion. Core and
native package contracts are checked separately by their tests and package gates.

## Native AG-UI cockpit previews

AG-UI Streaming and Interrupts have private installed native React previews.
They reuse the reviewed `react-ag-ui` dependency profile and the existing shared
AG-UI deployment. Interrupts observes one settled native refund pause and sends
an explicitly addressed approve, edited approval or cancellation through the
native session. It requires the full paused transcript plus a current final
assistant message before admitting another Send. The original Angular route
retains its legacy wire contract. Internal refund extraction is excluded from
conversation events while visible acknowledgement still streams.

Frozen compiled-graph tests verify native and legacy bridge behavior. Actual
installed-SDK browser tests cover canonical history, malformed pauses, protected
results, developer endpoint routing and cancellation of held HTTP streams.
These bounded previews do not establish public package availability, saved
conversation restoration or complete AG-UI migration.

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

All four remain private version `0.0.0`. Core contracts, native observation bindings
and bounded content/presentation slices are populated; the task index below
describes the broader migration scope. Core, content and React use plain ESM
packaging; Angular uses Angular Package Format (APF).
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

The plain packaging check packs core, content, React and the legacy A2UI protocol,
validates the sixteen plain ESM export paths, README/license inclusion and
production exclusions, then imports and type-checks the tarballs outside workspace aliases with `skipLibCheck: false`.
Its core-only consumer checks all three core exports and rejects extra dependencies.
The separate Angular check packs the one Angular APF entry and proves CLI
compilation/linking with `skipLibCheck: false`. Both frameworks now run installed
production browser apps with the shared runtime, thread and checkpoint scenarios;
the installed React check currently verifies 27 scenarios. Inferred native contract
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
The child-observation increment is `codex/langgraph-subgraph-observation`; its verified
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
it. Explicit history loading, application values, interrupt observation/resume,
owned-run reconnect, application input and child observation cover further subsets of T08–T10.
The private read-only `RenderSpec` adapter reuses the pinned render data resolvers
and is dogfooded by the native React trip recap. Native React also borrows owned
Markdown/reasoning snapshots and presents supplied citations, approvals and
message actions. See the [native example guide](../../examples/chat/native/README.md)
for composition and installed proof commands. Render actions, the broader catalog
and SSR remain future work, alongside the broader T01–T39 map.
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
| T20 | In progress: private application-owned render state and bounded React readiness; form sessions and full parity remain open |
| T21 | Introduce safe SSR dehydration and browser boundaries |
| T22 | In progress: private controlled ConfirmDialog with native modal/background inertness, Cancel-first focus, pending/destructive intent, scoped theme and bounded focus restoration; full overlay-stack parity remains open |
| T23 | Implement transcript, composer and basic chat composition |
| T24 | In progress: private read-only React registry and committed readiness lifecycle; broader context and full element parity remain open |
| T25 | Implement render actions, host events and tool views |
| T26 | Implement all Markdown views and citation UI |
| T27 | Implement A2UI surface and all 18 catalog views |
| T28 | Implement approvals, tools, reasoning and subagent UI |
| T29  | In progress: private controlled ThreadList selection view, optional app-owned new-conversation request and render-time relative updated timestamps with exact ISO metadata, dogfooded from backend timestamps in native React directory presentations; application owns data/filtering/execution/refresh. Bounded readonly title-content callback receives the original item and returns noninteractive ReactNode phrasing content; original accessible labels survive and null/false output is honored. Native React highlights the first literal loaded-title filter match. No timer or live ticking. Optional readonly boolean pinned metadata presents only strict true with a decorative icon and accessible status before time, preserving original names and supplied order without sorting or writes. Optional readonly `renderActions` receives the original item and composes application-owned interactive controls beside the selection button without changing selection; absent/null/false/undefined output omits its wrapper. Native full directories dogfood exact-ID clipboard copying, app-owned confirmed renaming through the private controlled ThreadRenameForm, and confirmed Pin/Unpin commands with pending/error/retry and independent title/pin/archive reconciliation; native app-owned Archive/Unarchive partition loaded rows into active and archived full lists with the same filter and stable directory feedback across row migration; exact raw boolean confirmation, per-ID pending/retry, independent stale-read protection and selected transcript/draft/running-session preservation remain app-owned. Compact rails stay active-only and selection-only and reflect shared pin state. The ThreadList primitive still renders supplied order; native application grouping sorts active loaded pins by finite pinnedOrder, with stable unranked/tie handling and loaded-slice manual Move up/down commands across filtered neighbors. Partial rank writes require explicit Refresh recovery. Native Delete uses an immutable confirmation target through ConfirmDialog, exact-target 204 or explicit inspection 404 retirement, shared pending/uncertain recovery and lifetime tombstones. It blocks global delete/reorder and target writes while preserving other selected sessions/drafts/responses; selected idle retirement clears only matching session/route. Compact rails remain selection-only. Installed form types, SSR and browser checks cover explicit Save/Cancel, IME, literal titles and responsive containment. Optional readonly renderItem(thread, isActive) replaces full row content with application-owned accessible controls; original objects, exact active equality, keyed reconciliation and empty results are preserved, while default title/actions/context handling are bypassed. Native compact selection rows dogfood this callback without backend or session changes; installed types/SSR and retained browser flows verify it. Controlled ProjectList now provides supplied-order selection and optional app-owned New requests; native derives exact project IDs from loaded metadata and filters full/archived/compact rows without commands or session changes. Project CRUD/catalog and move-to-project, drag reordering, search/history/timeline surfaces and full parity remain open; private Debug is a separate bounded surface |
| T30 | In progress: private controlled non-modal ChatPopup, full-height ChatSidebar with optional persistent page content and desktop content pushing, children-based ChatSidenav and optional sibling ChatSidenavScrim, dogfooded by the native conversation example. Sidenav supports expanded/collapsed navigation and a non-modal drawer, retaining mounted content with an optional readonly ReactNode `collapsedContent` slot; native composes a compact ThreadList using shared filtered rows/selection and full accessible names with pin/time descriptions, while retaining both trees. Optional readonly boolean `toggleShortcut` opts into desktop Ctrl/Command+B controlled mode requests, with editable/claimed-event exclusions and drawer no-op; native dogfoods it across retained draft and active response. This is a bounded private T30 slice; native exact `presentation=sidenav` chooses drawer with a dismissible backdrop at widths <=700px. Optional readonly `onSearch`, `searchLabel` and strict opt-in `searchShortcut` add an application-owned Search request action and Ctrl/Command+K in all modes; native reveals navigation and focuses only the existing loaded-title filter without backend search or extra commands. Peer-panel edge claims, project menus, backend search/search dialogs and other global shortcuts, debug ownership and full composition parity remain open |
| T31 | Create canonical React applications and public testing utilities |
| T32 | In progress: 41 registered native React and 41 Angular frontend identities across LangGraph, Deep Agents, Chat, AG-UI, Render and Runtimes; Chat and AG-UI A2UI reuse their existing shared backends, existing runtimes and bridges are reused, Render playback stays local |
| T33 | In progress: 41 installed React previews (9 LangGraph, 5 Deep Agents, 11 Chat, 7 AG-UI, 6 Render, 3 Runtimes). Chat and AG-UI A2UI share the closed ten-view booking presentation; generic all-18 A2UI parity remains pending |
| T34 | In progress: public selectors and frontend URL state for registered React previews, including native Chat A2UI on its canonical overview; broader navigation/search parity pending |
| T35 | In progress: docs and public agent guidance for native React previews, including the bounded Chat A2UI profile and private package limits; full React docs pending |
| T36 | Expand CI and packed consumer compatibility |
| T37 | Prepare prerelease, publishing, provenance and rollback |
| T38 | Measure and optimize streaming, bundles and retention |
| T39 | Complete accessibility, parity audit and maintenance handoff |

## Private application-owned render state

The optional `@threadplane/content/render-state` entry exports `createRenderState`
and four readonly types. Its bounded T20 owner captures immutable plain data,
uses strict own-data paths, preserves reference no-ops, commits ordered batches
atomically and retains readable state after terminal disposal. See
[the content contract](../../libs/content/README.md) for exact data, path, reference,
notification and lifetime semantics and an application-owned example.

The real installed fixture in `render-state/` borrows the same owner with React
`useAgent` under development StrictMode and Angular `observeAgent`. Application
controls prove external writes while either view is absent, remount identity,
owner replacement, observer release without commands/disposal, and explicit
application disposal. The owner-only bundle excludes framework, backend SDK,
parser and protocol inputs; the mixed presentation installs actual package
artifacts and framework runtimes. SDK assignment is a strict installed type proof
of structural compatibility. It is not complete SDK behavior parity.

Build the actual core, protocol, content and React artifacts, then the Angular
artifact required by the mixed browser fixture. The native React and Angular
profiles each retain their separate four-step foundation build sequence. Run:

```sh
npx nx run-many -t build --projects=core,a2ui,content,react,angular --parallel=1 --skip-nx-cache
node scripts/react-parity/verify-packages.mjs
node scripts/react-parity/verify-render-state.mjs --retain /tmp/new-render-state-proof
```

The retained browser proof records actual installed inputs, tarballs, locks,
compiler/runtime output, snapshots and owner observations, GET-only same-origin
requests, and lifecycle cleanup. Use a new retain directory for each run. The
existing standalone A2UI proof remains separate. The global `--built` boundary
scan above requires all ten fresh package builds; this narrow five-artifact
quickstart does not satisfy that prerequisite.

## Private React readiness

The distinct [readiness fixture](./react-readiness/README.md) proves bounded
T20/T24 admission through the existing `react-render` profile, installing exactly
core, content and React. It compiles the type-only `RenderReadinessEntry` against
installed declarations and observes the actual owner in development React
StrictMode. Pending fallback, real-view commit, retained DOM/local state,
contract replacement, repeated keys and abandoned suspension are checked through
explicit application controls. See the [render contract](../../libs/react/README.md#read-only-render-trees).

```sh
npx nx run-many -t build --projects=core,content,react --parallel=1 --skip-nx-cache
node scripts/react-parity/verify-react-readiness.mjs --retain /tmp/new-react-readiness-proof
```

Use a new retain directory. The proof records installed dependencies separately
from build module inputs and emitted executable modules: installed parser packages
do not imply parser execution. It retains three local artifacts, installed strict
type/browser evidence, source and lock fingerprints, screenshots and owned
process/profile/socket cleanup. The original `render-state` proof remains the
separate mixed React/Angular four-artifact owner proof with its no-SDK contract.
Readiness does not replace it or establish SDK behavior parity.

T20/T24 stay in progress: form sessions, validation, actions, all catalog views,
SSR, hydration, public release and full legacy/SDK/RFC parity remain open.

### Loaded project navigation (private React T29 slice)

`ProjectList` from `@threadplane/react/chat` presents a readonly supplied
`ProjectListItem[]` (`id`, `name`) with controlled `activeProjectId` and
`onSelect(projectId)`. It preserves supplied order and exact IDs, renders names
as literal text (empty names fall back to ID), and marks the active button with
`aria-current`. `label` and `className` customize the list. Optional
`onNewProject`, `newProjectLabel` and `newProjectDisabled` expose an application-owned
request; the primitive performs no creation or persistence. Use unique project IDs.

Native React derives first-seen projects from nonblank string `metadata.projectId`
among all loaded conversations, including archived rows. IDs are preserved exactly
and displayed as names because this example has no project catalog. Selecting a
project filters active, archived and compact rows alongside the existing title
filter. All conversations resets only the project filter. The selected transcript,
draft and running response remain mounted, with no additional backend calls.
A disappearing project stays selected with an empty filtered view until reset.
The project section appears only when loaded projects or a selected filter exist.
Selection is ephemeral; new conversations remain unassigned. Pinned reordering
continues across all loaded pinned conversations, including other projects.
Project CRUD, catalog persistence, move-to-project and full T29 parity remain open.

### Project creation and browser-local names (private React T29 slice)

`ProjectList.renderActions(project)` receives the original readonly item and
composes application-owned controls beside selection. Absent/null/false/undefined
output omits the action wrapper. Commands do not implicitly select a project.
`ProjectNameForm` is a controlled editor with `value`, `onValueChange`, `onSubmit`
and `onCancel`; optional `label`, `className`, `submitLabel`, `pending`,
`submitDisabled` and `error` customize presentation. It focuses/selects once,
protects IME input and blank/pending/disabled submissions, and never saves on blur.
Persistence, request lifetime and return focus belong to the application.

Native React now creates and renames projects in the versioned browser-local
`threadplane-native-react-projects-v1` catalog. It displays local catalog entries
first, then first-seen loaded association IDs without duplicates. Renaming a loaded
ID imports its name locally without changing the ID or backend metadata. Names
are trimmed on Save; duplicate names are allowed because IDs define identity.
Catalog-only projects can be selected with an empty conversation view. New
conversations remain unassigned. These are local labels, not a shared server catalog.

Writes reread and validate the current catalog and publish only after persistence
succeeds. Malformed/unsupported saved data is never replaced; unavailable storage
and write failures keep the draft and target, expose Retry, and block submission
until recovery. Retry reloads without committing. Storage events (including clear)
refresh names without broadening a retained filter or replacing an active draft.
This uses browser localStorage's last-writer-wins behavior, not atomic multi-tab
transactions. No cross-device sharing or backend project commands are introduced.
Project selection, naming and persistence preserve the selected conversation,
transcript, composer draft and running session without extra network calls.
Project deletion, association writes/move-to-project and full T29 parity remain open.
