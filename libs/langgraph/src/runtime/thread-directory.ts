import type {
  AgentError,
  PlainValue,
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
import type { ProjectStore } from './project-store.js';
import {
  orderThreads,
  projectThread,
  type ProjectedThread,
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
  /** Project names. `false` turns projects off. */
  readonly projects?: ProjectStore | false;
}

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
  options: LangGraphThreadDirectoryOptions
): ThreadDirectory {
  const client = options.client ?? ownedClient(options);
  const titleFallback = options.titleFallback ?? 'New chat';
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const pending = new Set<Patch>();
  let server: readonly ProjectedThread[] = [];
  let snapshot: ThreadDirectorySnapshot = Object.freeze({
    threads: Object.freeze([]),
    archived: Object.freeze([]),
    status: 'idle',
  });
  let error: AgentError | undefined;
  let started = 0;
  let applied = 0;
  let inFlight = 0;

  const disposed = () => lifetime.signal.aborted;

  function publish(): void {
    if (disposed()) return;
    const previous = new Map(
      [...snapshot.threads, ...snapshot.archived].map((entry) => [
        entry.id,
        entry as ProjectedThread,
      ])
    );
    const entries: ProjectedThread[] = [];
    for (const base of server) {
      let entry: ProjectedThread | undefined = base;
      for (const patch of pending)
        if (patch.id === base.id) entry = entry && applyPatch(entry, patch.fields);
      if (!entry) continue;
      const kept = previous.get(entry.id);
      entries.push(kept && sameEntry(kept, entry) ? kept : entry);
    }
    const ordered = orderThreads(entries);
    const status =
      inFlight > 0 ? 'loading' : error !== undefined ? 'error' : 'idle';
    const next: ThreadDirectorySnapshot = Object.freeze({
      threads: sameList(snapshot.threads, ordered.threads)
        ? snapshot.threads
        : Object.freeze(ordered.threads),
      archived: sameList(snapshot.archived, ordered.archived)
        ? snapshot.archived
        : Object.freeze(ordered.archived),
      status,
      ...(error === undefined ? {} : { error }),
    });
    if (
      next.threads === snapshot.threads &&
      next.archived === snapshot.archived &&
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
    try {
      outcome = {
        list: await client.threads.search({ limit: 50, offset: 0, signal }),
      };
    } catch (failure) {
      outcome = { failed: failure };
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
    rename: (id: string, title: string) =>
      mutate([{ id, fields: { title } }], update(id, { title })),
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
    dispose() {
      lifetime.abort();
      listeners.clear();
    },
  });
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
