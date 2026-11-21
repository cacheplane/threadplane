import {
  DestroyRef,
  Injectable,
  InjectionToken,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type { Client, Thread as SdkThread } from '@langchain/langgraph-sdk';
import type {
  ProjectEntry,
  Thread,
  ThreadDirectory,
  ThreadDirectoryError,
  ThreadDirectorySnapshot,
  ThreadDirectoryStatus,
  ThreadEntry,
} from '@threadplane/chat';
import {
  createLangGraphClient,
  ɵcreateProtectedLangGraphClient,
} from '../client/create-langgraph-client';
import { LANGGRAPH_CLIENT_OPTIONS } from '../client/client-options';
import {
  createLangGraphRuntimeFetch,
  createSafeRequestError,
  sanitizeLangGraphClientOperationFailure,
  ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
} from '../runtime-operation-reporter';
import {
  applyPatch,
  orderThreads,
  projectThread,
  sameEntry,
  sameList,
  sameProjects,
  stripOrder,
  type ProjectedThread,
  type ThreadPatchFields,
} from '../../runtime/thread-metadata';
import {
  createLangGraphProjectStore,
  requireProjectName,
  type ProjectStore as ThreadProjectStore,
} from '../../runtime/project-store';

/**
 * Configuration consumed by {@link LangGraphThreadsAdapter}. Provide
 * via {@link LANGGRAPH_THREADS_CONFIG} (typically in app.config.ts):
 *
 * ```ts
 * providers: [
 *   { provide: LANGGRAPH_THREADS_CONFIG, useValue: {
 *       apiUrl: environment.langGraphApiUrl,
 *   }},
 * ],
 * ```
 *
 * The adapter expects backends to write the thread title to
 * `metadata.title`. Spec 2026-05-19-llm-generated-labels-design.md
 * originally proposed `metadata.thread_title` for cockpit caps but
 * we converged on `title` to match the canonical demo and avoid a
 * per-cap configuration knob.
 */
export interface LangGraphThreadsConfig {
  /** Base URL for the LangGraph Platform API. Accepts both absolute
   *  URLs and relative `/api`-style paths. */
  apiUrl: string;
  /** Fallback label for threads whose title hasn't been written yet
   *  (e.g. created but never sent). Defaults to `'Untitled'`. */
  titleFallback?: string;
  /** Project names, kept in the LangGraph Store API under `namespace`
   *  (default `['threadplane', 'projects']`), one item per project with the
   *  value `{ name }`. On by default; `false` turns projects off. A server
   *  without the Store API still lists threads; while the store cannot be
   *  read, {@link LangGraphThreadsAdapter.projects} is `undefined` and project
   *  commands reject. */
  projects?: false | { namespace?: readonly string[] };
}

/** Injection token supplying the thread adapter's API URL and fallback thread title. */
export const LANGGRAPH_THREADS_CONFIG = new InjectionToken<LangGraphThreadsConfig>(
  'LANGGRAPH_THREADS_CONFIG',
);

/** Optional adapter clients can pass an explicit Client (e.g. for
 *  testing). When omitted, the adapter constructs one via
 *  {@link createLangGraphClient}. */
export const LANGGRAPH_CLIENT = new InjectionToken<Client>('LANGGRAPH_CLIENT');

/**
 * SDK-backed thread store. Wraps `client.threads.*` and maps SDK
 * threads to the framework's {@link @threadplane/chat#Thread | Thread} type for direct use with
 * `<chat-thread-list>` / `<chat-sidenav>`.
 *
 * Consumers wire the framework's `ThreadActionAdapter` to instance
 * methods (rename/delete/archive/pin/...) so the right-click menu
 * round-trips through the LangGraph SDK without per-app boilerplate.
 *
 * @example
 * ```ts
 * const svc = inject(LangGraphThreadsAdapter);
 * const actions: ThreadActionAdapter = {
 *   rename: (id, t) => svc.rename(id, t),
 *   delete: (id) => svc.delete(id),
 * };
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LangGraphThreadsAdapter {
  private readonly config = inject(LANGGRAPH_THREADS_CONFIG);
  private readonly clientState = (() => {
    const clientOptions = inject(LANGGRAPH_CLIENT_OPTIONS, { optional: true }) ?? undefined;
    const reportOperationFailure =
      inject(ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER, { optional: true }) ??
      undefined;
    const injectedClient = inject(LANGGRAPH_CLIENT, { optional: true });
    const ownsProtectedClient =
      injectedClient === null &&
      (clientOptions?.defaultHeaders !== undefined ||
        reportOperationFailure !== undefined);
    return {
      client:
        injectedClient ??
        (ownsProtectedClient
          ? ɵcreateProtectedLangGraphClient(
              this.config.apiUrl,
              clientOptions,
              createLangGraphRuntimeFetch(reportOperationFailure)
            )
          : createLangGraphClient(this.config.apiUrl, clientOptions)),
      protectErrors:
        clientOptions?.defaultHeaders !== undefined || ownsProtectedClient,
      reportOperationFailure: ownsProtectedClient
        ? reportOperationFailure
        : undefined,
    };
  })();
  private readonly client: Client = this.clientState.client;

  private readonly fallback: string = this.config.titleFallback ?? 'Untitled';
  private readonly projectStore: ThreadProjectStore | undefined =
    this.config.projects === false
      ? undefined
      : createLangGraphProjectStore(this.client, {
          namespace: this.config.projects?.namespace,
        });

  private readonly _threads: WritableSignal<Thread[]> = signal<Thread[]>([]);
  private readonly _archived: WritableSignal<Thread[]> = signal<Thread[]>([]);
  private readonly _status: WritableSignal<ThreadDirectoryStatus> =
    signal<ThreadDirectoryStatus>('idle');
  private readonly _error: WritableSignal<ThreadDirectoryError | undefined> =
    signal<ThreadDirectoryError | undefined>(undefined);
  private readonly _projects: WritableSignal<readonly ProjectEntry[] | undefined> =
    signal<readonly ProjectEntry[] | undefined>(
      this.projectStore ? Object.freeze([]) : undefined,
    );

  /** Active (non-archived) threads, sorted with pinned first. */
  readonly threads: Signal<Thread[]> = this._threads.asReadonly();
  /** Threads whose `metadata.archived === true`. */
  readonly archivedThreads: Signal<Thread[]> = this._archived.asReadonly();
  /** `'loading'` until the first successful load (or while recovering from
   *  an error), `'error'` after a failed load, otherwise `'idle'`. */
  readonly status: Signal<ThreadDirectoryStatus> = this._status.asReadonly();
  /** The last load failure, opaque by design; cleared by a successful load. */
  readonly error: Signal<ThreadDirectoryError | undefined> = this._error.asReadonly();
  /** Project names from the LangGraph Store API, sorted by name.
   *  `undefined` when `projects: false` or while the Store API cannot be
   *  read, so views hide the Projects section. */
  readonly projects: Signal<readonly ProjectEntry[] | undefined> =
    this._projects.asReadonly();

  // Server list plus optimistic patches. A patch stays until a refresh that
  // started after its mutation settled succeeds, so a refresh never undoes a
  // pending change; it is dropped at once if the mutation fails.
  private server: readonly ProjectedThread[] = [];
  private readonly pending = new Set<ThreadPatch>();
  private published = new Map<string, PublishedThread>();
  private activeEntries: readonly ThreadEntry[] = Object.freeze([]);
  private archivedEntries: readonly ThreadEntry[] = Object.freeze([]);
  private serverProjects: readonly ProjectEntry[] = Object.freeze([]);
  private projectsUnavailable = false;
  private loaded = false;
  private loadFailure: ThreadDirectoryError | undefined;
  private started = 0;
  private applied = 0;
  private inFlight = 0;

  // The directory view: its own listeners and last snapshot.
  private readonly viewListeners = new Set<() => void>();
  private viewDisposed = false;
  private viewSnapshot: ThreadDirectorySnapshot = this.buildSnapshot();

  /**
   * The adapter as a {@link @threadplane/chat#ThreadDirectory | ThreadDirectory},
   * for `<chat-thread-sidebar>`. It reads the same state as the signals and
   * notifies its subscribers without an `effect`, so it works outside an
   * injection context.
   *
   * Mutation failures reject with an opaque `'The LangGraph request
   * failed.'` error, and `create` rejects where the adapter's `create()`
   * returns `null`. `refresh({ signal })` and `create({ signal })` ignore
   * `signal`: the adapter's requests are not abortable.
   *
   * `dispose()` detaches this view only: its listeners are dropped, its
   * snapshot stops changing and its commands reject. The adapter is a
   * DI-owned service, so its signals and methods keep working; the view is
   * disposed for you when the injector is destroyed, and apps normally never
   * dispose it themselves.
   */
  readonly directory: ThreadDirectory = this.createDirectory();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disposeView());
  }

  /** Fetch the latest thread list from the server. Failures are
   *  logged via `console.error` (not swallowed silently — silent
   *  catches have masked prod issues in the past) and exposed through
   *  {@link status} and {@link error}.
   *
   *  Invocation and resolution are logged at `console.debug` so prod
   *  inspection can distinguish "never called" from "called but
   *  resolved empty" from "called and threw." This was prompted by a
   *  demo.threadplane.ai cold-load bug where the sidenav stayed empty
   *  with no visible signal. Tighten the log volume if it becomes
   *  noisy. */
  async refresh(): Promise<void> {
    // Resolves once threads are published; project names load in the
    // background. The directory's refresh() waits for them.
    await this.load(false);
  }

  /** Reads the thread list, publishes it, then reads project names and
   *  publishes again. Thread mutations confirm on the thread list alone
   *  (`waitForProjects: false`), so a slow Store API never holds them. */
  private async load(waitForProjects: boolean): Promise<void> {
    console.debug('[LangGraphThreadsAdapter.refresh] invoked');
    const sequence = ++this.started;
    this.inFlight++;
    this.publish();
    const outcome = await settle(() =>
      this.client.threads.search({ limit: 50, offset: 0 }),
    );
    this.inFlight--;
    const list = 'value' in outcome && Array.isArray(outcome.value)
      ? (outcome.value as SdkThread[])
      : undefined;
    if (list) {
      console.debug('[LangGraphThreadsAdapter.refresh] resolved', list.length);
    } else {
      const failure = 'failed' in outcome
        ? outcome.failed
        : new TypeError('threads.search did not return a list');
      console.error('[LangGraphThreadsAdapter.refresh] failed:', this.safeError(failure));
    }
    // Results that arrive after a newer refresh's results are discarded.
    if (sequence > this.applied) {
      this.applied = sequence;
      if (list) {
        this.server = list.map((t) => projectThread(t, this.fallback));
        this.loadFailure = undefined;
        this.loaded = true;
        for (const patch of this.pending)
          if (patch.settledAt !== undefined && patch.settledAt < sequence)
            this.pending.delete(patch);
      } else {
        this.loadFailure = LOAD_ERROR;
      }
    }
    this.publish();
    // Projects load only after the thread list succeeds, so a failed load
    // makes one request (and one operation-failure report), as it always has.
    const store = this.projectStore;
    if (!list || !store) return;
    const projects = this.loadProjects(store, sequence);
    if (waitForProjects) await projects;
  }

  private async loadProjects(
    store: ThreadProjectStore,
    sequence: number,
  ): Promise<void> {
    const outcome = await settle(() => store.list());
    if (sequence !== this.applied) return;
    if ('value' in outcome && Array.isArray(outcome.value)) {
      const projects = outcome.value as readonly ProjectEntry[];
      this.projectsUnavailable = false;
      if (!sameProjects(this.serverProjects, projects))
        this.serverProjects = Object.freeze([...projects]);
    } else {
      // A missing or failing Store API never fails the thread list.
      this.projectsUnavailable = true;
    }
    this.publish();
  }

  /** Fetch a single thread by id. Returns `null` when the server
   *  returns 404 (thread doesn't exist) so callers can distinguish
   *  "missing" from "couldn't reach the server" — genuine network
   *  errors rethrow. Used by URL-based thread routing to validate a
   *  pasted/shared thread id before activating it. */
  async getThread(threadId: string): Promise<Thread | null> {
    try {
      const t = await this.client.threads.get(threadId);
      return this.toThread(projectThread(t, this.fallback));
    } catch (e) {
      // SDK throws HTTPError-like objects without a typed error class;
      // sniff status on the error or its nested response. Treat both
      // 404 (server says "no such thread") and 422 (server says "id
      // isn't even a valid UUID") as "missing" — both warrant the
      // same caller behavior (redirect to a fresh chat).
      const status = safeThreadErrorStatus(e);
      if (status === 404 || status === 422) return null;
      throw this.safeError(e);
    }
  }

  async create(metadata: Record<string, unknown> = {}): Promise<string | null> {
    try {
      const t = await this.client.threads.create({ metadata });
      await this.load(false);
      return t.thread_id;
    } catch (e) {
      console.error('[LangGraphThreadsAdapter.create] failed:', this.safeError(e));
      return null;
    }
  }

  // The runtime directory URL-encodes thread ids in request paths; this
  // adapter keeps the raw-id paths existing apps already rely on.
  async delete(threadId: string): Promise<void> {
    await this.mutate([{ id: threadId, fields: { removed: true } }], () =>
      this.client.threads.delete(threadId),
    );
  }

  async rename(threadId: string, newTitle: string): Promise<void> {
    // A blank title shows the fallback at once, as the server list would.
    const shown = newTitle.trim() || this.fallback;
    await this.mutate([{ id: threadId, fields: { title: shown } }], () =>
      this.client.threads.update(threadId, { metadata: { title: newTitle } }),
    );
  }

  async archive(threadId: string): Promise<void> {
    await this.mutate([{ id: threadId, fields: { archived: true } }], () =>
      this.client.threads.update(threadId, { metadata: { archived: true } }),
    );
  }

  async unarchive(threadId: string): Promise<void> {
    await this.mutate([{ id: threadId, fields: { archived: false } }], () =>
      this.client.threads.update(threadId, { metadata: { archived: false } }),
    );
  }

  async pin(threadId: string): Promise<void> {
    await this.mutate([{ id: threadId, fields: { pinned: true } }], () =>
      this.client.threads.update(threadId, { metadata: { pinned: true } }),
    );
  }

  async unpin(threadId: string): Promise<void> {
    await this.mutate([{ id: threadId, fields: { pinned: false } }], () =>
      this.client.threads.update(threadId, { metadata: { pinned: false } }),
    );
  }

  async moveToProject(threadId: string, projectId: string | null): Promise<void> {
    await this.mutate([{ id: threadId, fields: { projectId } }], () =>
      this.client.threads.update(threadId, { metadata: { projectId } }),
    );
  }

  /** Re-stamp `metadata.pinnedOrder = 0,1,2,...` for the pinned slice
   *  to reflect the new ordering. A `beforeId` that is not a pinned
   *  thread moves the thread to the end. */
  async reorderPinned(threadId: string, beforeId: string | null): Promise<void> {
    const current = this.activeEntries.filter((t) => t.pinned);
    const moved = current.find((t) => t.id === threadId);
    if (!moved) return;
    const next: ThreadEntry[] = [];
    for (const t of current) {
      if (t.id === threadId) continue;
      if (t.id === beforeId) next.push(moved);
      next.push(t);
    }
    if (!next.includes(moved)) next.push(moved);

    await this.mutate(
      next.map((t, pinnedOrder) => ({ id: t.id, fields: { pinnedOrder } })),
      () =>
        Promise.all(
          next.map((t, idx) =>
            this.client.threads.update(t.id, { metadata: { pinnedOrder: idx } }),
          ),
        ),
    );
  }

  private createProject(name: string): Promise<{ readonly id: string }> {
    const trimmed = requireProjectName(name);
    return this.mutateProjects((store) => store.create(trimmed));
  }

  private renameProject(id: string, name: string): Promise<void> {
    const trimmed = requireProjectName(name);
    return this.mutateProjects((store) => store.rename(id, trimmed));
  }

  private async removeProject(id: string): Promise<void> {
    const members = [...this.activeEntries, ...this.archivedEntries].filter(
      (entry) => entry.projectId === id,
    );
    try {
      await this.mutateProjects(
        async (store) => {
          // Threads leave the project first so none points at a missing one.
          await Promise.all(
            members.map((entry) =>
              this.client.threads.update(entry.id, { metadata: { projectId: null } }),
            ),
          );
          await store.remove(id);
        },
        members.map((entry) => ({ id: entry.id, fields: { projectId: null } })),
      );
    } catch (failure) {
      // Some threads may already have left the project on the server.
      void this.refresh();
      throw failure;
    }
  }

  private async mutate(
    patches: readonly { readonly id: string; readonly fields: ThreadPatchFields }[],
    work: () => Promise<unknown>,
    waitForProjects = false,
  ): Promise<void> {
    const records: ThreadPatch[] = patches.map((patch) => ({ ...patch }));
    for (const record of records) this.pending.add(record);
    this.publish();
    try {
      await work();
    } catch (error) {
      for (const record of records) this.pending.delete(record);
      this.publish();
      throw this.safeError(error);
    }
    for (const record of records) record.settledAt = this.started;
    await this.load(waitForProjects);
  }

  private async mutateProjects<T>(
    work: (store: ThreadProjectStore) => Promise<T>,
    patches: readonly { readonly id: string; readonly fields: ThreadPatchFields }[] = [],
  ): Promise<T> {
    const store = this.projectStore;
    if (!store || this.projectsUnavailable) throw createSafeRequestError();
    let result: T | undefined;
    const run = async () => {
      result = await work(store);
    };
    if (patches.length > 0) {
      // Project commands wait for the project list so callers see the change.
      await this.mutate(patches, run, true);
    } else {
      await this.request(run);
      await this.load(true);
    }
    return result as T;
  }

  private computeStatus(): ThreadDirectoryStatus {
    // Loading shows only until the first successful load, or while
    // recovering from an error; a later refresh keeps the last state.
    if (this.inFlight > 0 && (!this.loaded || this.loadFailure !== undefined))
      return 'loading';
    return this.loadFailure !== undefined ? 'error' : 'idle';
  }

  /** Rebuilds the published lists from the server list and pending
   *  patches, writes the signals and tells the directory view. */
  private publish(): void {
    const entries: ProjectedThread[] = [];
    for (const base of this.server) {
      let entry: ProjectedThread | undefined = base;
      for (const patch of this.pending)
        if (patch.id === base.id) entry = entry && applyPatch(entry, patch.fields);
      if (entry) entries.push(entry);
    }
    const ordered = orderThreads(entries);
    const nextPublished = new Map<string, PublishedThread>();
    const publishOne = (source: ProjectedThread): PublishedThread => {
      const kept = this.published.get(source.id);
      const item =
        kept && sameEntry(kept.source, source)
          ? kept
          : { source, entry: stripOrder(source), thread: this.toThread(source) };
      nextPublished.set(source.id, item);
      return item;
    };
    const active = ordered.threads.map(publishOne);
    const archived = ordered.archived.map(publishOne);
    this.published = nextPublished;

    const activeEntries = active.map((item) => item.entry);
    if (!sameList(this.activeEntries, activeEntries)) {
      this.activeEntries = Object.freeze(activeEntries);
      this._threads.set(active.map((item) => item.thread));
    }
    const archivedEntries = archived.map((item) => item.entry);
    if (!sameList(this.archivedEntries, archivedEntries)) {
      this.archivedEntries = Object.freeze(archivedEntries);
      this._archived.set(archived.map((item) => item.thread));
    }
    this._status.set(this.computeStatus());
    this._error.set(this.loadFailure);
    this._projects.set(this.publishedProjects());
    this.updateView();
  }

  /** Builds the `ThreadDirectory` face. Commands delegate to the adapter's
   *  methods; failures reject with an opaque error. */
  private createDirectory(): ThreadDirectory {
    const run = <T>(work: () => Promise<T>): Promise<T> => {
      if (this.viewDisposed) return Promise.reject(createSafeRequestError());
      return work().catch(() => {
        throw createSafeRequestError();
      });
    };
    return Object.freeze({
      getSnapshot: () => this.viewSnapshot,
      subscribe: (notify: () => void) => {
        if (this.viewDisposed) return () => undefined;
        this.viewListeners.add(notify);
        return () => {
          this.viewListeners.delete(notify);
        };
      },
      refresh: async () => {
        if (this.viewDisposed) return;
        await this.load(true);
      },
      create: (options?: { readonly metadata?: { readonly [key: string]: unknown } }) =>
        run(async () => {
          const id = await this.create({ ...options?.metadata });
          if (id === null) throw createSafeRequestError();
          return Object.freeze({ id });
        }),
      rename: (id: string, title: string) => run(() => this.rename(id, title)),
      remove: (id: string) => run(() => this.delete(id)),
      setArchived: (id: string, archived: boolean) =>
        run(() => (archived ? this.archive(id) : this.unarchive(id))),
      setPinned: (id: string, pinned: boolean) =>
        run(() => (pinned ? this.pin(id) : this.unpin(id))),
      reorderPinned: (id: string, beforeId: string | null) =>
        run(() => this.reorderPinned(id, beforeId)),
      setProject: (id: string, projectId: string | null) =>
        run(() => this.moveToProject(id, projectId)),
      ...(this.projectStore
        ? {
            // A blank name rejects with its own message before any request.
            createProject: async (name: string) => {
              requireProjectName(name);
              return run(() => this.createProject(name));
            },
            renameProject: async (id: string, name: string) => {
              requireProjectName(name);
              return run(() => this.renameProject(id, name));
            },
            removeProject: (id: string) => run(() => this.removeProject(id)),
          }
        : {}),
      dispose: () => this.disposeView(),
    });
  }

  /** Rebuilds the view snapshot after a write and notifies on change. */
  private updateView(): void {
    if (this.viewDisposed) return;
    const next = this.buildSnapshot();
    const current = this.viewSnapshot;
    if (
      next.threads === current.threads &&
      next.archived === current.archived &&
      next.projects === current.projects &&
      next.status === current.status &&
      next.error === current.error
    )
      return;
    this.viewSnapshot = next;
    for (const notify of [...this.viewListeners]) notify();
  }

  private disposeView(): void {
    this.viewDisposed = true;
    this.viewListeners.clear();
  }

  /** An unavailable Store API publishes no projects, so views hide them. */
  private publishedProjects(): readonly ProjectEntry[] | undefined {
    return this.projectStore && !this.projectsUnavailable
      ? this.serverProjects
      : undefined;
  }

  private buildSnapshot(): ThreadDirectorySnapshot {
    return Object.freeze({
      threads: this.activeEntries,
      archived: this.archivedEntries,
      ...(this.publishedProjects() ? { projects: this.serverProjects } : {}),
      status: this.computeStatus(),
      ...(this.loadFailure === undefined ? {} : { error: this.loadFailure }),
    });
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.safeError(error);
    }
  }

  private safeError(error: unknown): unknown {
    if (!this.clientState.protectErrors) return error;
    if (this.clientState.reportOperationFailure !== undefined) {
      return sanitizeLangGraphClientOperationFailure(
        error,
        this.clientState.reportOperationFailure
      );
    }
    return createSafeRequestError();
  }

  private toThread(entry: ProjectedThread): Thread {
    return {
      id: entry.id,
      title: entry.title,
      status: entry.archived ? 'archived' : 'active',
      pinned: entry.pinned,
      projectId: entry.projectId,
      pinnedOrder: entry.pinnedOrder,
      updatedAt: entry.updatedAt,
    };
  }
}

interface ThreadPatch {
  readonly id: string;
  readonly fields: ThreadPatchFields;
  /** Refresh sequence current when the mutation succeeded. */
  settledAt?: number;
}

interface PublishedThread {
  readonly source: ProjectedThread;
  readonly entry: ThreadEntry;
  readonly thread: Thread;
}

/** Load failures are opaque by design: no status or body is inspected. */
const LOAD_ERROR: ThreadDirectoryError = Object.freeze({
  kind: 'server',
  message: 'The LangGraph request failed.',
  retryable: true,
  recovery: 'retry',
});

async function settle(
  work: () => Promise<unknown>,
): Promise<{ value: unknown } | { failed: unknown }> {
  try {
    return { value: await work() };
  } catch (failed) {
    return { failed };
  }
}

function safeThreadErrorStatus(error: unknown): number | null {
  try {
    if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return null;
    const own = Object.getOwnPropertyDescriptor(error, 'status');
    if (own && 'value' in own && typeof own.value === 'number') return own.value;
    const responseDescriptor = Object.getOwnPropertyDescriptor(error, 'response');
    if (!responseDescriptor || !('value' in responseDescriptor)) return null;
    const response = responseDescriptor.value as unknown;
    if ((typeof response !== 'object' || response === null) && typeof response !== 'function') return null;
    const nested = Object.getOwnPropertyDescriptor(response, 'status');
    return nested && 'value' in nested && typeof nested.value === 'number'
      ? nested.value
      : null;
  } catch {
    return null;
  }
}
