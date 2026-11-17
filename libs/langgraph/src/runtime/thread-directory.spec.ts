import type { Thread as SdkThread } from '@langchain/langgraph-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createThreadDirectory,
  type ThreadDirectoryClient,
} from './thread-directory';

type Metadata = Record<string, unknown>;

const saved = (
  id: string,
  metadata: Metadata | null = {},
  updated = '2026-11-01T10:00:00.000Z'
) =>
  ({ thread_id: id, metadata, updated_at: updated }) as unknown as SdkThread;

/** A deployment that keeps its threads in memory. */
function deployment(initial: SdkThread[] = []) {
  const store = new Map(initial.map((thread) => [thread.thread_id, thread]));
  const client = {
    search: vi.fn(async () => [...store.values()]),
    get: vi.fn(async (id: string) => {
      const found = store.get(id);
      if (found === undefined) throw Object.assign(new Error('missing'), { status: 404 });
      return found;
    }),
    create: vi.fn(async ({ metadata }: { metadata: Metadata }) => {
      const created = saved(`new-${store.size}`, metadata);
      store.set(created.thread_id, created);
      return created;
    }),
    update: vi.fn(async (id: string, { metadata }: { metadata: Metadata }) => {
      const found = store.get(id);
      if (found === undefined) throw new Error('missing');
      store.set(id, saved(id, { ...(found.metadata as Metadata), ...metadata }));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  } satisfies ThreadDirectoryClient;
  return { client, store };
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('createThreadDirectory', () => {
  it('starts idle and empty with a stable snapshot, and reads nothing by itself', () => {
    const { client } = deployment([saved('a')]);
    const directory = createThreadDirectory({ threads: client });
    const first = directory.getSnapshot();
    expect(first).toEqual({ threads: [], archived: [], status: 'idle' });
    expect(directory.getSnapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('reads thread metadata into entries, pinned first in saved order, archived apart', async () => {
    const { client } = deployment([
      saved('plain', { title: 'Plain' }),
      saved('late-pin', { title: 'Late', pinned: true, pinnedOrder: 2 }),
      saved('gone', { title: 'Gone', archived: true }),
      saved('first-pin', { pinned: true, pinnedOrder: 0, projectId: 'p1' }),
      saved('unordered-pin', { pinned: true }),
      saved('bare', null, 'not a date'),
    ]);
    const directory = createThreadDirectory({ threads: client, limit: 20 });
    await directory.refresh();
    const snapshot = directory.getSnapshot();
    expect(client.search).toHaveBeenCalledWith({ limit: 20 });
    expect(snapshot.status).toBe('ready');
    expect(ids(snapshot.threads)).toEqual([
      'first-pin',
      'late-pin',
      'unordered-pin',
      'plain',
      'bare',
    ]);
    expect(ids(snapshot.archived)).toEqual(['gone']);
    expect(snapshot.threads[0]).toEqual({
      id: 'first-pin',
      title: 'Untitled',
      status: 'active',
      pinned: true,
      projectId: 'p1',
      pinnedOrder: 0,
      updatedAt: Date.parse('2026-11-01T10:00:00.000Z'),
    });
    // No saved order, no project, and a date that does not parse.
    expect(snapshot.threads[4]).toEqual({
      id: 'bare',
      title: 'Untitled',
      status: 'active',
      pinned: false,
      projectId: null,
    });
    expect(snapshot.archived[0].status).toBe('archived');
    expect(Object.isFrozen(snapshot.threads)).toBe(true);
  });

  it('uses titleFallback for an empty or missing title', async () => {
    const { client } = deployment([saved('a', { title: '' }), saved('b')]);
    const directory = createThreadDirectory({
      threads: client,
      titleFallback: 'New chat',
    });
    await directory.refresh();
    expect(directory.getSnapshot().threads.map((t) => t.title)).toEqual([
      'New chat',
      'New chat',
    ]);
  });

  it('notifies subscribers for loading and the result, until they unsubscribe', async () => {
    const { client } = deployment([saved('a')]);
    const directory = createThreadDirectory({ threads: client });
    const seen: string[] = [];
    const stop = directory.subscribe(() =>
      seen.push(directory.getSnapshot().status)
    );
    await directory.refresh();
    expect(seen).toEqual(['loading', 'ready']);
    stop();
    await directory.refresh();
    expect(seen).toHaveLength(2);
  });

  it('publishes a failed read as an error and keeps the last list', async () => {
    const { client } = deployment([saved('a', { title: 'Kept' })]);
    const directory = createThreadDirectory({ threads: client });
    await directory.refresh();
    const failure = new Error('offline');
    client.search.mockRejectedValueOnce(failure);
    await expect(directory.refresh()).resolves.toBeUndefined();
    const failed = directory.getSnapshot();
    expect(failed.status).toBe('error');
    expect(failed.error).toBe(failure);
    expect(ids(failed.threads)).toEqual(['a']);
    await directory.refresh();
    expect(directory.getSnapshot()).toMatchObject({ status: 'ready' });
    expect(directory.getSnapshot()).not.toHaveProperty('error');
  });

  it('keeps the newer read when an older one answers later', async () => {
    const { client } = deployment();
    let answerOld: (threads: SdkThread[]) => void = () => undefined;
    client.search
      .mockImplementationOnce(
        () => new Promise<SdkThread[]>((resolve) => (answerOld = resolve))
      )
      .mockResolvedValueOnce([saved('new')]);
    const directory = createThreadDirectory({ threads: client });
    const old = directory.refresh();
    await directory.refresh();
    answerOld([saved('old')]);
    await old;
    expect(ids(directory.getSnapshot().threads)).toEqual(['new']);
    expect(directory.getSnapshot().status).toBe('ready');
  });

  it('writes each command as metadata, then reads the list again', async () => {
    const { client } = deployment([saved('a', { title: 'A' })]);
    const directory = createThreadDirectory({ threads: client });
    await directory.refresh();

    await directory.rename('a', 'Renamed');
    expect(client.update).toHaveBeenLastCalledWith('a', { metadata: { title: 'Renamed' } });
    expect(directory.getSnapshot().threads[0].title).toBe('Renamed');

    await directory.pin('a');
    expect(directory.getSnapshot().threads[0].pinned).toBe(true);
    await directory.unpin('a');
    expect(client.update).toHaveBeenLastCalledWith('a', { metadata: { pinned: false } });
    expect(directory.getSnapshot().threads[0].pinned).toBe(false);

    await directory.moveToProject('a', 'p1');
    expect(directory.getSnapshot().threads[0].projectId).toBe('p1');
    await directory.moveToProject('a', null);
    expect(client.update).toHaveBeenLastCalledWith('a', { metadata: { projectId: null } });
    expect(directory.getSnapshot().threads[0].projectId).toBeNull();

    await directory.archive('a');
    expect(ids(directory.getSnapshot().threads)).toEqual([]);
    expect(ids(directory.getSnapshot().archived)).toEqual(['a']);
    await directory.unarchive('a');
    expect(ids(directory.getSnapshot().threads)).toEqual(['a']);

    await directory.delete('a');
    expect(client.delete).toHaveBeenCalledWith('a');
    expect(directory.getSnapshot().threads).toEqual([]);
  });

  it('creates a conversation, lists it and resolves with its ID', async () => {
    const { client } = deployment();
    const directory = createThreadDirectory({ threads: client });
    const id = await directory.create({ title: 'Trip' });
    expect(client.create).toHaveBeenCalledWith({ metadata: { title: 'Trip' } });
    expect(directory.getSnapshot().threads).toMatchObject([{ id, title: 'Trip' }]);
    await directory.create();
    expect(client.create).toHaveBeenLastCalledWith({ metadata: {} });
  });

  it('rejects a failed command without reading the list again', async () => {
    const { client } = deployment([saved('a')]);
    const directory = createThreadDirectory({ threads: client });
    await directory.refresh();
    const before = directory.getSnapshot();
    const failure = new Error('forbidden');
    client.update.mockRejectedValueOnce(failure);
    await expect(directory.rename('a', 'X')).rejects.toBe(failure);
    client.delete.mockRejectedValueOnce(failure);
    await expect(directory.delete('a')).rejects.toBe(failure);
    client.create.mockRejectedValueOnce(failure);
    await expect(directory.create()).rejects.toBe(failure);
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(directory.getSnapshot()).toBe(before);
  });

  it('gets one conversation, null for an unknown or malformed ID, and rethrows other failures', async () => {
    const { client } = deployment([saved('a', { title: 'A' })]);
    const directory = createThreadDirectory({ threads: client });
    await expect(directory.get('a')).resolves.toMatchObject({ id: 'a', title: 'A' });
    await expect(directory.get('nope')).resolves.toBeNull();
    client.get.mockRejectedValueOnce({ response: { status: 422 } });
    await expect(directory.get('bad id')).resolves.toBeNull();
    const failure = Object.assign(new Error('down'), { status: 503 });
    client.get.mockRejectedValueOnce(failure);
    await expect(directory.get('a')).rejects.toBe(failure);
    client.get.mockRejectedValueOnce('offline');
    await expect(directory.get('a')).rejects.toBe('offline');
  });

  describe('reorderPinned', () => {
    async function pinned() {
      const { client, store } = deployment([
        saved('a', { pinned: true, pinnedOrder: 0 }),
        saved('b', { pinned: true, pinnedOrder: 1 }),
        saved('c', { pinned: true, pinnedOrder: 2 }),
        saved('loose'),
      ]);
      const directory = createThreadDirectory({ threads: client });
      await directory.refresh();
      const order = () =>
        ids(directory.getSnapshot().threads.filter((t) => t.pinned));
      return { client, store, directory, order };
    }

    it('places a pinned conversation before another and renumbers them all', async () => {
      const { client, directory, order } = await pinned();
      await directory.reorderPinned('c', 'a');
      expect(order()).toEqual(['c', 'a', 'b']);
      expect(client.update.mock.calls).toEqual([
        ['c', { metadata: { pinnedOrder: 0 } }],
        ['a', { metadata: { pinnedOrder: 1 } }],
        ['b', { metadata: { pinnedOrder: 2 } }],
      ]);
    });

    it('places it last for null, or for a target that is not pinned', async () => {
      const { directory, order } = await pinned();
      await directory.reorderPinned('a', null);
      expect(order()).toEqual(['b', 'c', 'a']);
      await directory.reorderPinned('b', 'loose');
      expect(order()).toEqual(['c', 'a', 'b']);
    });

    it('does nothing for a conversation that is not pinned', async () => {
      const { client, directory, order } = await pinned();
      await directory.reorderPinned('loose', 'a');
      expect(client.update).not.toHaveBeenCalled();
      expect(order()).toEqual(['a', 'b', 'c']);
    });
  });

  it('builds its own client from apiUrl when no threads client is supplied', async () => {
    const requests: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      requests.push(input instanceof Request ? input.url : String(input));
      return new Response(JSON.stringify([saved('remote', { title: 'Remote' })]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const directory = createThreadDirectory({
        apiUrl: 'http://deployment.test/api',
        clientOptions: { maxRetries: 0 },
      });
      await directory.refresh();
      expect(directory.getSnapshot()).toMatchObject({
        status: 'ready',
        threads: [{ id: 'remote', title: 'Remote' }],
      });
      expect(requests).toEqual(['http://deployment.test/api/threads/search']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
