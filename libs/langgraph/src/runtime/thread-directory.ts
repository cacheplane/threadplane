import type {
  AgentError,
  PlainValue,
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectorySnapshot,
  ThreadEntry,
} from '@threadplane/core';
import type { Client } from '@langchain/langgraph-sdk';
import { ɵcreateProtectedLangGraphClient } from './create-langgraph-client.js';
import {
  createLangGraphRuntimeFetch,
  createSafeRequestError,
  projectLangGraphOperationFailure,
  type RuntimeOperationFailureReporter,
} from './operation-errors.js';
import {
  createLangGraphProjectStore,
  requireProjectName,
  type ProjectStore,
} from './project-store.js';
import {
  orderThreads,
  projectThread,
  type ProjectedThread,
} from './thread-metadata.js';
import type { LangGraphClientOptions } from './transport.types.js';

/** The SDK client surface a thread directory reads and writes. */
export type LangGraphThreadsClient = Pick<Client, 'threads' | 'store'>;

/** What `createLangGraphThreadDirectory` takes: how to reach the deployment, and where project names are kept. */
export interface LangGraphThreadDirectoryOptions {
  /** LangGraph API base. Ignored when `client` is supplied. */
  readonly apiUrl?: string;
  /** A ready SDK client, for example one shared with the app. */
  readonly client?: LangGraphThreadsClient;
  /** Options for the client built from `apiUrl`. Requests never retry. */
  readonly clientOptions?: LangGraphClientOptions;
  /** When set, `apiUrl` must be an absolute URL on this origin. */
  readonly browserOrigin?: string;
  /** Title for threads without one. Defaults to `'New chat'`. */
  readonly titleFallback?: string;
  /**
   * Project names. Defaults to the LangGraph Store API
   * (`createLangGraphProjectStore`); `false` turns projects off. While the
   * store cannot be read, the snapshot has no `projects` and project
   * commands reject.
   */
  readonly projects?: ProjectStore | false;
  /**
   * Receives `'unauthorized'` when a request is answered 401 or 403 and
   * `'network_blocked'` when a request never reached the server. Used only by
   * the client built from `apiUrl`; a supplied `client` reports nothing. A
   * reporter that throws does not affect the request.
   */
  readonly reportOperationFailure?: RuntimeOperationFailureReporter;
}

/** The thread commands a `LangGraphThreadDirectory` always has. */
export type LangGraphThreadCommand =
  | 'get'
  | 'pinnedOrderOf'
  | 'create'
  | 'rename'
  | 'remove'
  | 'setArchived'
  | 'setPinned'
  | 'reorderPinned'
  | 'setProject';
/** The project commands a `LangGraphThreadDirectory` has when projects are on. */
export type LangGraphProjectCommand =
  | 'createProject'
  | 'renameProject'
  | 'removeProject';

/**
 * The directory `createLangGraphThreadDirectory` returns: the core
 * `ThreadDirectory` with the commands it always has typed as present, so no
 * call needs `?.`.
 *
 * `TProjects` says whether the project commands exist: `true` (the default,
 * and what the default options build) types them as present, `false` (built
 * with `projects: false`) as absent, and `boolean` as optional.
 */
export type LangGraphThreadDirectory<TProjects extends boolean = true> =
  ThreadDirectory &
    Required<Pick<ThreadDirectory, LangGraphThreadCommand>> &
    ([TProjects] extends [true]
      ? Required<Pick<ThreadDirectory, LangGraphProjectCommand>>
      : [TProjects] extends [false]
        ? { readonly [K in LangGraphProjectCommand]?: undefined }
        : unknown);

/** The saved pin rank of each entry a directory produced. */
const pinnedOrders = new WeakMap<ThreadEntry, number>();

type Fields = Partial<
  Pick<ProjectedThread, 'title' | 'archived' | 'pinned' | 'projectId'> & {
    pinnedOrder: number;
    removed: true;
  }
>;

interface Patch {
  readonly id: string;
  readonly fields: Fields;
  /** Refresh sequence current when the mutation succeeded. */
  settledAt?: number;
}

/**
 * A framework-neutral `ThreadDirectory` over the LangGraph threads API.
 * Mutations show at once and roll back on failure; a refresh never undoes a
 * mutation that is still pending.
 */
export function createLangGraphThreadDirectory(
  options: LangGraphThreadDirectoryOptions & { readonly projects: false }
): LangGraphThreadDirectory<false>;
export function createLangGraphThreadDirectory(
  options: LangGraphThreadDirectoryOptions & { readonly projects?: ProjectStore }
): LangGraphThreadDirectory;
export function createLangGraphThreadDirectory(
  options: LangGraphThreadDirectoryOptions
): LangGraphThreadDirectory<boolean>;
export function createLangGraphThreadDirectory(
  options: LangGraphThreadDirectoryOptions
): LangGraphThreadDirectory<boolean> {
  // Only the client built here goes through the reporting fetch.
  const report = options.client ? undefined : options.reportOperationFailure;
  const requestError = (failure: unknown, signal: AbortSignal): Error =>
    projectRequestError(failure, signal, report);
  const client = options.client ?? ownedClient(options);
  const titleFallback = options.titleFallback ?? 'New chat';
  const projectStore: ProjectStore | undefined =
    options.projects === false
      ? undefined
      : options.projects ?? createLangGraphProjectStore(client);
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const pending = new Set<Patch>();
  let server: readonly ProjectedThread[] = [];
  let serverProjects: readonly ProjectEntry[] = Object.freeze([]);
  // Cached publication per thread: the source it came from and the entry
  // published for it, so unchanged threads keep their reference.
  let published = new Map<
    string,
    { readonly source: ProjectedThread; readonly entry: ThreadEntry }
  >();
  let projectsUnavailable = false;
  let loaded = false;
  let snapshot: ThreadDirectorySnapshot = Object.freeze({
    threads: Object.freeze([]),
    archived: Object.freeze([]),
    ...(projectStore ? { projects: serverProjects } : {}),
    status: 'idle',
  });
  let error: AgentError | undefined;
  let started = 0;
  let applied = 0;
  let inFlight = 0;

  const disposed = () => lifetime.signal.aborted;

  function publish(): void {
    if (disposed()) return;
    const entries: ProjectedThread[] = [];
    for (const base of server) {
      let entry: ProjectedThread | undefined = base;
      for (const patch of pending)
        if (patch.id === base.id) entry = entry && applyPatch(entry, patch.fields);
      if (entry) entries.push(entry);
    }
    const ordered = orderThreads(entries);
    const nextPublished = new Map<
      string,
      { readonly source: ProjectedThread; readonly entry: ThreadEntry }
    >();
    const project = (source: ProjectedThread): ThreadEntry => {
      const kept = published.get(source.id);
      const entry =
        kept && sameEntry(kept.source, source)
          ? kept.entry
          : (stripOrder(source) as ThreadEntry);
      nextPublished.set(source.id, {
        source: kept && entry === kept.entry ? kept.source : source,
        entry,
      });
      return entry;
    };
    const threads = ordered.threads.map(project);
    const archived = ordered.archived.map(project);
    published = nextPublished;
    // Loading shows only until the first successful load, or while recovering
    // from an error; a later refresh keeps the last state until it resolves.
    const status =
      inFlight > 0 && (!loaded || error !== undefined)
        ? 'loading'
        : error !== undefined
          ? 'error'
          : 'idle';
    const next: ThreadDirectorySnapshot = Object.freeze({
      threads: sameList(snapshot.threads, threads)
        ? snapshot.threads
        : Object.freeze(threads),
      archived: sameList(snapshot.archived, archived)
        ? snapshot.archived
        : Object.freeze(archived),
      // An unavailable Store API publishes no projects, so views hide them.
      ...(projectStore && !projectsUnavailable
        ? { projects: serverProjects }
        : {}),
      status,
      ...(error === undefined ? {} : { error }),
    });
    if (
      next.threads === snapshot.threads &&
      next.archived === snapshot.archived &&
      next.projects === snapshot.projects &&
      next.status === snapshot.status &&
      next.error === snapshot.error
    )
      return;
    snapshot = next;
    for (const notify of [...listeners]) notify();
  }

  /**
   * Reads the thread list and publishes it, then reads project names and
   * publishes again. A thread mutation confirms on the thread list alone
   * (`waitForProjects: false`), so a slow Store API never holds it.
   */
  async function load(
    waitForProjects: boolean,
    caller?: AbortSignal
  ): Promise<void> {
    if (disposed()) return;
    const sequence = ++started;
    const link = linkSignal(lifetime.signal, caller);
    const signal = link.signal;
    inFlight++;
    publish();
    const outcome = await settle(() =>
      client.threads.search({ limit: 50, offset: 0, signal })
    );
    inFlight--;
    if (disposed() || signal.aborted) {
      link.release();
      publish();
      return;
    }
    const listed = 'list' in outcome && Array.isArray(outcome.list);
    if (sequence > applied) {
      applied = sequence;
      if ('list' in outcome && Array.isArray(outcome.list)) {
        server = outcome.list.map((raw) => projectThread(raw, titleFallback));
        error = undefined;
        loaded = true;
        for (const patch of pending)
          if (patch.settledAt !== undefined && patch.settledAt < sequence)
            pending.delete(patch);
      } else {
        error = loadError(
          requestError('failed' in outcome ? outcome.failed : outcome, signal)
        );
      }
    }
    publish();
    // Projects are read only after the thread list succeeds, so a failed load
    // makes one request and reports one operation failure.
    if (!listed || !projectStore) {
      link.release();
      return;
    }
    const projects = loadProjects(projectStore, sequence, signal).finally(
      link.release
    );
    if (waitForProjects) await projects;
  }

  /** Never rejects: a missing or failing Store API never fails the list. */
  async function loadProjects(
    store: ProjectStore,
    sequence: number,
    signal: AbortSignal
  ): Promise<void> {
    const outcome = await settle(() => store.list(signal));
    if (disposed() || signal.aborted || sequence !== applied) return;
    if ('list' in outcome && Array.isArray(outcome.list)) {
      const list = outcome.list as readonly ProjectEntry[];
      projectsUnavailable = false;
      if (!sameProjects(serverProjects, list))
        serverProjects = Object.freeze([...list]);
    } else {
      projectsUnavailable = true;
    }
    publish();
  }

  const refresh = (refreshOptions?: {
    readonly signal?: AbortSignal;
  }): Promise<void> => load(true, refreshOptions?.signal);

  async function mutate(
    patches: readonly { readonly id: string; readonly fields: Fields }[],
    work: (signal: AbortSignal) => Promise<unknown>,
    waitForProjects = false
  ): Promise<void> {
    if (disposed()) throw createSafeRequestError();
    const records: Patch[] = patches.map((patch) => ({ ...patch }));
    for (const record of records) pending.add(record);
    publish();
    try {
      await work(lifetime.signal);
    } catch (failure) {
      for (const record of records) pending.delete(record);
      publish();
      throw requestError(failure, lifetime.signal);
    }
    for (const record of records) record.settledAt = started;
    await load(waitForProjects);
  }

  async function mutateProjects<T>(
    work: () => Promise<T>,
    patches: readonly { readonly id: string; readonly fields: Fields }[] = []
  ): Promise<T> {
    if (disposed() || !projectStore || projectsUnavailable)
      throw createSafeRequestError();
    let result: T | undefined;
    const wrapped = async () => {
      try {
        result = await work();
      } catch (failure) {
        throw requestError(failure, lifetime.signal);
      }
    };
    // Project commands wait for the project list, so callers see the change.
    if (patches.length > 0) await mutate(patches, wrapped, true);
    else {
      await wrapped();
      await load(true);
    }
    return result as T;
  }

  const update = (id: string, metadata: Record<string, PlainValue>) =>
    (signal: AbortSignal) =>
      client.threads.update(encodeURIComponent(id), { metadata, signal });

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    refresh,
    async get(id: string, getOptions?: { readonly signal?: AbortSignal }) {
      if (disposed()) throw createSafeRequestError();
      const link = linkSignal(lifetime.signal, getOptions?.signal);
      try {
        const source = projectThread(
          await client.threads.get(encodeURIComponent(id), {
            signal: link.signal,
          }),
          titleFallback
        );
        // A thread the list already shows unchanged keeps its entry.
        const kept = published.get(source.id);
        return kept && sameEntry(kept.source, source)
          ? kept.entry
          : stripOrder(source);
      } catch (failure) {
        // 404 says there is no such thread and 422 that the id is not one a
        // thread could have; both are "missing". Anything else is unknown.
        const status = link.signal.aborted ? null : failureStatus(failure);
        if (status === 404 || status === 422) return null;
        throw requestError(failure, link.signal);
      } finally {
        link.release();
      }
    },
    pinnedOrderOf: (entry: ThreadEntry) => pinnedOrders.get(entry),
    async create(createOptions?: {
      readonly metadata?: { readonly [key: string]: PlainValue };
      readonly signal?: AbortSignal;
    }) {
      if (disposed()) throw createSafeRequestError();
      const link = linkSignal(lifetime.signal, createOptions?.signal);
      let id: string;
      try {
        const created = await client.threads.create({
          metadata: { ...createOptions?.metadata },
          signal: link.signal,
        });
        id = created.thread_id;
      } catch (failure) {
        throw requestError(failure, link.signal);
      } finally {
        link.release();
      }
      await load(false);
      return Object.freeze({ id });
    },
    // A blank title shows the fallback at once, as the server list would.
    rename: (id: string, title: string) =>
      mutate(
        [{ id, fields: { title: title.trim() || titleFallback } }],
        update(id, { title })
      ),
    remove: (id: string) =>
      mutate([{ id, fields: { removed: true } }], (signal) =>
        client.threads.delete(encodeURIComponent(id), { signal })
      ),
    setArchived: (id: string, archived: boolean) =>
      mutate([{ id, fields: { archived } }], update(id, { archived })),
    setPinned: (id: string, pinned: boolean) =>
      mutate([{ id, fields: { pinned } }], update(id, { pinned })),
    setProject: (id: string, projectId: string | null) =>
      mutate([{ id, fields: { projectId } }], update(id, { projectId })),
    async reorderPinned(id: string, beforeId: string | null) {
      const pinned = snapshot.threads.filter((entry) => entry.pinned);
      const moved = pinned.find((entry) => entry.id === id);
      if (!moved) return;
      const next: ThreadEntry[] = [];
      for (const entry of pinned) {
        if (entry.id === id) continue;
        if (entry.id === beforeId) next.push(moved);
        next.push(entry);
      }
      if (!next.includes(moved)) next.push(moved);
      await mutate(
        next.map((entry, pinnedOrder) => ({
          id: entry.id,
          fields: { pinnedOrder },
        })),
        (signal) =>
          Promise.all(
            next.map((entry, pinnedOrder) =>
              update(entry.id, { pinnedOrder })(signal)
            )
          )
      );
    },
    ...(projectStore
      ? {
          createProject: async (name: string) => {
            const trimmed = requireProjectName(name);
            return mutateProjects(() => projectStore.create(trimmed));
          },
          renameProject: async (id: string, name: string) => {
            const trimmed = requireProjectName(name);
            return mutateProjects(() => projectStore.rename(id, trimmed));
          },
          async removeProject(id: string) {
            const members = [
              ...snapshot.threads,
              ...snapshot.archived,
            ].filter((entry) => entry.projectId === id);
            try {
              await mutateProjects(
                async () => {
                  await Promise.all(
                    members.map((entry) =>
                      update(entry.id, { projectId: null })(lifetime.signal)
                    )
                  );
                  await projectStore.remove(id);
                },
                members.map((entry) => ({
                  id: entry.id,
                  fields: { projectId: null },
                }))
              );
            } catch (failure) {
              // Some threads may already have left the project on the server.
              void refresh();
              throw failure;
            }
          },
        }
      : {}),
    dispose() {
      lifetime.abort();
      listeners.clear();
    },
  });
}

async function settle(
  work: () => Promise<unknown>
): Promise<{ list: unknown } | { failed: unknown }> {
  try {
    return { list: await work() };
  } catch (failed) {
    return { failed };
  }
}

/** The published entry: no rank on it; `pinnedOrderOf` answers for it. */
function stripOrder(source: ProjectedThread): ThreadEntry {
  const entry: ThreadEntry = Object.freeze({
    id: source.id,
    title: source.title,
    ...(source.updatedAt === undefined ? {} : { updatedAt: source.updatedAt }),
    pinned: source.pinned,
    archived: source.archived,
    projectId: source.projectId,
  });
  if (source.pinnedOrder !== undefined)
    pinnedOrders.set(entry, source.pinnedOrder);
  return entry;
}

function sameProjects(
  a: readonly ProjectEntry[],
  b: readonly ProjectEntry[]
): boolean {
  return (
    a.length === b.length &&
    a.every((project, i) => project.id === b[i]?.id && project.name === b[i]?.name)
  );
}

function ownedClient(
  options: LangGraphThreadDirectoryOptions
): LangGraphThreadsClient {
  const apiUrl = options.apiUrl;
  if (apiUrl === undefined)
    throw new Error('Directory requires an apiUrl or a client');
  if (options.browserOrigin !== undefined)
    assertSameOrigin(apiUrl, options.browserOrigin);
  // The protected fetch replaces failed responses with empty ones, so the SDK
  // never reads an error body.
  return ɵcreateProtectedLangGraphClient(
    apiUrl,
    { ...options.clientOptions, maxRetries: 0 },
    createLangGraphRuntimeFetch(options.reportOperationFailure)
  );
}

function assertSameOrigin(apiUrl: string, browserOrigin: string): void {
  let api: URL;
  let origin: string;
  try {
    api = new URL(apiUrl);
    origin = new URL(browserOrigin).origin;
  } catch {
    throw new Error('Directory requires an absolute same-origin API base');
  }
  if (
    !['http:', 'https:'].includes(api.protocol) ||
    api.origin !== origin ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  )
    throw new Error('Directory requires an absolute same-origin API base');
}

function projectRequestError(
  failure: unknown,
  signal: AbortSignal,
  report: RuntimeOperationFailureReporter | undefined
): Error {
  try {
    projectLangGraphOperationFailure(failure, signal, report);
  } catch (projected) {
    return projected as Error;
  }
}

/**
 * The HTTP status the SDK put on a failure, on the error or on its
 * `response`; null when there is none. Reads own data properties only, so a
 * hostile error object cannot run code or throw here.
 */
function failureStatus(failure: unknown): number | null {
  try {
    const own = dataProperty(failure, 'status');
    if (typeof own === 'number') return own;
    const nested = dataProperty(dataProperty(failure, 'response'), 'status');
    return typeof nested === 'number' ? nested : null;
  } catch {
    return null;
  }
}

function dataProperty(target: unknown, key: string): unknown {
  if (
    (typeof target !== 'object' || target === null) &&
    typeof target !== 'function'
  )
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** Load failures are opaque by design: no status or body is inspected. */
function loadError(projected: Error): AgentError {
  return Object.freeze({
    kind: 'server',
    message: projected.message,
    retryable: true,
    recovery: 'retry',
  });
}

/** Aborts when either signal aborts; `release` detaches the listeners. */
function linkSignal(
  lifetime: AbortSignal,
  caller: AbortSignal | undefined
): { readonly signal: AbortSignal; release(): void } {
  if (!caller) return { signal: lifetime, release: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime.aborted || caller.aborted) abort();
  lifetime.addEventListener('abort', abort, { once: true });
  caller.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    release() {
      lifetime.removeEventListener('abort', abort);
      caller.removeEventListener('abort', abort);
    },
  };
}

function applyPatch(
  entry: ProjectedThread,
  fields: Fields
): ProjectedThread | undefined {
  if (fields.removed) return undefined;
  return Object.freeze({ ...entry, ...fields });
}

function sameEntry(a: ProjectedThread, b: ProjectedThread): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.updatedAt === b.updatedAt &&
    a.pinned === b.pinned &&
    a.archived === b.archived &&
    a.projectId === b.projectId &&
    a.pinnedOrder === b.pinnedOrder
  );
}

function sameList(
  a: readonly ThreadEntry[],
  b: readonly ThreadEntry[]
): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
