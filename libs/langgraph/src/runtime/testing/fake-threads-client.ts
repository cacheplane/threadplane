import type { LangGraphThreadsClient } from '../thread-directory';
import { deferred, type Deferred } from './deferred';

/** A seeded thread as the LangGraph threads API returns it. */
export interface FakeThread {
  readonly thread_id: string;
  readonly updated_at?: string;
  readonly metadata?: Record<string, unknown>;
}

/** A seeded or stored Store API item. */
export interface FakeStoreItem {
  readonly namespace: readonly string[];
  readonly key: string;
  readonly value: Record<string, unknown>;
}

export interface FakeThreadsClient extends LangGraphThreadsClient {
  /** Every `store.putItem` call, in order. */
  readonly puts: readonly FakeStoreItem[];
  /** Current Store API items. */
  readonly items: () => readonly FakeStoreItem[];
  /** Method names in call order, such as `'threads.search'`. */
  readonly calls: readonly string[];
  /** Current server-side threads, newest first. */
  readonly stored: () => readonly FakeThread[];
  /** Fails the next call of `method` with an error carrying `status`. */
  failNext(method: string, status: number): void;
  /** Holds the next call of `method` until the returned release is called. */
  hold(method: string): () => void;
}

/**
 * In-memory stand-in for the SDK's `threads` and `store` APIs. It records calls, merges
 * metadata on update and returns threads newest first, as the server lists
 * them. Only the members a thread directory uses are implemented. `storeSeed` seeds
 * Store API items, such as projects.
 */
export function createFakeThreadsClient(
  seed: readonly FakeThread[] = [],
  storeSeed: readonly FakeStoreItem[] = []
): FakeThreadsClient {
  const items = new Map<string, FakeStoreItem>();
  const puts: FakeStoreItem[] = [];
  const itemKey = (namespace: readonly string[], key: string) =>
    JSON.stringify([...namespace, key]);
  for (const item of storeSeed)
    items.set(itemKey(item.namespace, item.key), item);
  const threads = new Map<string, FakeThread>(
    seed.map((thread) => [thread.thread_id, clone(thread)])
  );
  const calls: string[] = [];
  const failures = new Map<string, number[]>();
  const holds = new Map<string, Deferred<void>[]>();
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  let created = 0;

  async function enter(method: string, signal?: AbortSignal): Promise<void> {
    calls.push(method);
    const held = holds.get(method)?.shift();
    if (held) await held.promise;
    if (signal?.aborted) {
      const error = new Error('AbortError');
      error.name = 'AbortError';
      throw error;
    }
    const status = failures.get(method)?.shift();
    if (status !== undefined)
      throw Object.assign(new Error(`Fake ${method} failed`), { status });
  }

  function now(): string {
    clock += 1000;
    return new Date(clock).toISOString();
  }

  function required(id: string): FakeThread {
    const thread = threads.get(id);
    if (!thread)
      throw Object.assign(new Error(`Fake thread ${id} not found`), {
        status: 404,
      });
    return thread;
  }

  function stored(): FakeThread[] {
    return [...threads.values()]
      .map(clone)
      .sort(
        (a, b) =>
          (Date.parse(b.updated_at ?? '') || 0) -
          (Date.parse(a.updated_at ?? '') || 0)
      );
  }

  const fakeThreads = {
    async search(query?: { signal?: AbortSignal }) {
      // Answers with the state at call time, as a server that was already
      // reading when a later write arrived.
      const answer = stored();
      await enter('threads.search', query?.signal);
      return answer;
    },
    async create(payload?: {
      metadata?: Record<string, unknown>;
      signal?: AbortSignal;
    }) {
      await enter('threads.create', payload?.signal);
      const thread: FakeThread = {
        thread_id: `thread-${++created}`,
        updated_at: now(),
        metadata: { ...payload?.metadata },
      };
      threads.set(thread.thread_id, thread);
      return clone(thread);
    },
    async update(
      id: string,
      payload?: { metadata?: Record<string, unknown>; signal?: AbortSignal }
    ) {
      await enter('threads.update', payload?.signal);
      const current = required(id);
      const next: FakeThread = {
        ...current,
        updated_at: now(),
        metadata: { ...current.metadata, ...payload?.metadata },
      };
      threads.set(id, next);
      return clone(next);
    },
    async delete(id: string, options?: { signal?: AbortSignal }) {
      await enter('threads.delete', options?.signal);
      required(id);
      threads.delete(id);
    },
  };

  const fakeStore = {
    async putItem(
      namespace: string[],
      key: string,
      value: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) {
      await enter('store.putItem', options?.signal);
      const item = { namespace: [...namespace], key, value: { ...value } };
      puts.push(item);
      items.set(itemKey(namespace, key), item);
    },
    async getItem(
      namespace: string[],
      key: string,
      options?: { signal?: AbortSignal }
    ) {
      await enter('store.getItem', options?.signal);
      const item = items.get(itemKey(namespace, key));
      return item ? { ...item, createdAt: '', updatedAt: '' } : null;
    },
    async deleteItem(
      namespace: string[],
      key: string,
      options?: { signal?: AbortSignal }
    ) {
      await enter('store.deleteItem', options?.signal);
      items.delete(itemKey(namespace, key));
    },
    async searchItems(
      prefix: string[],
      options?: { limit?: number; signal?: AbortSignal }
    ) {
      const answer = [...items.values()].filter((item) =>
        prefix.every((part, index) => item.namespace[index] === part)
      );
      await enter('store.searchItems', options?.signal);
      return {
        items: answer
          .slice(0, options?.limit ?? 10)
          .map((item) => ({ ...item, createdAt: '', updatedAt: '' })),
      };
    },
  };

  return {
    threads: fakeThreads as unknown as LangGraphThreadsClient['threads'],
    store: fakeStore as unknown as LangGraphThreadsClient['store'],
    puts,
    items: () => [...items.values()],
    calls,
    stored,
    failNext(method, status) {
      failures.set(method, [...(failures.get(method) ?? []), status]);
    },
    hold(method) {
      const gate = deferred<void>();
      holds.set(method, [...(holds.get(method) ?? []), gate]);
      return () => gate.resolve();
    },
  };
}

function clone(thread: FakeThread): FakeThread {
  return {
    ...thread,
    ...(thread.metadata ? { metadata: { ...thread.metadata } } : {}),
  };
}
