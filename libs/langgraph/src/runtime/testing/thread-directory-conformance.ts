import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadDirectory } from '@threadplane/core';
import type { LangGraphThreadsClient } from '../thread-directory';
import { createFakeThreadsClient, type FakeThread } from './fake-threads-client';

type Make = (client: LangGraphThreadsClient) => {
  directory: ThreadDirectory;
  teardown?(): void;
};

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

/**
 * Behaviour every LangGraph-backed `ThreadDirectory` shares. Each case builds
 * a fresh fake threads client and a fresh subject from `make`.
 */
export function describeThreadDirectoryConformance(
  name: string,
  make: Make
): void {
  describe(`ThreadDirectory conformance: ${name}`, () => {
    const teardowns: (() => void)[] = [];

    afterEach(() => {
      for (const teardown of teardowns.splice(0)) teardown();
    });

    function setup(seed: readonly FakeThread[]) {
      const client = createFakeThreadsClient(seed);
      const subject = make(client);
      teardowns.push(() => {
        subject.directory.dispose();
        subject.teardown?.();
      });
      return { client, directory: subject.directory };
    }

    const entry = (directory: ThreadDirectory, id: string) =>
      [
        ...directory.getSnapshot().threads,
        ...directory.getSnapshot().archived,
      ].find((thread) => thread.id === id);

    const metadata = (
      client: ReturnType<typeof createFakeThreadsClient>,
      id: string
    ) => client.stored().find((thread) => thread.thread_id === id)?.metadata;

    it('lists active and archived threads in pin order', async () => {
      const { directory } = setup([
        { thread_id: 'old', updated_at: at(1), metadata: { title: 'Old' } },
        {
          thread_id: 'pin-1',
          updated_at: at(2),
          metadata: { title: 'Pin 1', pinned: true, pinnedOrder: 1 },
        },
        {
          thread_id: 'gone',
          updated_at: at(3),
          metadata: { title: 'Gone', archived: true },
        },
        {
          thread_id: 'pin-0',
          updated_at: at(4),
          metadata: { title: 'Pin 0', pinned: true, pinnedOrder: 0 },
        },
        { thread_id: 'new', updated_at: at(5), metadata: { title: 'New' } },
      ]);

      await directory.refresh();

      const snapshot = directory.getSnapshot();
      expect(snapshot.threads.map((t) => t.id)).toEqual([
        'pin-0',
        'pin-1',
        'new',
        'old',
      ]);
      expect(snapshot.archived.map((t) => t.id)).toEqual(['gone']);
      expect(snapshot.status).toBe('idle');
      expect(snapshot.error).toBeUndefined();
    });

    it('projects malformed metadata with fallbacks', async () => {
      const { directory } = setup([
        {
          thread_id: 'a',
          updated_at: at(1),
          metadata: {
            title: '  ',
            pinned: 'true',
            pinnedOrder: '2',
            projectId: '',
            archived: 'yes',
          },
        },
      ]);

      await directory.refresh();

      expect(directory.getSnapshot().threads).toHaveLength(1);
      const thread = entry(directory, 'a');
      expect(thread?.title).toBe('New chat');
      expect(thread?.pinned).toBe(false);
      expect(thread?.archived).toBe(false);
      expect(thread?.projectId).toBeNull();
    });

    it('exposes a load error and clears it on success', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      client.failNext('threads.search', 500);

      await expect(directory.refresh()).resolves.toBeUndefined();

      const failed = directory.getSnapshot();
      expect(failed.status).toBe('error');
      expect(failed.error?.kind).toBe('server');
      expect(failed.error?.recovery).toBe('retry');
      expect(failed.error?.message).toBe('The LangGraph request failed.');

      await directory.refresh();

      const recovered = directory.getSnapshot();
      expect(recovered.status).toBe('idle');
      expect(recovered.error).toBeUndefined();
      expect(recovered.threads.map((t) => t.id)).toEqual(['a']);
    });

    it('renames optimistically and confirms with a refresh', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      await directory.refresh();
      const release = client.hold('threads.update');

      const renaming = directory.rename?.('a', 'Trip');

      expect(entry(directory, 'a')?.title).toBe('Trip');
      const updateIndex = client.calls.lastIndexOf('threads.update');
      release();
      await renaming;
      expect(client.calls.lastIndexOf('threads.search')).toBeGreaterThan(
        updateIndex
      );
      expect(entry(directory, 'a')?.title).toBe('Trip');
      expect(metadata(client, 'a')?.['title']).toBe('Trip');
    });

    it('rolls back a failed rename and rejects', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      await directory.refresh();
      client.failNext('threads.update', 500);

      const error = await directory.rename?.('a', 'Trip').then(
        () => undefined,
        (reason: unknown) => reason
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('The LangGraph request failed.');
      expect(entry(directory, 'a')?.title).toBe('A');
    });

    it('keeps a pending rename across a refresh that started earlier', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      await directory.refresh();
      const releaseSearch = client.hold('threads.search');
      const refreshing = directory.refresh();
      const releaseUpdate = client.hold('threads.update');
      const renaming = directory.rename?.('a', 'Trip');

      releaseSearch();
      await refreshing;

      expect(entry(directory, 'a')?.title).toBe('Trip');
      releaseUpdate();
      await renaming;
      expect(entry(directory, 'a')?.title).toBe('Trip');
    });

    it('archives, pins and reorders with the existing metadata keys', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
        { thread_id: 'b', updated_at: at(2), metadata: { title: 'B' } },
        {
          thread_id: 'c',
          updated_at: at(3),
          metadata: { title: 'C', pinned: true, pinnedOrder: 0 },
        },
        {
          thread_id: 'd',
          updated_at: at(4),
          metadata: { title: 'D', pinned: true, pinnedOrder: 1 },
        },
      ]);
      await directory.refresh();

      await directory.setArchived?.('a', true);
      await directory.setPinned?.('b', true);
      await directory.reorderPinned?.('c', 'b');

      expect(metadata(client, 'a')?.['archived']).toBe(true);
      expect(metadata(client, 'b')?.['pinned']).toBe(true);
      expect(
        ['d', 'c', 'b'].map((id) => metadata(client, id)?.['pinnedOrder'])
      ).toEqual([0, 1, 2]);
      const snapshot = directory.getSnapshot();
      expect(snapshot.threads.map((t) => t.id)).toEqual(['d', 'c', 'b']);
      expect(snapshot.archived.map((t) => t.id)).toEqual(['a']);
    });

    it('removes a thread', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
        { thread_id: 'b', updated_at: at(2), metadata: { title: 'B' } },
      ]);
      await directory.refresh();

      await directory.remove?.('a');

      expect(entry(directory, 'a')).toBeUndefined();
      expect(client.stored().map((t) => t.thread_id)).toEqual(['b']);
    });

    it('creates a thread with metadata', async () => {
      const { directory } = setup([]);

      const created = await directory.create?.({
        metadata: { projectId: 'p1' },
      });

      expect(created?.id).toEqual(expect.any(String));
      expect(entry(directory, created?.id ?? '')?.projectId).toBe('p1');
    });

    it('does not notify after dispose', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      const notify = vi.fn();
      directory.subscribe(notify);
      const release = client.hold('threads.search');
      const refreshing = directory.refresh();

      directory.dispose();
      const before = notify.mock.calls.length;
      release();
      await refreshing;

      expect(notify).toHaveBeenCalledTimes(before);
      expect(directory.getSnapshot().threads).toEqual([]);
    });
  });
}
