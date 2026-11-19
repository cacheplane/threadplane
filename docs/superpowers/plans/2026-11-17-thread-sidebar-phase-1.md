# Thread Sidebar (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a connected, customizable conversation sidebar in React and Angular, backed by a LangGraph thread store, with project names in the LangGraph Store API.

**Architecture:** A framework-neutral `ThreadDirectory` contract in `@threadplane/core` and its LangGraph implementation in the private LangGraph runtime feed a React `ThreadSidebar`. Angular gets a structurally identical contract inside `@threadplane/chat`, implemented by a `directory` view on `LangGraphThreadsAdapter`, and a `<chat-thread-sidebar>`. One conformance suite runs against both LangGraph implementations, and a type-level spec pins the two contracts together until phase 2 merges them.

**Tech Stack:** TypeScript, React 19, Angular 20+ signals, `@langchain/langgraph-sdk` 1.10 (`client.threads`, `client.store`), Vitest, Playwright, Nx.

**Spec:** `docs/superpowers/specs/2026-11-16-thread-sidebar-design.md`

## Global Constraints

- `@threadplane/core` stays private and is not published. Published `@threadplane/chat` and `@threadplane/langgraph` (Angular entry) must not import `@threadplane/core` or anything under `libs/langgraph/src/runtime` at runtime. Type-only imports from runtime inside `libs/langgraph/src/lib` already exist and are allowed; values are not.
- Metadata keys are exactly `title`, `archived`, `pinned`, `pinnedOrder`, `projectId` (unchanged from today's Angular adapter).
- Thread list reads `client.threads.search({ limit: 50, offset: 0 })`. No paging.
- Project store namespace: `['threadplane', 'projects']`; one item per project, key = project id, value `{ name: string }`.
- No change to existing public Angular signatures (`LangGraphThreadsAdapter` methods/signals, `<chat-sidenav>` inputs, `Thread`, `ThreadActionAdapter`). Additions only; ships as a patch.
- `LangGraphThreadsAdapter.refresh()` keeps logging and resolving on failure; `create()` keeps returning `null` on failure.
- New runtime public API is re-exported from `libs/langgraph/src/runtime/create-session.ts` (the candidate's only entry). Runtime files may import only `@threadplane/core`, `@threadplane/core/tools`, `@langchain/langgraph-sdk`.
- SDK mutations use `maxRetries: 0`. Error bodies are never read. Failures surface as `createSafeRequestError()` (`runtime/operation-errors.ts:72`) / the Angular adapter's existing `safeError`.
- Same-origin enforcement only when `browserOrigin` is passed, using the rule in `examples/chat/native/shared/directory.ts:27-36`.
- Never commit `scripts/react-parity/baseline.json`, `apps/website/content/api`, or `package-version.ts` rewrites. Append `dispositions.json` rows as text; never re-serialize it.
- Docs prose: no contractions. Run `npx vitest run` in `apps/website` for docs edits.
- Use `NX_DAEMON=false` for Nx commands. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A refresh that resolves while a mutation is pending** must not undo the optimistic change on screen. Test in Task 2 (`keeps a pending rename across a refresh that started earlier`).
2. **A LangGraph server without the Store API** (404 on `/store/items/search`) must still list threads; projects become `[]` and project actions reject. Test in Task 3 (`lists threads when the project store is unavailable`).
3. **Removing the active thread** must tell the app, not leave a dangling selection. Tests in Tasks 6 and 7 (`reports the active thread removed`).
4. **Malformed metadata** (blank title, string `pinnedOrder`, `projectId: ''`) must render with fallbacks, never throw. Conformance case in Task 2 (`projects malformed metadata with fallbacks`).
5. **Disposal mid-request** must not notify or write after `dispose()`. Conformance case in Task 2 (`does not notify after dispose`).

---

## File Structure

| File | Responsibility |
|---|---|
| `libs/core/src/contracts/thread-directory.ts` (create) | `ThreadDirectory` contract types and `refreshDirectoryOnRunEnd` |
| `libs/core/src/index.ts` (modify) | export the above |
| `libs/langgraph/src/runtime/thread-directory.ts` (create) | `createLangGraphThreadDirectory`: list, mutations, optimistic patches, errors |
| `libs/langgraph/src/runtime/thread-metadata.ts` (create) | pure metadata projection + ordering shared by runtime directory |
| `libs/langgraph/src/runtime/project-store.ts` (create) | `ProjectStore` contract and `createLangGraphProjectStore` |
| `libs/langgraph/src/runtime/testing/fake-threads-client.ts` (create) | in-memory fake of `client.threads` + `client.store` |
| `libs/langgraph/src/runtime/testing/thread-directory-conformance.ts` (create) | shared Vitest suite for any `ThreadDirectory` |
| `libs/chat/src/lib/thread-directory/thread-directory.ts` (create) | Angular-side copy of the contract |
| `libs/langgraph/src/lib/threads/thread-directory-contract.type-spec.ts` (create) | mutual-assignability check, core ↔ chat |
| `libs/langgraph/src/lib/threads/threads-adapter.ts` (modify) | `directory` view, `status`/`error` signals, project store |
| `libs/react/src/chat/thread-sidebar.tsx` (create) | React connected sidebar |
| `libs/chat/src/lib/compositions/chat-thread-sidebar/chat-thread-sidebar.component.ts` (create) | Angular connected sidebar |

---

### Task 1: Core `ThreadDirectory` contract and run-end helper

**Files:**
- Create: `libs/core/src/contracts/thread-directory.ts`
- Modify: `libs/core/src/index.ts`
- Test: `libs/core/src/contracts/thread-directory.spec.ts`

**Interfaces:**
- Produces (exported from `@threadplane/core`):
```ts
export type ThreadDirectoryStatus = 'idle' | 'loading' | 'error';
export interface ThreadEntry { readonly id: string; readonly title: string; readonly updatedAt?: number;
  readonly pinned: boolean; readonly archived: boolean; readonly projectId: string | null; }
export interface ProjectEntry { readonly id: string; readonly name: string; }
export interface ThreadDirectorySnapshot { readonly threads: readonly ThreadEntry[]; readonly archived: readonly ThreadEntry[];
  readonly projects?: readonly ProjectEntry[]; readonly status: ThreadDirectoryStatus; readonly error?: AgentError; }
export interface ThreadDirectory {
  getSnapshot(): ThreadDirectorySnapshot; subscribe(notify: () => void): () => void;
  refresh(options?: { readonly signal?: AbortSignal }): Promise<void>;
  create?(options?: { readonly metadata?: { readonly [key: string]: PlainValue }; readonly signal?: AbortSignal }): Promise<{ readonly id: string }>;
  rename?(id: string, title: string): Promise<void>; remove?(id: string): Promise<void>;
  setArchived?(id: string, archived: boolean): Promise<void>; setPinned?(id: string, pinned: boolean): Promise<void>;
  reorderPinned?(id: string, beforeId: string | null): Promise<void>; setProject?(id: string, projectId: string | null): Promise<void>;
  createProject?(name: string): Promise<{ readonly id: string }>; renameProject?(id: string, name: string): Promise<void>;
  removeProject?(id: string): Promise<void>; dispose(): void;
}
export function refreshDirectoryOnRunEnd(directory: Pick<ThreadDirectory, 'refresh'>,
  session: Pick<AgentSession, 'getSnapshot' | 'subscribe'>): () => void;
```
(`title` is always a string — the implementation applies the fallback — so views never branch on it.)

- [ ] **Step 1: Write failing tests** in `thread-directory.spec.ts`:
  - `refreshes once when the session leaves running`: fake session (use `createFakeAgentSession` from `../testing`) goes `idle → running → idle`; `refresh` spy called exactly 1 time.
  - `refreshes after a run that ends in error`: `running → error` → 1 call.
  - `does not refresh on idle → idle notifications`: 0 calls.
  - `stops after release`: call the returned release, then `running → idle` → 0 calls.
- [ ] **Step 2:** `NX_DAEMON=false npx nx test core` → FAIL (module not found).
- [ ] **Step 3: Implement** the types and `refreshDirectoryOnRunEnd` (subscribe, remember the last status, call `void directory.refresh()` on a transition out of `'running'`); export all from `src/index.ts`.
- [ ] **Step 4:** `NX_DAEMON=false npx nx run-many -t test lint type-tests -p core` → PASS.
- [ ] **Step 5: Commit** `feat(core): add the ThreadDirectory contract`.

---

### Task 2: LangGraph runtime directory and the conformance suite

**Files:**
- Create: `libs/langgraph/src/runtime/thread-metadata.ts`, `thread-directory.ts`, `testing/fake-threads-client.ts`, `testing/thread-directory-conformance.ts`
- Modify: `libs/langgraph/src/runtime/create-session.ts` (re-export)
- Test: `libs/langgraph/src/runtime/thread-directory.spec.ts`, `thread-metadata.spec.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
```ts
// thread-metadata.ts
export function projectThread(raw: { thread_id: string; updated_at?: string; metadata?: unknown },
  titleFallback: string): ThreadEntry & { readonly pinnedOrder?: number };
export function orderThreads(entries: readonly (ThreadEntry & { pinnedOrder?: number })[]):
  { threads: ThreadEntry[]; archived: ThreadEntry[] };
// thread-directory.ts
export interface LangGraphThreadDirectoryOptions {
  readonly apiUrl?: string; readonly client?: LangGraphThreadsClient; readonly clientOptions?: LangGraphClientOptions;
  readonly browserOrigin?: string; readonly titleFallback?: string; // default 'New chat'
  readonly projects?: ProjectStore | false; // default: createLangGraphProjectStore(client) (Task 3)
}
export type LangGraphThreadsClient = Pick<Client, 'threads' | 'store'>;
export function createLangGraphThreadDirectory(options: LangGraphThreadDirectoryOptions): ThreadDirectory;
// testing/fake-threads-client.ts
export function createFakeThreadsClient(seed?: readonly FakeThread[]): LangGraphThreadsClient & {
  readonly calls: readonly string[]; failNext(method: string, status: number): void; hold(method: string): () => void; };
// testing/thread-directory-conformance.ts
export function describeThreadDirectoryConformance(name: string,
  make: (client: LangGraphThreadsClient) => { directory: ThreadDirectory; teardown?(): void }): void;
```
- `projectThread` rules (copy of `examples/chat/native/shared/projection.ts:4-22` and the Angular adapter): trimmed non-empty string `title` else fallback; `archived`/`pinned` only `=== true`; `pinnedOrder` only finite number; `projectId` non-blank string else `null`; `updatedAt = Date.parse(updated_at)` when finite.
- `orderThreads`: active threads pinned first by `pinnedOrder` ascending (missing order last, then `updatedAt` desc), then unpinned by `updatedAt` desc; archived by `updatedAt` desc. Match `threads-adapter.ts` today; if they differ, the adapter's current order wins.

- [ ] **Step 1: Write the conformance suite** with these cases (each builds a fresh fake client and calls `make`):
  - `lists active and archived threads in pin order` — seed 4 threads (two pinned with `pinnedOrder` 1 and 0, one archived); after `refresh()`, `threads.map(t => t.id)` equals the pinned-0, pinned-1, then newest unpinned; `archived` has the archived one; `status === 'idle'`.
  - `projects malformed metadata with fallbacks` — `{ title: '  ', pinnedOrder: '2', projectId: '', archived: 'yes' }` → `title === 'New chat'`, `pinned === false`, `archived === false`, `projectId === null`.
  - `exposes a load error and clears it on success` — `failNext('threads.search', 500)`; `refresh()` resolves; `status === 'error'`, `error.kind === 'server'`, `error.recovery === 'retry'`; second `refresh()` → `status === 'idle'`, `error === undefined`.
  - `renames optimistically and confirms with a refresh` — `hold('threads.update')`; call `rename('a', 'Trip')`; snapshot shows `Trip` before release; after release, `calls` includes a later `threads.search`.
  - `rolls back a failed rename and rejects` — `failNext('threads.update', 500)`; `rename` rejects with an `Error` whose message is `'The LangGraph request failed.'`; title is the original.
  - `keeps a pending rename across a refresh that started earlier` — start `refresh()` with `threads.search` held, call `rename('a','Trip')` with update held, release search: title still `Trip`.
  - `archives, pins and reorders with the existing metadata keys` — after `setArchived('a', true)`, `setPinned('b', true)`, `reorderPinned('c', 'b')`, the fake's stored metadata has `archived: true`, `pinned: true`, and `pinnedOrder` 0..n in the new order.
  - `removes a thread` — `remove('a')` → gone from snapshot and from the fake.
  - `creates a thread with metadata` — `create({ metadata: { projectId: 'p1' } })` resolves `{ id }` present in the next snapshot with `projectId === 'p1'`.
  - `does not notify after dispose` — subscribe a spy, hold search, `refresh()`, `dispose()`, release → spy not called after dispose.
- [ ] **Step 2: Write `thread-directory.spec.ts`** that calls `describeThreadDirectoryConformance('runtime', client => ({ directory: createLangGraphThreadDirectory({ client, projects: false }) }))`, plus:
  - `rejects a cross-origin apiUrl when browserOrigin is set` — `apiUrl: 'https://other.test'`, `browserOrigin: 'https://app.test'` → throws `'Directory requires an absolute same-origin API base'`.
  - `accepts a cross-origin apiUrl without browserOrigin`.
  And `thread-metadata.spec.ts` for the projection rules above.
- [ ] **Step 3:** `NX_DAEMON=false npx nx runtime-quality langgraph` → FAIL.
- [ ] **Step 4: Implement.** Build the client with the existing `createLangGraphClient(apiUrl, { ...clientOptions, maxRetries: 0 })` when no `client` is given. Keep a map of pending optimistic patches keyed by thread id; each refresh applies remaining patches over the server list; a patch is removed when its mutation settles. Map load failures to `AgentError` via the existing `projectLangGraphOperationFailure`; reject mutations with `createSafeRequestError()`. Freeze snapshots and keep unchanged entries by reference. Re-export `createLangGraphThreadDirectory`, `LangGraphThreadDirectoryOptions`, `LangGraphThreadsClient` from `create-session.ts`.
- [ ] **Step 5:** `NX_DAEMON=false npx nx run-many -t runtime-quality runtime-type-tests lint -p langgraph` → PASS. Then `TMPDIR=$(cd "$TMPDIR" && pwd -P) node scripts/react-parity/verify-langgraph-candidate.mjs` → PASS (the new files are reached from the entry and import only allowed specifiers).
- [ ] **Step 6: Commit** `feat(langgraph): add a framework-neutral LangGraph thread directory`.

---

### Task 3: LangGraph Store project store

**Files:**
- Create: `libs/langgraph/src/runtime/project-store.ts`
- Modify: `thread-directory.ts`, `testing/fake-threads-client.ts` (store methods), `testing/thread-directory-conformance.ts`, `create-session.ts`
- Test: `libs/langgraph/src/runtime/project-store.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface ProjectStore {
  list(signal?: AbortSignal): Promise<readonly ProjectEntry[]>;
  create(name: string): Promise<{ readonly id: string }>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export function createLangGraphProjectStore(client: Pick<Client, 'store'>,
  options?: { readonly namespace?: readonly string[] }): ProjectStore; // default ['threadplane','projects']
```
- `list` uses `store.searchItems(namespace, { limit: 100 })`, sorted by name (locale compare). `create` uses `crypto.randomUUID()` for the key and `putItem(namespace, id, { name })`. Names are trimmed; blank names reject with `Error('Project name is required')`.
- Directory: `projects` in the snapshot is the store list (absent when `projects: false`). `removeProject(id)` first `setProject(t, null)` for each thread with that project, then `store.remove(id)`.

- [ ] **Step 1: Failing tests** in `project-store.spec.ts`: `creates, lists, renames and removes under the default namespace` (fake records `putItem` namespace `['threadplane','projects']`, value `{ name: 'Trips' }`); `rejects a blank name`. Add conformance cases (run only when the subject has projects): `moves threads out of a removed project` (thread with `projectId: 'p1'` → `null`, then project gone); `lists threads when the project store is unavailable` (`failNext('store.searchItems', 404)` → `status === 'idle'`, `projects` equals `[]`, `createProject` rejects).
- [ ] **Step 2:** run `runtime-quality` → FAIL.
- [ ] **Step 3: Implement**; directory loads threads and projects in parallel and a project failure never sets `status: 'error'`.
- [ ] **Step 4:** `NX_DAEMON=false npx nx run-many -t runtime-quality runtime-type-tests lint -p langgraph` and `verify-langgraph-candidate.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(langgraph): store project names with the LangGraph Store API`.

---

### Task 4: Angular contract in `@threadplane/chat` and the contract type spec

**Files:**
- Create: `libs/chat/src/lib/thread-directory/thread-directory.ts`
- Modify: `libs/chat/src/public-api.ts`
- Test: `libs/langgraph/src/lib/threads/thread-directory-contract.type-spec.ts`

**Interfaces:**
- Produces (exported from `@threadplane/chat`, types only): `ThreadDirectory`, `ThreadDirectorySnapshot`, `ThreadDirectoryStatus`, `ThreadEntry`, `ProjectEntry`, `ThreadDirectoryError` — field-for-field copies of Task 1. `ThreadDirectoryError` copies `AgentError` (`kind: 'connection'|'auth'|'server'|'interrupted'|'aborted'; message; status?; retryable; recovery?: 'retry'|'check'|'none'; detail?`). The `create` metadata type is `{ readonly [key: string]: unknown }`. Header comment: "Phase 1 copy of `ThreadDirectory` from `@threadplane/core`; replaced by a re-export when the Angular packages export core."

- [ ] **Step 1: Write the type spec** with `type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;` and `const _x: Equal<Core.ThreadEntry, Chat.ThreadEntry> = true;` for `ThreadEntry`, `ProjectEntry`, `ThreadDirectoryStatus`, `ThreadDirectorySnapshot`, and mutual assignability (`A extends B` and `B extends A`) for `ThreadDirectory` (metadata types differ only in `PlainValue` vs `unknown`, which assignability tolerates in the core → chat direction; assert `Core.ThreadDirectory extends Chat.ThreadDirectory` and `Equal` on every other member via `Omit<…, 'create'>`).
- [ ] **Step 2:** `NX_DAEMON=false npx nx type-tests langgraph` → FAIL (chat types missing).
- [ ] **Step 3: Implement** the chat file and export it from `public-api.ts` next to the thread-list exports (lines 88-91).
- [ ] **Step 4:** `NX_DAEMON=false npx nx type-tests langgraph` → PASS; temporarily rename one field in the chat copy and confirm it FAILS, then restore (do this by editing, not `git checkout`).
- [ ] **Step 5: Commit** `feat(chat): add the ThreadDirectory contract for Angular`.

---

### Task 5: `LangGraphThreadsAdapter` directory view, errors and projects

**Files:**
- Modify: `libs/langgraph/src/lib/threads/threads-adapter.ts`, `libs/langgraph/src/public-api.ts`
- Test: `libs/langgraph/src/lib/threads/threads-adapter.spec.ts`, create `threads-adapter-conformance.spec.ts`

**Interfaces:**
- Consumes: Task 4 `ThreadDirectory` (from `@threadplane/chat`), Task 2 `describeThreadDirectoryConformance` and `createFakeThreadsClient` (test-only import from `../../runtime/testing/...`).
- Produces on `LangGraphThreadsAdapter` (additions only):
  - `readonly status: Signal<ThreadDirectoryStatus>`, `readonly error: Signal<ThreadDirectoryError | undefined>`, `readonly projects: Signal<readonly ProjectEntry[] | undefined>`
  - `readonly directory: ThreadDirectory` — a view over the adapter: `create` maps `null` to a rejection; `remove`→`delete`, `setArchived`→`archive`/`unarchive`, `setPinned`→`pin`/`unpin`, `setProject`→`moveToProject`; `subscribe` keeps a listener set that the adapter notifies wherever it writes `threads`, `archivedThreads`, `projects`, `status` or `error` (no `effect`, so it works outside an injection context); `getSnapshot` returns a frozen snapshot rebuilt only when one of those writes happens.
  - `LangGraphThreadsConfig.projects?: false | { namespace?: readonly string[] }` (default on). Project storage is a private Angular-side copy of Task 3's logic, same namespace and value shape.

- [ ] **Step 1: Failing tests:** `threads-adapter-conformance.spec.ts` runs `describeThreadDirectoryConformance('angular adapter', client => …)` providing `LANGGRAPH_CLIENT` = fake via `TestBed`; plus in `threads-adapter.spec.ts`: `sets status error and keeps refresh resolving on failure`; `keeps create returning null on failure`.
- [ ] **Step 2:** `NX_DAEMON=false npx nx test langgraph` → FAIL.
- [ ] **Step 3: Implement.** Add the optimistic-patch map (same algorithm as Task 2) so the conformance cases pass; existing method behavior is unchanged.
- [ ] **Step 4:** `NX_DAEMON=false npx nx run-many -t test lint type-tests build -p langgraph` → PASS. Confirm the built `dist` Angular entry contains no `@threadplane/core` import: `grep -r "@threadplane/core" dist/libs/langgraph/fesm2022` → no output.
- [ ] **Step 5: Commit** `feat(langgraph): expose LangGraphThreadsAdapter as a ThreadDirectory with project names`.

---

### Task 6: React `ThreadSidebar`

**Files:**
- Create: `libs/react/src/chat/thread-sidebar.tsx`
- Modify: `libs/react/src/chat/index.ts`, `libs/react/src/chat/styles.css`, `scripts/react-parity/verify-packages.mjs` (line 468 `'react/chat'` list), `scripts/react-parity/verify-packages.spec.mjs` (`supported` literal near line 1043), `scripts/react-parity/dispositions.json` (append rows)
- Test: `libs/react/src/chat/thread-sidebar.spec.tsx`

**Interfaces:**
- Consumes: Task 1 contract + `refreshDirectoryOnRunEnd`; existing `ChatSidenavSections`, `ThreadList`, `ProjectList`.
- Produces:
```ts
export interface ThreadSidebarFeatures { readonly projects?: boolean; readonly archive?: boolean; readonly pin?: boolean;
  readonly reorder?: boolean; readonly rename?: boolean; readonly remove?: boolean; } // all default true when the directory supports them
export interface ThreadSidebarProps {
  readonly directory: ThreadDirectory; readonly session?: Pick<AgentSession, 'getSnapshot' | 'subscribe'>;
  readonly activeThreadId?: string | null; readonly onSelect: (threadId: string) => void;
  readonly onNewChat?: () => void; readonly onActiveRemoved?: () => void;
  readonly selectedProjectId?: string | null; readonly onProjectSelect?: (projectId: string | null) => void;
  readonly features?: ThreadSidebarFeatures; readonly renderThread?: ThreadListProps['renderItem'];
  readonly extraActions?: ThreadListProps['extraActions']; readonly before?: ReactNode; readonly after?: ReactNode;
  readonly labels?: Partial<Record<'newChat' | 'projects' | 'recent' | 'archived' | 'archivedEmpty' | 'loadError' | 'retry' | 'empty', string>>;
  readonly className?: string;
}
export function ThreadSidebar(props: ThreadSidebarProps): JSX.Element;
```
If `ThreadList` has no `renderItem`/`extraActions` props today, add them to `ThreadList` in this task (row override receives the `ThreadListItem` and the default row node; extra actions are `{ id; label; run(threadId) }[]` appended to the row menu) and test them in `thread-list.spec.tsx`.
- Default `onNewChat`: `directory.create?.()` then `onSelect(id)`.

- [ ] **Step 1: Failing tests** (use a hand-written fake `ThreadDirectory` in the spec):
  - `lists threads from the directory and refreshes on mount` (refresh called once).
  - `hides menu actions the directory lacks` — fake without `remove` → no "Delete" menu item.
  - `turns built-ins off with features` — `features={{ projects: false }}` → no Projects section even when `projects` is present.
  - `shows the load error and retries` — snapshot `status: 'error'` → `role="alert"` with label `loadError`; clicking Retry calls `refresh`.
  - `refreshes after a run ends` — fake session `running → idle` → refresh called a second time.
  - `reports the active thread removed` — delete the active row → `onActiveRemoved` called once.
  - `renders before and after sections and a custom row`.
- [ ] **Step 2:** `NX_DAEMON=false npx nx test react` → FAIL.
- [ ] **Step 3: Implement** with `useSyncExternalStore(directory.subscribe, directory.getSnapshot)`, composing `ChatSidenavSections`; derive the `ThreadActionAdapter`/`ProjectActionAdapter` from the directory's present methods and `features`. Add `ThreadSidebar` and its types to `index.ts`, the allowlist and spec, and append dispositions rows (`export:libs/react/src/chat/index.ts#ThreadSidebar`, `source:libs/react/src/chat/thread-sidebar.tsx`, `treatment: "react"`, `status: "in-progress"`, `taskIds` following the `ChatSidenavSections` row).
- [ ] **Step 4:** `NX_DAEMON=false npx nx run-many -t test lint -p react`, `node --test scripts/react-parity/verify-packages.spec.mjs`, `node scripts/react-parity/inventory.mjs --check --drift warn` → PASS.
- [ ] **Step 5: Commit** `feat(react): add a connected ThreadSidebar`.

---

### Task 7: Angular `<chat-thread-sidebar>`

**Files:**
- Create: `libs/chat/src/lib/compositions/chat-thread-sidebar/chat-thread-sidebar.component.ts`, `.spec.ts`
- Modify: `libs/chat/src/public-api.ts`; `chat-thread-list.component.ts` only if row-template / extra-action inputs are missing

**Interfaces:**
- Consumes: Task 4 contract; `Agent` from `libs/chat/src/lib/agent/agent.ts` (`status: Signal<AgentStatus>`).
- Produces: `ChatThreadSidebarComponent`, selector `chat-thread-sidebar`, inputs `directory` (required), `agent?`, `activeThreadId?`, `selectedProjectId?`, `features?: ThreadSidebarFeatures` (same shape as React, declared in this file), `extraActions?`, `labels?`; outputs `threadSelected: string`, `newChat: void`, `projectSelected: string | null`, `activeThreadRemoved: void`; content: `ng-template[chatThreadRow]` (context `$implicit: Thread`), `[chatThreadSidebarBefore]`, `[chatThreadSidebarAfter]`.
- Run-end refresh: an `effect` on `agent()?.status()` that calls `directory().refresh()` on a transition out of `'running'` (same logic as `refresh-on.ts:21-27`, written locally; chat must not import langgraph).
- Default `newChat` when nothing listens: `directory.create?.()` then emit `threadSelected(id)`.

- [ ] **Step 1: Failing tests** mirroring Task 6 one-for-one (same names), using a signal-backed fake directory and a fake `Agent`.
- [ ] **Step 2:** `NX_DAEMON=false npx nx test chat` → FAIL.
- [ ] **Step 3: Implement** by composing `<chat-thread-list>`, `<chat-project-list>` and the archived section the way `<chat-sidenav>` does; read the directory with a `signal` updated from `directory.subscribe` and released on destroy. Export from `public-api.ts` next to `ChatSidenavComponent` (line 133).
- [ ] **Step 4:** `NX_DAEMON=false npx nx run-many -t test lint build -p chat` → PASS; `grep -r "@threadplane/core\|@threadplane/langgraph" dist/libs/chat/fesm2022` → no output.
- [ ] **Step 5: Commit** `feat(chat): add a connected chat-thread-sidebar`.

---

### Task 8: Cockpit wiring and end-to-end coverage

**Files:**
- Modify: `cockpit/chat/threads/angular/src/…` (replace the hand-wired thread list with `<chat-thread-sidebar [directory]="threads.directory" [agent]="agent">`), `cockpit/chat/threads/angular/e2e/c-threads.spec.ts`
- Modify: `cockpit/chat/threads/react/src/…` (replace the `<nav aria-label="Conversations">` picker with `ThreadSidebar` and `createLangGraphThreadDirectory`), `scripts/react-cockpit/chat-threads-fixture.mjs` (add `POST /threads/search`, `PATCH /threads/:id`, `DELETE /threads/:id`, `POST /store/items/search`, `PUT /store/items`, `DELETE /store/items` if missing), `cockpit/chat/threads/react/e2e/threads.spec.ts`

- [ ] **Step 1: Extend both e2e specs** with: rename a thread and see it after reload; pin two and drag to reorder; create a project, move a thread into it, reload, project name still shown; delete the active thread and see the app return to a new chat. Keep the existing assertions.
- [ ] **Step 2:** `NX_DAEMON=false npx nx e2e cockpit-chat-threads-react` and the Angular cockpit threads e2e target (look up the exact name in `cockpit/chat/threads/angular/project.json`) → FAIL before wiring.
- [ ] **Step 3: Wire** the apps (cockpit examples stay standalone; no imports from other cockpit apps). If the Angular app's aimock fixtures need new recordings for the new requests, add them in `e2e/fixtures/c-threads.json`.
- [ ] **Step 4:** both e2e targets → PASS.
- [ ] **Step 5: Commit** `test(cockpit): drive the threads examples through the connected sidebars`.

---

### Task 9: Docs

**Files:**
- Modify/create the React and Angular thread docs pages under `apps/website/content/docs/` (find the existing thread-list / threads pages with `rg -l "ThreadList|LangGraphThreadsAdapter" apps/website/content/docs`)

- [ ] **Step 1:** Add a "Connected sidebar" section to each framework's threads page: the minimal example from the cockpit app, the four customization levels from the spec, where project names are stored and how to turn projects off, and the run-end refresh. React page keeps the "experimental, private source-build" notice. No contractions.
- [ ] **Step 2:** `cd apps/website && npx vitest run` → PASS (load-related timeouts in preview specs: rerun those files alone). Check whether `npm run generate-agent-context` is needed and run only that generator if so.
- [ ] **Step 3: Commit** `docs: document the connected thread sidebars`.

---

## Phase 2 (not in this plan)

When the Angular packages export core: replace Task 4's copy with a re-export, rebuild `LangGraphThreadsAdapter` on `createLangGraphThreadDirectory`, delete the Angular project-store copy and the type spec.
