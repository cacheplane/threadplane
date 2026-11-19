# Thread sidebar for React and Angular — design

Date: 2026-11-16. Status: approved 2026-11-17.

## Intent

A React or Angular app that connects to LangGraph should get a working conversation sidebar without writing a data layer: the conversations listed, and new chat, rename, delete, archive, pin, reorder and move-to-project working against the server. Apps must still be able to restyle it, replace pieces of it, add their own sections and actions, and point it at a backend other than LangGraph.

Why now: the React parity survey (2026-11-15) found that Angular has an SDK-backed thread store (`LangGraphThreadsAdapter`) and React has none. The only React directory is the example app's own `examples/chat/native/shared/directory.ts`. Brian chose to close this by shipping a sidebar in both frameworks rather than a React-only port.

## Goals

- One framework-neutral thread store contract, `ThreadDirectory`, that both frameworks' sidebars read.
- A LangGraph implementation of it, `createLangGraphThreadDirectory`, shipped beside `createSession`.
- A connected sidebar in each framework that takes a directory and works with no other wiring:
  - React: `ThreadSidebar` in `@threadplane/react/chat`.
  - Angular: `<chat-thread-sidebar>` in `@threadplane/chat`.
- The list refreshes after a run ends, when the app asks it to, and after each action.
- Customization without forking. Apps can:
  - replace how a row looks;
  - add sections above or below the built-in ones;
  - add menu actions;
  - turn built-in features off (projects, archive, pin, reorder, delete);
  - supply their own `ThreadDirectory`.
- Angular's `LangGraphThreadsAdapter` keeps working. It is rebuilt on the shared store once the Angular package exports core (phase 2), so the metadata rules end up in one place.
- Project names are stored on the LangGraph server through the Store API, so they follow the user across devices.

## Non-goals

- Thread storage for AG-UI. AG-UI has no thread API; AG-UI apps supply their own directory.
- Server-side search, pagination beyond the first page, or infinite scroll. The first slice keeps Angular's `limit: 50`. Paging is a follow-up.
- Multi-user sharing, permissions, or thread ownership.
- New visual design. The sidebars reuse today's thread list, project list and sidenav styling and tokens.

## Anti-goals (a failure even if it works)

- Two copies of the metadata rules (title, archived, pinned, pin order, project) that can drift between frameworks.
- A sidebar that only works for LangGraph. The UI must depend on the contract, not the SDK.
- Breaking existing Angular apps that use `LangGraphThreadsAdapter`, `<chat-sidenav>` inputs or `ThreadActionAdapter`.
- Silent failures. Angular's adapter logs and swallows refresh errors; the shared store must expose a load error the sidebar can show, and action errors must roll back the optimistic change visibly.

## What exists today

- **Angular data:** `libs/langgraph/src/lib/threads/threads-adapter.ts`, the `LangGraphThreadsAdapter` DI service. It wraps `client.threads` and stores state in thread `metadata`:
  - `title`, falling back to a configurable label;
  - `archived`, `pinned` and `pinnedOrder`;
  - `projectId`.
  It publishes `threads` (active, pinned first by `pinnedOrder`) and `archivedThreads` signals. Every mutation refreshes the whole list. Apps wire its methods to `ThreadActionAdapter` by hand, and `refreshOnRunEnd(agent, fn)` refreshes after a run.
- **Angular UI:** `<chat-sidenav>` takes `threads`, `archivedThreads`, `actions`, `projects`, `projectActions`, `activeThreadId`, `selectedProjectId` and emits `newChat`, `threadSelected`, `projectSelected`. It has named content slots (`sidenavHeader`, `sidenavPrimary`, `sidenavSections`, footer, account). `<chat [threads]>` also draws a thread list.
- **React UI:**
  - `ThreadList` and `ProjectList` take items plus `ThreadActionAdapter` / `ProjectActionAdapter` and handle optimistic rows.
  - `ChatSidenav` is a children shell.
  - Two open PRs from another session: `ChatSidenavSections` (cacheplane/threadplane#1621) composes new chat, projects, recent and archived; a `threads` prop on `Chat` (#1622).
- **Projects:** neither LangGraph nor the Angular adapter stores project names. Threads carry `metadata.projectId` only. The example keeps project names in `localStorage`.
- **Packaging:** `@threadplane/react`, `core` and `content` are private, and `core` will not be published as its own package. The published Angular packages will export the core contract later in the React parity roadmap; until then `@threadplane/chat` cannot depend on core, and `@threadplane/langgraph` imports only types from its private runtime.

## Approaches considered

1. **Shared store, thin sidebar per framework (chosen by Brian).** A neutral `ThreadDirectory` contract, one LangGraph implementation, and a connected sidebar in each framework that binds to it. Angular's adapter is rebuilt on the store. Most up-front work, one set of rules.
2. **Separate implementation per framework.** Keep Angular's adapter; write a React twin. Faster, but the metadata rules are duplicated and will drift.
3. **UI only.** Connected sidebars over a directory interface, with no LangGraph implementation shipped. Least work, but apps still write the data layer, which defeats the goal.

## Delivery in two phases

Brian decided that `@threadplane/core` is not published on its own; the Angular packages export it at a later point in the parity roadmap. That decides the order.

**Phase 1 (this work).**
- The `ThreadDirectory` contract in core, `createLangGraphThreadDirectory` in the private LangGraph runtime, and the React `ThreadSidebar` on top of them.
- The Angular `<chat-thread-sidebar>` in `@threadplane/chat`, reading a structurally identical contract declared inside `@threadplane/chat`.
- `LangGraphThreadsAdapter` implements that Angular contract with its existing code, and gains the LangGraph Store project store.

**Phase 2 (when the Angular packages export core).**
- The Angular contract becomes a re-export of the core one.
- `LangGraphThreadsAdapter` is rebuilt on `createLangGraphThreadDirectory`, and the second copy of the metadata rules is deleted.

Phase 1 holds two copies of the metadata rules for a while, which is the drift the anti-goals warn about. Two guards keep them identical until phase 2:
- a type-level spec that asserts the core and Angular contracts are mutually assignable;
- one conformance suite of specs, run against both LangGraph implementations with the same fake SDK client, covering ordering, metadata keys, title fallback, archive, pin order, project moves and failure rollback.

Item 12 (publishing the neutral runtime) moves to that later roadmap point and is not part of this work.

## Design

### The contract (core)

`ThreadDirectory` lives in `@threadplane/core` beside `AgentSession`, framework-neutral and backend-neutral:

```ts
interface ThreadDirectorySnapshot {
  readonly threads: readonly ThreadEntry[];   // active, pinned first in pin order, then most recent
  readonly archived: readonly ThreadEntry[];
  readonly projects?: readonly ProjectEntry[]; // absent when the directory has no project store
  readonly status: 'idle' | 'loading' | 'error';
  readonly error?: AgentError;                 // last load failure, cleared by a successful refresh
}
interface ThreadEntry {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly projectId?: string | null;
}
interface ProjectEntry { readonly id: string; readonly name: string }

interface ThreadDirectory {
  getSnapshot(): ThreadDirectorySnapshot;
  subscribe(notify: () => void): () => void;
  refresh(options?: { signal?: AbortSignal }): Promise<void>;
  create?(options?: { metadata?: PlainRecord; signal?: AbortSignal }): Promise<{ id: string }>;
  rename?(id: string, title: string): Promise<void>;
  remove?(id: string): Promise<void>;
  setArchived?(id: string, archived: boolean): Promise<void>;
  setPinned?(id: string, pinned: boolean): Promise<void>;
  reorderPinned?(id: string, beforeId: string | null): Promise<void>;
  setProject?(id: string, projectId: string | null): Promise<void>;
  createProject?(name: string): Promise<{ id: string }>;
  renameProject?(id: string, name: string): Promise<void>;
  removeProject?(id: string): Promise<void>;
  dispose(): void;
}
```

The shape follows `AgentSession`: a snapshot, change notification, and optional capabilities whose absence hides the matching UI. Snapshots are frozen and keep unchanged entries by reference.

A helper, `refreshOnRunEnd(directory, session)`, watches a core `AgentSession` and refreshes when a run leaves `running`. Both sidebars call it when given a session.

### The LangGraph implementation (runtime)

`createLangGraphThreadDirectory({ apiUrl | client, titleFallback?, projects? })` sits next to `createSession` in the LangGraph runtime.

- It reads and writes the same metadata keys as today's Angular adapter (`title`, `archived`, `pinned`, `pinnedOrder`, `projectId`), so existing threads show correctly in both frameworks.
- It brings the example directory's safety rules into the library:
  - same-origin checks for browser use;
  - no SDK retries for mutations;
  - error bodies never read;
  - abortable requests;
  - a missing thread on `getThread` reported as missing, not as an error.
- Mutations are optimistic in the store and roll back on failure. After a successful mutation the store refreshes.
- `projects` is a pluggable project store. The default stores project names with the LangGraph Store API (`client.store`) under a namespace such as `["threadplane", "projects"]`, one item per project with key = project id and value `{ name }`. Apps can pass their own store, or `projects: false` to turn projects off.
- Removing a project moves its threads out of it (`projectId: null`) before the project item is deleted, so no thread points at a missing project.

In phase 1, Angular's `LangGraphThreadsAdapter` keeps its own implementation and adds the same project store, `status`/`error` signals and the Angular `ThreadDirectory` shape. In phase 2 it becomes a thin Angular wrapper: it creates the shared directory, exposes `threads` and `archivedThreads` as signals from snapshots, and keeps every public method and signal it has today.

### React sidebar

`ThreadSidebar` in `@threadplane/react/chat`:

```tsx
<ThreadSidebar
  directory={directory}
  session={session}              // optional: refresh after each run
  activeThreadId={threadId}
  onSelect={selectThread}
  onNewChat={startThread}         // optional: default calls directory.create
  features={{ projects: false }}  // optional: turn built-ins off
  renderThread={…}                // optional: row override
  extraActions={…}                // optional: added menu actions
  before={…} after={…}            // optional: app sections
/>
```

It composes the existing `ThreadList`, `ProjectList` and (once merged) `ChatSidenavSections`. It derives the action adapters from the directory's capabilities, so a directory without `remove` shows no Delete item. It shows loading, empty and error states, with Retry calling `refresh`. It renders inside `ChatSidenav` or standalone.

### Angular sidebar

`<chat-thread-sidebar [directory] [agent] [activeThreadId] (threadSelected) (newChat)>` in `@threadplane/chat` mirrors the React props. In phase 1, `directory` takes the Angular-side contract, which `LangGraphThreadsAdapter` implements:

- `features` turns built-ins off;
- `ng-template` slots override rows;
- content projection carries before and after sections;
- an `extraActions` input adds menu items.

It composes `<chat-sidenav>`'s existing sections, so `<chat-sidenav>` itself does not change. Given an `agent`, it refreshes after each run.

### Customization levels

1. Props and inputs: features on or off, labels, the active thread.
2. Slots: row rendering, sections before and after, extra actions.
3. Bring your own directory: any object that meets `ThreadDirectory`, for AG-UI or a custom API.
4. Go lower: the existing `ThreadList`, `ProjectList` and `ChatSidenav` pieces stay public for apps that want full control.

## Constraints

- Follow repo rules:
  - React parity dispositions, written as text;
  - the export allowlists in `verify-packages`;
  - runtime candidate module counts;
  - no committed `baseline.json` or API content;
  - no contractions in docs prose.
- No breaking change to existing Angular APIs. If one becomes unavoidable, it waits for a minor release per the release-versioning rule.
- The LangGraph directory must pass the same installed-package proofs as `createSession` (`verify-langgraph-candidate`).
- Optimistic UI already exists in both thread lists. The store must not fight it: the lists keep their own optimistic overrides, and the store refresh is the source of truth.

## Calls made while writing this (marked so they can be checked)

- **Same-origin checks are opt-in.** The factory enforces the example's same-origin rule only when given a `browserOrigin`. An injected SDK `client`, cross-origin LangGraph Platform URLs, `LANGGRAPH_CLIENT`, `LANGGRAPH_CLIENT_OPTIONS` (`defaultHeaders`) and the operation reporter keep working, so existing Angular apps do not break.
- **Phase 1 keeps a second copy of the contract and rules inside the Angular packages,** guarded by the type-level spec and the shared conformance suite, rather than holding the Angular sidebar back until phase 2.
- **Each framework watches its own run end.** The Angular sidebar's `agent` input takes the signals-based `Agent` from `@threadplane/chat` and uses the existing `refreshOnRunEnd`. The React sidebar takes a core `AgentSession`. A small neutral helper for `AgentSession` lives beside the directory.
- **The Angular adapter's behaviour does not change.** `refresh()` still logs and resolves, `create()` still returns `null` on failure, and failed mutations still rethrow sanitised errors. Load errors are exposed additively, through a new `status`/`error` signal and the snapshot. Nothing existing starts throwing, so this ships as a patch.
- **The React sidebar does not wait on #1621 or #1622.** It builds on the existing `ThreadList` and `ProjectList`, and adopts `ChatSidenavSections` once that merges.

## Decided by Brian

1. **Packaging.** `@threadplane/core` is not published on its own. The Angular packages will export it later in the parity roadmap, so the work ships in the two phases above, and item 12 is deferred to that point.
2. **Project names** live in the LangGraph Store API, with the option to pass your own project store.

## Left to the builder

- Exact prop and input names, as long as React and Angular match.
- Whether `refreshOnRunEnd` for directories lives in core or in each binding.
- How the store merges a refresh with in-flight optimistic changes.
- The test matrix:
  - contract specs run against the LangGraph directory and a fake;
  - sidebar specs in both frameworks;
  - one e2e per framework against the cockpit LangGraph backend.
