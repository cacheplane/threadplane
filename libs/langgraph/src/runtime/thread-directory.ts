import type {
  AgentError,
  PlainValue,
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectorySnapshot,
  ThreadEntry,
} from '@threadplane/core';
import type { Client } from '@langchain/langgraph-sdk';
import { ɵcreateProtectedLangGraphClient } from '../lib/client/create-langgraph-client.js';
import {
  createLangGraphRuntimeFetch,
  createSafeRequestError,
  projectLangGraphOperationFailure,
} from './operation-errors.js';
import {
  createLangGraphProjectStore,
  requireProjectName,
  type ProjectStore,
} from './project-store.js';
import {
  applyPatch,
  orderThreads,
  projectThread,
  sameEntry,
  sameList,
  sameProjects,
  stripOrder,
  type ProjectedThread,
  type ThreadPatchFields as Fields,
} from './thread-metadata.js';
import type { LangGraphClientOptions } from './transport.types.js';

/** The SDK client surface a thread directory reads and writes. */
export type LangGraphThreadsClient = Pick<Client, 'threads' | 'store'>;

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
}

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
  options: LangGraphThreadDirectoryOptions
): ThreadDirectory {
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

  async function refresh(refreshOptions?: {
    readonly signal?: AbortSignal;
  }): Promise<void> {
    if (disposed()) return;
    const sequence = ++started;
    const link = linkSignal(lifetime.signal, refreshOptions?.signal);
    const signal = link.signal;
    inFlight++;
    publish();
    let outcome: { list: unknown } | { failed: unknown };
    let projectOutcome: { list: unknown } | { failed: unknown } | undefined;
    try {
      [outcome, projectOutcome] = await Promise.all([
        settle(() => client.threads.search({ limit: 50, offset: 0, signal })),
        projectStore ? settle(() => projectStore.list(signal)) : undefined,
      ]);
    } finally {
      link.release();
    }
    inFlight--;
    if (disposed()) return;
    if (signal.aborted) {
      publish();
      return;
    }
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
    if (projectOutcome && sequence === applied) {
      if ('list' in projectOutcome && Array.isArray(projectOutcome.list)) {
        const list = projectOutcome.list as readonly ProjectEntry[];
        projectsUnavailable = false;
        if (!sameProjects(serverProjects, list))
          serverProjects = Object.freeze([...list]);
      } else {
        // A missing or failing Store API never fails the thread list.
        projectsUnavailable = true;
      }
    }
    publish();
  }

  async function mutate(
    patches: readonly { readonly id: string; readonly fields: Fields }[],
    work: (signal: AbortSignal) => Promise<unknown>
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
    await refresh();
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
    if (patches.length > 0) await mutate(patches, wrapped);
    else {
      await wrapped();
      await refresh();
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
      await refresh();
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
    createLangGraphRuntimeFetch(undefined)
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

function requestError(failure: unknown, signal: AbortSignal): Error {
  try {
    projectLangGraphOperationFailure(failure, signal, undefined);
  } catch (projected) {
    return projected as Error;
  }
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
