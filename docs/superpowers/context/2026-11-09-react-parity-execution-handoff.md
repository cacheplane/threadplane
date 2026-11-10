# Threadplane React parity execution handoff

> **For the receiving agent:** Build, test, dogfood, and verify the remaining React parity gaps. This is an implementation assignment, not permission to stop after another audit or roadmap. Use the applicable development and review skills. Execute one coherent milestone at a time, create a PR, merge through normal checks when green, and verify the actual merged main revision in production. Reassess this snapshot before choosing the next milestone.

**Goal:** Complete the remaining supported React behavior against Threadplane's actual Angular contracts while preserving framework boundaries, application ownership, and honest release claims.

**Architecture:** Shared execution and content owners remain framework-free. React observes borrowed immutable snapshots and presents controlled components; applications own commands, persistence, catalog selection, and session disposal. Reuse existing shared engines and proven private integrations instead of implementing a second parser, runtime, or execution authority in React.

**Tech stack:** Root npm workspace, Nx, TypeScript, React 19, Vitest, Playwright, framework-free core/content packages, existing Angular libraries, and installed-package native examples.

## 1. Start here

- [ ] Read repository `AGENTS.md` and any more local instructions. Read this handoff completely.
- [ ] Fetch remote state and inspect scoped status before changing anything. Pull with `--ff-only` in a clean appropriate worktree; preserve other branches, stashes, and user changes. If a branch has diverged, create an isolated branch from current `origin/main` instead of resetting it.
- [ ] Recheck PR #1500, main CI/security workflows, and both promotion refs. Resolve the pending release before treating its code as part of main.
- [ ] Reconcile each proposed gap with current source, tests, package exports, and native dogfood. A disposition marked `planned` is not sufficient evidence that behavior is missing.
- [ ] Write a bounded implementation plan with exact contracts and acceptance cases. Then implement it. Continue through tests, browser proof, PR, merge, and post-merge verification; do not end at the plan.
- [ ] After each completed release, reassess the remaining inventory and continue with the next coherent gap. Ask the user only for an unresolved product decision, missing external access, or a genuinely destructive action.

The user has authorized PR creation, normal merge on green, automatic branch updates as main advances, and production verification. Do not repeatedly ask for routine approval. Do not use an admin bypass to satisfy this handoff. Do not send messages to other people without explicit authorization.

## 2. Verified starting snapshot

Reassessed on **November 9, 2026**. An isolated worktree was created at `/private/tmp/threadplane-react-parity-handoff`, branch `blove/react-parity-handoff`; `git pull --ff-only origin main` returned **Already up to date**. The original citation worktree and feature branches were preserved.

| Item                   | Observed state                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Main and `origin/main` | `b3d7b2b5e2e22928c7fa3f8ccd81ca17a9289df8`, PR #1499 assistant-control reveal                                                      |
| Main CI                | [42632325429](https://github.com/cacheplane/threadplane/actions/runs/42632325429), attempt 2, success                              |
| Main CodeQL            | [42632325244](https://github.com/cacheplane/threadplane/actions/runs/42632325244), success                                         |
| Main Scorecard         | [42632325240](https://github.com/cacheplane/threadplane/actions/runs/42632325240), success                                         |
| General promotion ref  | `deploy/last-promoted` equals the main SHA above                                                                                   |
| AG-UI promotion ref    | `deploy/ag-ui-demo-last-promoted` equals the main SHA above                                                                        |
| Pending feature        | [PR #1500](https://github.com/cacheplane/threadplane/pull/1500), open, not merged, head `3127bf17f3fa7eade7d7c97ff7e314c364acde9e` |
| Pending feature CI     | [42670310986](https://github.com/cacheplane/threadplane/actions/runs/42670310986), attempt 1, failure; CodeQL passed               |

The prior PR #1499 release was verified with full main CI, production deployments, public docs, 104 production smoke cases, and both refs. The fresh reassessment above rechecked remote CI conclusions and refs; it did not rerun production smoke or live docs. Do not present that earlier proof as verification of PR #1500 or any later revision.

### First release blocker: PR #1500

This PR adds `MessageAction.icon` and `iconOnly`, native compact Copy answer, installed styled/CSS-free fixtures, API docs, and an inline citation-preview dismissal regression fix. These changes are **not on main** at this snapshot. Do not recreate them on another branch.

Fresh CI metadata shows `Native conversation — react` succeeded, as did the Angular native job and both CodeQL languages. The failed jobs are:

- [Cockpit aggregate job 129359866870](https://github.com/cacheplane/threadplane/actions/runs/42670310986/job/129359866870): its log says `Matrix outcome: abandoned` and exits 1.
- [CI required job 129359923321](https://github.com/cacheplane/threadplane/actions/runs/42670310986/job/129359923321): failed downstream.

Paginated job metadata exposed no other failed, cancelled, or timed-out child job at reassessment. This establishes the aggregate symptom, **not** why GitHub reported an abandoned matrix. Investigate the selected matrix, expected child set, run attempts, workflow dependencies, and authoritative job/check metadata. Do not weaken the aggregate, delete coverage, assume a product failure, or blindly rerun only an aggregate that still depends on an abandoned result. Select a rerun or code fix only after establishing what it can resolve. A PR whose required aggregate is red must not merge.

Prior current-feature local evidence: 915 React tests across 46 files; type tests, lint, build, six retained parity producers, independent package/candidate/native audits, a 45-case native suite with zero failed/flaky/skipped cases, and a manual 7-request walkthrough all passed. This is historical evidence for the exact PR head, not a substitute for new checks after edits.

### Local compiler watcher limitation

Two local macOS two-worker full-suite runs failed development compiler-watch recovery. The second passed 44/45 cases but retained a deleted negative TypeScript fixture as TS6053. Isolated development and six paired direct-compiler probes passed; neither polling nor concurrency was established as the cause. No speculative watcher fix was made.

The repository config `examples/chat/native/e2e/playwright.config.ts` defaults to **one worker**, zero retries, a 240-second case deadline, and 15-second assertions/actions. The separate full default-worker run passed 45/45. `.github/workflows/ci.yml` explicitly overrides React to **two workers on Ubuntu**, and PR #1500's corresponding job passed. Preserve these distinct facts. Do not call the local two-worker problem fixed, relabel a serial result as parallel coverage, or lengthen deadlines/remove assertions to obtain green.

## 3. Sources of truth and inventory interpretation

Read these in order:

1. Current source and current installed-package/browser behavior.
2. `libs/react/package.json`, actual entry-point files, project targets, and current CI.
3. `libs/react/README.md`, `libs/core/README.md`, `libs/content/README.md`, and the matching Angular implementation/tests.
4. `scripts/react-parity/baseline.json` and `dispositions.json`, joined by exact `id`.
5. Historical plans, PR descriptions, and temporary local evidence as context only.

The original [PR #1193](https://github.com/cacheplane/threadplane/pull/1193) established a limited T22/T23 chat slice. Its exclusions are historical: overlays, typing, scrolling, approvals, and many navigation features have since been implemented. Do not reuse that old exclusion list as today's backlog.

At audited main, the inventory has **1,943 records**: 164 assets, 117 component declarations, 16 configs, 192 docs, 25 entries, 730 exports, 658 sources, and 41 topics. There are 694 unique export definitions. Disposition totals are 1,353 planned, 581 in progress, and 9 complete. The 505 records treated as `react` comprise 259 planned and 246 in progress. The nine `complete` records are classified `internal`; these counts are **not a feature-completion percentage**.

The inventory also covers shared, infrastructure, Angular-only, internal, and excluded records. A legacy per-node Markdown component can remain planned even though React's single `NodeView` already renders its behavior. Proposed target paths can be stale (`chat/input.tsx` versus actual `chat/chat-input.tsx`, for example). Inspect behavior before adding files or marking records complete. Preserve every ownership row; do not mass-complete tasks to eliminate red/planned labels.

`inventory.mjs --check` freshly passed on this main snapshot. It validates source facts and ownership coverage, **not implementation parity**. Its task-ID validator checks syntax, not that an external master plan is current or available.

## 4. Capabilities already present

Preserve and extend these instead of restarting them:

- **Ownership and content:** `useAgent` borrows structural observers; `content/messages` projects stable rows with owned Markdown/reasoning lifetimes. Core sessions own submit/stop/check-status/disposal. Snapshot changes and view lifetime are separate.
- **Conversation presentation:** Chat, ChatInput, MessageList, eleven-prop ChatMessage, previous-role spacing, streaming caret, hover/focus control reveal, typing indicator, scroll pinning including ResizeObserver growth, scroll bubble, reasoning, citations/cards/previews, tool activity/group summaries, app-authored actions, explicit errors/recovery, welcome and follow-up suggestions.
- **Native conversation management:** rename/delete/archive/pin/unpin, pinned grouping/order and bounded drag ordering, loaded-title search, project creation/rename/deletion/assignment, project overflow menus, popup/sidebar/sidenav. Project deletion removes membership while preserving conversations and handles uncertainty explicitly. Much of this orchestration belongs to the example, not the library.
- **Read-only render:** `RenderSpec` supports authored registries, own-key lookup, state expressions, visibility, repeat identities, pure computed functions, and commit-latched readiness. This is more than an empty renderer scaffold.
- **Bounded A2UI dogfood:** native `a2ui-trip-catalog.ts` validates a narrow authored catalog, projects accepted content into RenderSpec, and renders TripSummary. `libs/cockpit-a2ui-react` separately contains React form/action/surface implementations. Neither establishes general `@threadplane/react` A2UI catalog parity.
- **Debug:** separately exported passive ChatDebug, current values, explicit app-owned checkpoint reads, context/generation matching, bounded copying, preferences, and selected-checkpoint-versus-current StateDiff.

Root, chat, Markdown, render, and Debug entry points are separate. React package version is `0.0.0` and `private: true`. Client-only root observation, private backend factories, and local installed-package proof do not establish public release, SSR, or hydration support.

## 5. Remaining implementation workstreams

This order is a recommended dependency-aware sequence after closing PR #1500. Reorder only with a code-backed reason. Split each broad workstream into reviewable milestones; do not combine a new runtime, renderer, and release migration in one PR. The gaps below are grounded in current interfaces, not merely missing filenames.

### A. Controlled chat primitives and composition contracts

**Evidence:** `libs/chat/src/lib/primitives/chat-select/chat-select.component.ts`, `chat-launcher-button/chat-launcher-button.component.ts`, `chat-window/chat-window.component.ts`, and Angular `compositions/chat/chat.component.ts`; compare `libs/react/src/chat/index.ts`, `chat.tsx`, `chat-input.tsx`, `message-actions.tsx`, and `message-list.tsx`.

React has no equivalent exported select, launcher, or standalone window primitive. The Angular select has labelled/disabled options, controlled selection semantics, a body-level listbox overlay, keyboard navigation, Escape and positioning. React's ChatProps is a narrower composition contract than Angular's view/tool/model/activity/interrupt customization. Existing `renderMessage`, `children`, controlled panels, and action slots satisfy parts of those needs; avoid inventing a second API for an existing slot.

- [ ] Start with a bounded controlled **Select** milestone if no newer change covers it. Specify readonly options, value/change intent, disabled behavior, labels, and ownership. Reuse proven React overlay patterns without turning an internal helper into a public package commitment accidentally.
- [ ] Dogfood a real app-owned selection in the native example. Do not pretend a display-only option changes the backend model, and do not send a request just to demonstrate a menu. If a provider model command is required but absent, keep that integration a separate contract task.
- [ ] Add launcher/window composition where the existing panels demonstrably do not cover the Angular behavior.
- [ ] Reconcile message actions after #1500. React still has caller-authored generic actions; Angular has dedicated copy, rating state/events, and regeneration. Implement explicit presentation/intent contracts with stable message identity. Do not silently add fake regeneration or persistence to a generic button callback.
- [ ] Compare named Angular activity/run/interrupt/tool templates with existing React slots, then implement only missing composition semantics and test defaults plus custom renderers.

**Acceptance:** keyboard and touch operation, disabled-option skipping, accessible name/state, accepted controlled transitions, outside focus preservation, owner-document portals, viewport/RTL/reduced-motion behavior, independent instances, StrictMode cleanup, stable mounted content, CSS-free fallback where applicable, and zero session/network effects from opening/closing/rendering. Retained callbacks become inert when their owning view retires.

### B. Structured tools, subagents, traces and interrupts

**Evidence:** Angular `primitives/chat-subagents`, `chat-trace`, `chat-tool-calls`, `chat-tool-views`, `chat-interrupt`; `compositions/chat-subagent-card`, `chat-tool-call-card`, `chat-interrupt-panel`. Compare React `tool-activity.tsx`, `tool-observation.tsx`, `approval-card.tsx`, and native `approval.tsx`. Review T28 rows individually.

Tool observation, grouping, outcomes and native approval already exist. Structured subagent/trace presentation and broader tool-view/interrupt composition remain gaps; there are no corresponding React exports in the audited chat entry. Native AG-UI observation can retain backend-specific subagent/run evidence without making all shared display components accept every protocol snapshot.

- [ ] Build passive typed subagent/trace views over explicit borrowed data before adding orchestration.
- [ ] Preserve call IDs, parent/child attribution, repeated occurrences, partial arguments, status/error/unknown distinctions, nested ordering and expansion state.
- [ ] Extend approval/interrupt presentation only through explicit application-owned actions and current ownership tokens. Correlate a response with the exact pending request and reject stale/double activation.
- [ ] Dogfood an actual supported native runtime fixture. Use existing private backend seams and shared lifetime tests; do not fabricate terminal success from a rendered card or raw tool output.

**Acceptance:** pending/streaming/complete/error/cancelled/unknown displays, call ID collisions across runs, corrected metadata, stale responses, A-B-A selection races, hidden/remounted views, two observers, unmount during active work, precise command counts and abort/disposal evidence. Rendering is never authorization to execute a tool.

### C. Markdown extension and remaining source presentation

**Evidence:** React `markdown/markdown.tsx` exports only snapshot/citations/citationPreview inputs and hard-codes node dispatch. Legacy Angular `libs/chat/src/lib/markdown/markdown-children.component.ts` dispatches through a registry; inspect `markdown-view-registry.ts`, view implementations, and streaming contracts. The newer `libs/angular/markdown` adapter is also intentionally bounded; it is not the entire legacy parity target.

React already renders semantic nodes, tables, safe images/links, task lists, reference fallback, and source previews. Missing broad customization is a typed custom node/view mechanism, not basic rendering of every node whose old component row is planned. Math remains delimited text. Code blocks currently omit Angular's language CSS class. Syntax highlighting must not be called an Angular parity requirement unless the selected reference actually supplies it; the inspected legacy code block adds a language class, not a highlighter.

- [ ] Define a typed, readonly node renderer/registry contract over the **current content-domain nodes**. Do not reintroduce the legacy parser or mutate borrowed snapshots.
- [ ] Retain defaults for omitted registrations and preserve stable node/generation identity. Carry table-header, nested-anchor and per-message citation scope correctly through overrides.
- [ ] Close supported language/metadata presentation gaps in a small milestone; specify math/highlighting as separate capabilities when justified.
- [ ] Reassess remaining citation display/grouping/utilities and provider-image behavior. Local markers, normalized types, dates, safe links, custom cards and preview summaries are already implemented. Provider icon/image loading is deliberately deferred; define its network and fallback contract before enabling it.

**Acceptance:** incremental node corrections/reorder, unchanged DOM/focus for stable keys, generation reset, unresolved references, blocked/absent URLs, nested interactive content, same-ID source correction, preview retirement, CSS-free output, keyboard/touch/RTL/forced colors, long and empty values. Raw HTML stays literal; data images remain outside the existing content URL policy. Custom rendering cannot implicitly fetch metadata or dispose content owners.

### D. Render state, events, actions and generative UI

**Evidence:** React `render/render-spec.tsx`, `types.ts`, `readiness.tsx`; shared `libs/content/src/render-state`; Angular `libs/render/src/public-api.ts`, `libs/render/src/lib/render-spec.component.ts`, `libs/render/src/lib/render-element.component.ts`, `libs/render/src/lib/signal-state-store.ts`, and `libs/render/src/lib/action-bindings.spec.ts`; Angular `chat-generative-ui` and `chat-tool-views` components. Action binding implementation lives in `render-element.component.ts`; there is no separate action-bindings implementation module. T24 has partial renderer work; T25 is still planned in the inventory.

The React renderer deliberately lacks owned/observed state-store integration, form binding writes, action/event dispatch, watcher effects, general catalog views and the chat generative-UI facade. `RenderViewProps.bindings` describes paths; it is not a write capability. Existing pure computed functions and readiness are already implemented.

- [ ] First specify an adapter from the existing shared render-state owner to React observation. Preserve immutable snapshot and subscription semantics, atomic writes, exact state paths, and caller ownership.
- [ ] Add explicit host-provided event/action intent with exact surface/element/message correlation. Separate user activation from render evaluation and separate acknowledged results from optimistic intent.
- [ ] Build controlled form bindings without resetting edited fields on streamed spec updates. Preserve per-surface isolation unless a shared store is supplied explicitly.
- [ ] Then add the generative UI/tool-view facade, normalization/fallback/skeleton and event routing. Compare Angular initial-state seeding and user-edit preservation carefully.
- [ ] Dogfood streamed corrections, pending readiness and real event routing in native fixtures, beyond the existing terminal trip recap.

**Acceptance:** hidden/removed/changed-type elements, stable repeated keys, unsupported/missing registrations, delayed readiness and Suspense, local form state across stream updates, shared versus isolated stores, stale events after retirement, async handler success/failure/cancellation, duplicate user activation, no effects during render/StrictMode, and exact cleanup.

Do not migrate the legacy schema DSL, implicit validators, automatic JSON Schema derivation or tool argument transformation wholesale. Current dispositions explicitly retain caller-owned validation. Raw render data stays plain finite acyclic data; executable callbacks belong in explicit host maps, never untrusted specs. Protocol execution policy remains outside a renderer.

### E. General A2UI surfaces and catalog ownership

**Evidence:** shared `libs/a2ui`, `libs/content/src/a2ui`; Angular `libs/chat/src/lib/a2ui`; existing `libs/cockpit-a2ui-react/src/{surface,views,form,actions,protocol}.ts*`; native `a2ui-message-content.ts`, `a2ui-trip-catalog.ts`, `trip-summary.tsx`; verifier `verify-a2ui-surfaces.mjs`. T27 remains planned; there is no React package `./a2ui` export at the audited main.

- [ ] Inventory existing cockpit React behavior and shared protocol/accumulator ownership before selecting code to reuse. A cockpit implementation is not automatically a package-quality public surface.
- [ ] Build a typed surface/catalog contract and fallback/readiness lifetime using shared accepted snapshots, then add catalog controls in coherent groups.
- [ ] Cover text/layout/card/button first, followed by actual form controls and complex modal/media/list/tab behavior according to supported protocol semantics. Record an explicit disposition for every deferred catalog capability.
- [ ] Preserve surface/catalog identity, data binding, user-edit ownership, action correlation, pending/partial schema behavior and deletion/remount semantics.
- [ ] Extend native fixtures from the authored trip catalog to supported general surfaces and actions without creating a duplicate A2UI parser or silently turning tool output into executable UI.

**Acceptance:** multi-surface isolation, corrections and out-of-order protocol data, rejected/unsupported catalogs, readiness transitions without form remount, exact action envelopes, stale surface actions, modal focus restoration, denied/failed media and cleanup, and no automatic form submission on render.

### F. Debug, checkpoint operations and navigation limits

**Evidence:** React `debug/types.ts`, `chat-debug.tsx`, `debug-state-diff.tsx`; native `loaded-checkpoint-timeline.tsx`, `use-loaded-conversation-search.tsx`, project and pinned-order controllers; Angular `libs/chat/debug/src/lib/compositions/chat-debug` and `chat-timeline-slider`.

Current Debug is passive and bounded to supplied checkpoint pages; historical-to-historical comparison, fork/replay and a live branch-tree view are not implemented. Current search is a palette over loaded conversation titles, not backend-wide search. Names/catalogs are browser-local, timestamps do not refresh live, and broader drag behavior remains partial.

- [ ] Build historical-to-historical comparison using explicit selected checkpoint tokens and independent app-owned reads, preserving empty/unknown/unavailable distinctions and existing display bounds.
- [ ] Implement paging and timeline/branch selection only against actual backend contracts; retain duplicate/missing checkpoint occurrence identity and stale-result protection.
- [ ] Treat fork/replay as new explicit command contracts with clear uncertain-outcome behavior, never an automatic consequence of inspection or selecting a slider.
- [ ] Reconcile remaining project catalog persistence/sharing, backend search, timestamp refresh and drag interaction gaps with actual Angular and backend support. Do not promise multi-client atomic deletion or server-wide search from a 50-row local directory.

**Acceptance:** owner/context/page replacement races, arbitrary row ordering, two concurrent inspectors, stale copy/read responses, bounded output and disclosed truncation, keyboard and mobile layouts, denied persistence, explicit retry after uncertain writes, preservation of draft/selection/route/running work, and zero requests for passive inspection UI changes.

### G. Session capabilities, package release and compatibility

**Evidence:** `libs/core/src/contracts/agent-session.ts`, core/content/React package manifests, `scripts/react-parity/package-policy.mjs`, `verify-boundaries.mjs`, `verify-packages.mjs`, `verify-angular-package.mjs`, `verify-release-versions.mjs`, `nx.json`, and publishing/provenance workflows.

Core `AgentSubmitInput` is currently `string`; AgentSession supplies submit, stop, optional read-only checkStatus, and dispose. It has no generic regeneration, attachment, fork/replay or rating persistence operation. Backend-specific capabilities may exist privately; inspect them before widening contracts. `content/testing` remains a reserved stub. Shared runtime/package/infrastructure task rows remain incomplete beyond the UI slices above.

- [ ] Reconcile **all** remaining T02–T21 and T31–T38 assignments by actual row and treatment, including native runtime ownership, backend capability seams, client tool coordination, testing utilities, telemetry, distribution, docs and compatibility. Task numbers alone do not identify implemented or missing behavior.
- [ ] Extend a framework-neutral capability only when its lifecycle, cancellation, unknown-outcome and backend support contracts are explicit. Preserve the existing text-only path and compatibility tests.
- [ ] Keep structural generic observation so backend-specific snapshots retain authored types. Do not flatten AG-UI evidence into fake core tool states.
- [ ] Keep React out of Angular/shared graphs and server-only code out of browser entries. Inspect emitted runtime **and declarations** from packed installed consumers.
- [ ] Define a separate public-release milestone covering real package versions/export maps, supported peers, declaration compatibility, licenses, release groups, atomic versioning, provenance and upgrade docs. Do not remove `private` or include staging packages in publish workflows merely to claim parity.
- [ ] Treat SSR/dehydration/hydration as a separately designed contract. ChatDebug's standalone deterministic markup does not mean `useAgent` or full chat is SSR supported.

**Acceptance:** clean consumer installs, package export resolution, browser-safe Node import checks, zero import-time network effects, readonly types and malformed-input type tests, supported React/Angular compatibility, no forbidden transitive imports, no accidental private backend exports, and reproducible release artifacts. Do not remove transition packages or compatibility guards without completing their replacement and upgrade path.

## 6. Required implementation and verification loop

For **every** milestone:

1. Name the missing observable behavior and compare it with its actual reference implementation. Record supported defaults, optional features, known limits and exact ownership. Define a smaller milestone when behavior spans unrelated subsystems.
2. Add a meaningful failing regression/contract test before the behavioral change; confirm the intended failure. Implement the smallest coherent solution, then verify it green. Do not add tests that merely repeat the implementation.
3. Run the relevant project's type tests, unit tests, lint and build. Add shared-owner tests when those contracts change. Review the whole diff, including generated files and new untracked source.
4. Extend installed-package type/runtime fixtures and the native example. Browser dogfood must exercise the feature through built packages, not only source aliases or mocked React components. Include both default and custom composition, CSS-free and styled behavior when the contract requires it.
5. Run the appropriate retained producers and independently inspect actual installed bytes, emitted declarations, locks, runtime graph and retained browser/lifecycle evidence. An exit code or a prior manifest alone is insufficient.
6. Run full relevant native/browser coverage with unchanged assertions and retries. Derive expected case totals from the current test suite; 45/104 are historical baselines, not permanent caps. A filtered test pass is not the full suite.
7. Perform a real native browser walkthrough; inspect screenshots; close only owned browser/server/backend processes; verify expected request counts and physical cleanup. Record failures honestly.
8. Regenerate the smallest relevant docs/API/context surface; update exact inventory facts and ownership reasons while preserving unrelated records. Then rerun source/package checks affected by those changes.
9. Request independent review, address substantive findings and verify them. Commit finished related work once, with no co-author metadata. Push and create a precise PR with actual commands/results and limitations.
10. Require all applicable exact-head checks and classic statuses green, including the unchanged Ubuntu two-worker React native job. Handle new main advances automatically without overwriting unrelated work. Reverify new integration code, never merge a previously tested different head.
11. Merge normally when green. Verify the merged tree contains the reviewed source and inspect fresh **main push** CI/security results for that merge revision.
12. Verify physical production deployments, live public API/narrative docs, complete production smoke and **both** promotion refs. Recheck main and refs at the end so a newer unrelated revision cannot be mistaken for the tested deployment.
13. Update the remaining gap assessment and continue. A green feature branch, merged PR, or production URL alone is not a completed milestone.

Record command, revision, result/counts, log/artifact location and any limitation. Do not reuse old green evidence after changing implementation, dependency inputs, build configuration or generated output. Re-run only surfaces made stale by the change; avoid repeatedly rebuilding everything without a reason.

## 7. Repository commands and verification entry points

Use the current project definitions and CI as authority. Set `workdir` on command tools. Use root npm/Nx; the examples below are separate commands, not a request to run every expensive producer concurrently. `NX_LOAD_DOT_ENV_FILES=false` prevents Nx from loading local dotenv files. Do not print the environment.

```sh
export NX_DAEMON=false
export NX_ISOLATE_PLUGINS=false
export NX_LOAD_DOT_ENV_FILES=false
export COREPACK_ENABLE_AUTO_PIN=0

npx nx test react --skip-nx-cache
npx nx run react:type-tests --skip-nx-cache
npx nx lint react
npx nx build react

# Run when the corresponding shared contracts change.
npx nx test content --skip-nx-cache
npx nx test core --skip-nx-cache

# Source ownership and package boundaries.
node scripts/react-parity/inventory.mjs --check
node scripts/react-parity/verify-boundaries.mjs
node --test scripts/react-parity/inventory.spec.mjs scripts/react-parity/package-policy.spec.mjs

# Installed native tests and application-specific helpers.
npx nx test native-conversation-react
npx nx run native-conversation-react:copy-test
npx nx run native-conversation-react:tooling-test
npx nx run native-conversation-react:provider-test
npx nx run native-conversation-react:summary-provider-test
npx nx build native-conversation-react --configuration=production

# Full local repository-default profile; no test filter or retry override.
npx nx e2e native-conversation-react --skipInstall

# CI's separate Ubuntu profile; it must pass on actual PR/main revisions.
npx nx e2e native-conversation-react --skipInstall --workers=2
```

The current native targets build/install their own packages where defined. Do not replace them with another runner. Native Angular regression coverage and provider tests are required when shared native/runtime code changes; read `.github/workflows/ci.yml` for exact prerequisites.

The current CI native prerequisite build is:

```sh
npx nx run-many -t build --projects=core,content,angular,react,chat,langgraph,ag-ui,render,a2ui,telemetry,middleware --configuration=production --parallel=2
```

Choose a new external evidence root; each retained producer requires a new, nonexistent output subdirectory. Inspect each script's current prerequisites first. `verify-packages` accepts `--retain` alone and prints its retained directory; do not invent a directory argument for it.

```sh
evidenceRoot=$(mktemp -d /private/tmp/threadplane-react-parity-XXXXXX)
node scripts/react-parity/verify-markdown.mjs --retain "$evidenceRoot/markdown"
node scripts/react-parity/verify-render-state.mjs --retain "$evidenceRoot/render-state"
node scripts/react-parity/verify-react-readiness.mjs --retain "$evidenceRoot/readiness"
node scripts/react-parity/verify-a2ui-surfaces.mjs --retain "$evidenceRoot/a2ui"
node scripts/react-parity/verify-langgraph-candidate.mjs --retain "$evidenceRoot/candidate"
node scripts/react-parity/verify-packages.mjs --retain
node scripts/react-parity/verify-boundaries.mjs --built
```

Additional integration checks live in `verify-ag-ui-candidate.mjs`, `verify-ag-ui-a2ui.mjs`, `verify-ag-ui-client-tools.mjs`, `verify-native-mastra.ts`, middleware verifiers, and Angular-package verification. Select them according to the touched behavior and current CI, not an assumption that the six commands above cover every backend.

For a fresh retained native production artifact, `node examples/chat/native/tooling/verify.mjs --review RETAINED_DIRECTORY` starts an owned review. Open its printed URL **once**; select A, inspect the restored heading/list/table, send exactly `Show the proof.`, inspect Verified response, click Refresh, select B and wait for Saved B. Close the browser and stop the owned review; require `Review fixture verified: 7/7 requests`. Use a fresh review process for another walkthrough. This baseline walkthrough complements the new feature's own interaction proof.

For docs/API changes, inspect and use the smallest applicable generator:

```sh
npm run generate-api-docs
npm run generate-api-docs:check
npm run generate-agent-context
```

Narrative/context generation is conditional on changed inputs; do not blindly regenerate the whole website. This contributor handoff itself is outside consumer docs/API inputs and does not require those generators.

## 8. Production release acceptance

Capture fresh workflow/job IDs and actual run attempts after merge. Inspect authoritative paginated jobs: a partially rerun workflow can legitimately retain a successful unaffected job from an earlier attempt. Bind it to the same run/head and latest selected job set; do not require every job's attempt number to equal the workflow's latest attempt, and do not accept a stale failed job just because another run is green.

- [ ] Full main CI, CodeQL and Scorecard pass on the actual merged revision; expected skips are explained by workflow scope, not treated as missing required native coverage.
- [ ] Website deployment, canonical example stamp, and AG-UI deployment have successful physical evidence. If unchanged content legitimately reuses a deployment, prove the workflow's actual reuse condition and deployed source identity; do not infer reuse from an HTTP 200.
- [ ] Live affected API and guide pages contain the new signature/behavior and expected docs revision. Check both changes and unchanged neighboring contracts; do not merely search for a component name.
- [ ] Production smoke runs completely with no hidden skips, flakes or filtered omissions; inspect its promotion-recording step.
- [ ] `heads/main`, `deploy/last-promoted` and `deploy/ag-ui-demo-last-promoted` identify the reviewed deployed revision. If main advances, explicitly reassess the new tree and verification coverage before closing the milestone.

Useful read-only starting commands:

```sh
gh pr view 1500 --repo cacheplane/threadplane --json state,headRefOid,mergeCommit,statusCheckRollup
gh run list --repo cacheplane/threadplane --branch main --limit 20
gh api repos/cacheplane/threadplane/git/ref/heads/main
gh api repos/cacheplane/threadplane/git/ref/deploy/last-promoted
gh api repos/cacheplane/threadplane/git/ref/deploy/ag-ui-demo-last-promoted
```

Re-read current production workflow definitions and smoke configuration to obtain actual URLs and case expectations. Never promote an unverified revision manually just to align the refs.

## 9. Safety and continuation details

- **Never read or display local secrets.** The general Railway token is still pending from the user at this snapshot. Do not probe/sync an old token or confuse `AG_UI_INTERNAL_TOKEN` with a Railway deployment token. `AG_UI_DEMO_RAILWAY_TOKEN` is a separate credential; leave it untouched. If the user later confirms a replacement, sync only the explicitly selected key through gh stdin without outputting its value. Do not dump `.env`, environment variables, hashes, token suffixes, or deployment logs that can expose credentials.
- **Never inspect, enumerate, stage, modify, or delete repository root `output/`.** Broad Git reads must carry `-- . ':(exclude)output' ':(exclude)output/**'`; broad file discovery must also explicitly exclude `output` and `output/**`. Stage exact reviewed files. Place new evidence outside the repository in an owned temporary directory. Inventory baseline writing currently has broad provenance Git reads: constrain those safely before using `--write-baseline`, rather than allowing it to enumerate the protected directory. Read-only inventory `--check` uses declared scoped roots.
- Preserve current user worktrees, branches, stashes and unrelated changes. Do not reset, force-push, delete branches, cancel other people's runs, or broaden token access to make progress.
- Use one heavy local build/browser producer at a time when shared output or resource contention is possible. Parallelize independent reads and advisory review, not colliding Nx builds or package output mutations.
- The pending feature worktree is `/private/tmp/react-message-action-icons`. Its commit is already made. **Do not run its old precommit freeze guards/readers after commit**: they deliberately require the original base HEAD. Compare committed blobs with sealed hashes instead. Any later edits need a new current-source verification identity.

Optional local continuity artifacts, if still present: `/private/tmp/react-message-action-icons-state.json`, `/private/tmp/react-message-action-icons-committed-source-proof.json`, `/private/tmp/react-message-action-icons-full-native-default-proof-r2.json`, `/private/tmp/react-message-action-icons-root-native-default-proof-r2.json`, `/private/tmp/react-message-action-icons-manual-proof-r2.json` and the prefix's source-ready/source-freeze R2 manifests. Other filenames share the `/private/tmp/react-message-action-icons-` prefix. Reviewed release helpers include `watch-pr.py`, `watch-merged-main.py`, `capture-release-jobs.py`, `production-docs-smoke.py`, `capture-production-smoke.py`, and `release-audit.py`. Read their contracts first: they are pinned to PR #1500's source identity and are not reusable generic proofs for later milestones. Temporary files may disappear; all essential continuation instructions are in this handoff and the repository.

## 10. Definition of done

For a milestone, “done” means implemented behavior, meaningful tests, installed native dogfood, reviewed current-source artifacts, accurate docs/inventory, a normally merged green PR, and verified merged-main production/docs/smoke/promotion refs. Disclose unresolved environment failures beside the claims they limit.

For React parity as a whole, reconcile every in-scope behavior and ownership disposition against implemented/tested contracts, complete supported capability and package release gates, and retain explicit justified Angular-only/internal/excluded boundaries. No percentage, a green inventory check, an example screenshot, or the number of merged UI PRs can substitute for that reconciliation.

**Immediate receiving-agent action:** Re-fetch main, diagnose and close PR #1500's abandoned-matrix release blocker without bypassing checks, verify its eventual merged release, then build the next remaining gap. Keep executing this loop until the remaining supported scope is complete or a specific user decision/access blocker requires a question.
