import type { Thread as SdkThread } from '@langchain/langgraph-sdk';
import { createLangGraphClient } from '../lib/client/create-langgraph-client.js';
import type { LangGraphClientOptions } from './transport.types.js';

/** One conversation as a list shows it, read from the saved thread's metadata. */
export interface ThreadDirectoryEntry {
  readonly id: string;
  /** `metadata.title`, or the directory's `titleFallback` while none is saved. */
  readonly title: string;
  /** Archived when `metadata.archived` is true. */
  readonly status: 'active' | 'archived';
  readonly pinned: boolean;
  readonly projectId: string | null;
  /** Position among pinned conversations, when one has been saved. */
  readonly pinnedOrder?: number;
  /** Milliseconds since the epoch. */
  readonly updatedAt?: number;
}

export interface ThreadDirectorySnapshot {
  /** Conversations that are not archived, pinned ones first in their saved order. */
  readonly threads: readonly ThreadDirectoryEntry[];
  readonly archived: readonly ThreadDirectoryEntry[];
  /**
   * `idle` before the first read. `error` means the latest read failed; the
   * lists keep what the last successful read returned.
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** The failure of the latest read, while `status` is `error`. */
  readonly error?: unknown;
}

/** The part of the SDK's `client.threads` the directory calls. */
export interface ThreadDirectoryClient {
  search(query: { limit: number }): Promise<readonly SdkThread[]>;
  get(threadId: string): Promise<SdkThread>;
  create(payload: { metadata: Record<string, unknown> }): Promise<SdkThread>;
  update(
    threadId: string,
    payload: { metadata: Record<string, unknown> }
  ): Promise<unknown>;
  delete(threadId: string): Promise<unknown>;
}

export interface ThreadDirectoryOptions {
  /** Where the directory builds its own client. Unused when `threads` is supplied. */
  readonly apiUrl?: string;
  readonly clientOptions?: LangGraphClientOptions;
  /** An existing `client.threads`, in place of a client built from `apiUrl`. */
  readonly threads?: ThreadDirectoryClient;
  /** Title for a conversation that has none saved. Defaults to "Untitled". */
  readonly titleFallback?: string;
  /** How many conversations one read asks for. Defaults to 50. */
  readonly limit?: number;
}

/**
 * The saved conversations of a LangGraph deployment, as an observable list.
 * Every command writes thread metadata, then reads the list again, and rejects
 * when the write fails. The command names match the conversation list's
 * action adapter, so the directory can be passed as that adapter.
 */
export interface ThreadDirectory {
  getSnapshot(): ThreadDirectorySnapshot;
  subscribe(notify: () => void): () => void;
  /** Reads the list. Never rejects: a failure is published as `status: 'error'`. */
  refresh(): Promise<void>;
  /** One conversation, or null when the deployment has none with that ID. */
  get(threadId: string): Promise<ThreadDirectoryEntry | null>;
  /** Creates a conversation and resolves with its ID. */
  create(metadata?: Record<string, unknown>): Promise<string>;
  delete(threadId: string): Promise<void>;
  rename(threadId: string, title: string): Promise<void>;
  archive(threadId: string): Promise<void>;
  unarchive(threadId: string): Promise<void>;
  pin(threadId: string): Promise<void>;
  unpin(threadId: string): Promise<void>;
  /** Null removes the conversation from its project. */
  moveToProject(threadId: string, projectId: string | null): Promise<void>;
  /** Places a pinned conversation before another pinned one, or last for null. */
  reorderPinned(threadId: string, beforeId: string | null): Promise<void>;
}

const EMPTY: readonly ThreadDirectoryEntry[] = Object.freeze([]);

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === 'number') return direct;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const nested = (response as { status?: unknown }).status;
  return typeof nested === 'number' ? nested : undefined;
}

function pinnedFirst(a: ThreadDirectoryEntry, b: ThreadDirectoryEntry) {
  if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
  if (!a.pinned) return 0;
  return (a.pinnedOrder ?? Infinity) - (b.pinnedOrder ?? Infinity) || 0;
}

/** Creates the conversation directory for one LangGraph deployment. */
export function createThreadDirectory(
  options: ThreadDirectoryOptions
): ThreadDirectory {
  const client: ThreadDirectoryClient =
    options.threads ??
    (createLangGraphClient(options.apiUrl ?? '', options.clientOptions)
      .threads as ThreadDirectoryClient);
  const fallback = options.titleFallback ?? 'Untitled';
  const limit = options.limit ?? 50;
  const listeners = new Set<() => void>();
  let snapshot: ThreadDirectorySnapshot = Object.freeze({
    threads: EMPTY,
    archived: EMPTY,
    status: 'idle',
  });
  let latestRead = 0;

  function publish(next: ThreadDirectorySnapshot) {
    snapshot = Object.freeze(next);
    for (const notify of [...listeners]) notify();
  }

  function entry(thread: SdkThread): ThreadDirectoryEntry {
    const metadata = (thread.metadata ?? {}) as Record<string, unknown>;
    const title = metadata['title'];
    const projectId = metadata['projectId'];
    const pinnedOrder = metadata['pinnedOrder'];
    const updatedAt =
      typeof thread.updated_at === 'string'
        ? Date.parse(thread.updated_at)
        : NaN;
    return Object.freeze({
      id: thread.thread_id,
      title: typeof title === 'string' && title.length > 0 ? title : fallback,
      status: metadata['archived'] === true ? 'archived' : 'active',
      pinned: metadata['pinned'] === true,
      projectId:
        typeof projectId === 'string' && projectId.length > 0
          ? projectId
          : null,
      ...(typeof pinnedOrder === 'number' ? { pinnedOrder } : {}),
      ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    });
  }

  async function refresh(): Promise<void> {
    const read = ++latestRead;
    publish({
      threads: snapshot.threads,
      archived: snapshot.archived,
      status: 'loading',
    });
    try {
      const entries = (await client.search({ limit })).map(entry);
      // A slower earlier read must not replace a later one's result.
      if (read !== latestRead) return;
      publish({
        threads: Object.freeze(
          entries.filter((item) => item.status === 'active').sort(pinnedFirst)
        ),
        archived: Object.freeze(
          entries.filter((item) => item.status === 'archived')
        ),
        status: 'ready',
      });
    } catch (error) {
      if (read !== latestRead) return;
      publish({
        threads: snapshot.threads,
        archived: snapshot.archived,
        status: 'error',
        error,
      });
    }
  }

  async function write(threadId: string, metadata: Record<string, unknown>) {
    await client.update(threadId, { metadata });
    await refresh();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    refresh,
    async get(threadId) {
      try {
        return entry(await client.get(threadId));
      } catch (error) {
        // 404 is an unknown ID; 422 is an ID the deployment cannot parse.
        const status = statusOf(error);
        if (status === 404 || status === 422) return null;
        throw error;
      }
    },
    async create(metadata = {}) {
      const created = await client.create({ metadata });
      await refresh();
      return created.thread_id;
    },
    async delete(threadId) {
      await client.delete(threadId);
      await refresh();
    },
    rename: (threadId, title) => write(threadId, { title }),
    archive: (threadId) => write(threadId, { archived: true }),
    unarchive: (threadId) => write(threadId, { archived: false }),
    pin: (threadId) => write(threadId, { pinned: true }),
    unpin: (threadId) => write(threadId, { pinned: false }),
    moveToProject: (threadId, projectId) => write(threadId, { projectId }),
    async reorderPinned(threadId, beforeId) {
      const pinned = snapshot.threads.filter((item) => item.pinned);
      const moved = pinned.find((item) => item.id === threadId);
      if (moved === undefined) return;
      const order: ThreadDirectoryEntry[] = [];
      for (const item of pinned) {
        if (item.id === threadId) continue;
        if (item.id === beforeId) order.push(moved);
        order.push(item);
      }
      if (!order.includes(moved)) order.push(moved);
      await Promise.all(
        order.map((item, pinnedOrder) =>
          client.update(item.id, { metadata: { pinnedOrder } })
        )
      );
      await refresh();
    },
  };
}
