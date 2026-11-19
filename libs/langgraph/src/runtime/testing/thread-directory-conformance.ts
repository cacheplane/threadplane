import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadDirectory } from '@threadplane/core';
import type { LangGraphThreadsClient } from '../thread-directory';
import { createFakeThreadsClient, type FakeThread } from './fake-threads-client';

/** What a conformance subject offers beyond threads. */
export interface ThreadDirectoryConformanceOptions {
  /** The subject keeps projects in the default Store namespace. */
  readonly projects?: boolean;
}

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
  make: Make,
  options: ThreadDirectoryConformanceOptions = {}
): void {
  const withProjects = options.projects === true;
  describe(`ThreadDirectory conformance: ${name}`, () => {
    const teardowns: (() => void)[] = [];

    afterEach(() => {
      for (const teardown of teardowns.splice(0)) teardown();
    });

    function setup(
      seed: readonly FakeThread[],
      projects: readonly { id: string; name: string }[] = []
    ) {
      const client = createFakeThreadsClient(
        seed,
        projects.map((project) => ({
          namespace: ['threadplane', 'projects'],
          key: project.id,
          value: { name: project.name },
        }))
      );
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

    it('trims a renamed title and shows the fallback for a blank one', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      await directory.refresh();
      const release = client.hold('threads.update');

      const blank = directory.rename?.('a', '   ');

      expect(entry(directory, 'a')?.title).toBe('New chat');
      release();
      await blank;
      expect(entry(directory, 'a')?.title).toBe('New chat');

      await directory.rename?.('a', '  Trip  ');
      expect(entry(directory, 'a')?.title).toBe('Trip');
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

    it('does not notify or write after dispose', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      const notify = vi.fn();
      directory.subscribe(notify);
      const release = client.hold('threads.search');
      const refreshing = directory.refresh();
      const before = directory.getSnapshot();

      directory.dispose();
      const notified = notify.mock.calls.length;
      release();
      await refreshing;

      expect(notify).toHaveBeenCalledTimes(notified);
      expect(directory.getSnapshot()).toBe(before);
      expect(directory.getSnapshot().threads).toEqual([]);
    });

    it('does not flicker back when a refresh that began before a rename resolves late', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      await directory.refresh();
      const releaseStale = client.hold('threads.search');
      const stale = directory.refresh();
      const releaseConfirm = client.hold('threads.search');
      const titles: (string | undefined)[] = [];
      directory.subscribe(() => titles.push(entry(directory, 'a')?.title));

      const renaming = directory.rename?.('a', 'Trip');
      // Let the update settle and the confirming refresh start.
      await vi.waitFor(() =>
        expect(client.calls.filter((c) => c === 'threads.search')).toHaveLength(3)
      );
      releaseStale();
      await stale;
      expect(entry(directory, 'a')?.title).toBe('Trip');
      releaseConfirm();
      await renaming;

      expect(entry(directory, 'a')?.title).toBe('Trip');
      expect(titles).not.toContain('A');
    });

    it('does not carry pinnedOrder on published entries', async () => {
      const { directory } = setup([
        {
          thread_id: 'a',
          updated_at: at(1),
          metadata: { title: 'A', pinned: true, pinnedOrder: 3 },
        },
      ]);
      await directory.refresh();
      const first = entry(directory, 'a');
      await directory.refresh();

      expect(first).toBeDefined();
      expect('pinnedOrder' in (first as object)).toBe(false);
      expect(entry(directory, 'a')).toBe(first);
      await directory.setPinned?.('a', true);
      expect('pinnedOrder' in (entry(directory, 'a') as object)).toBe(false);
    });

    it('appends a pinned thread moved before an unknown id', async () => {
      const { client, directory } = setup([
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

      await directory.reorderPinned?.('c', 'missing');

      expect(directory.getSnapshot().threads.map((t) => t.id)).toEqual([
        'd',
        'c',
      ]);
      expect(
        ['d', 'c'].map((id) => metadata(client, id)?.['pinnedOrder'])
      ).toEqual([0, 1]);
    });

    it('does not show loading during a background refresh', async () => {
      const { client, directory } = setup([
        { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
      ]);
      const statuses: string[] = [];
      directory.subscribe(() => statuses.push(directory.getSnapshot().status));
      const first = directory.refresh();
      expect(directory.getSnapshot().status).toBe('loading');
      await first;
      statuses.length = 0;

      const release = client.hold('threads.search');
      const refreshing = directory.refresh();
      expect(directory.getSnapshot().status).toBe('idle');
      release();
      await refreshing;
      await directory.rename?.('a', 'Trip');

      expect(directory.getSnapshot().status).toBe('idle');
      expect(statuses).not.toContain('loading');

      client.failNext('threads.search', 500);
      await directory.refresh();
      expect(directory.getSnapshot().status).toBe('error');
      const recovery = client.hold('threads.search');
      const recovering = directory.refresh();
      expect(directory.getSnapshot().status).toBe('loading');
      recovery();
      await recovering;
      expect(directory.getSnapshot().status).toBe('idle');
    });

    it.skipIf(!withProjects)(
      'lists, creates, renames and removes projects',
      async () => {
        const { client, directory } = setup(
          [],
          [
            { id: 'p2', name: 'Zed' },
            { id: 'p1', name: 'Alpha' },
          ]
        );
        await directory.refresh();
        expect(directory.getSnapshot().projects).toEqual([
          { id: 'p1', name: 'Alpha' },
          { id: 'p2', name: 'Zed' },
        ]);

        const created = await directory.createProject?.('  Trips ');
        await directory.renameProject?.('p2', 'Work');
        await directory.removeProject?.('p1');

        expect(created?.id).toEqual(expect.any(String));
        expect(directory.getSnapshot().projects?.map((p) => p.name)).toEqual([
          'Trips',
          'Work',
        ]);
        expect(client.items()).toHaveLength(2);
        await expect(directory.createProject?.('  ')).rejects.toThrow(
          'Project name is required'
        );
      }
    );

    it.skipIf(!withProjects)('moves threads out of a removed project', async () => {
      const { client, directory } = setup(
        [
          {
            thread_id: 'a',
            updated_at: at(1),
            metadata: { title: 'A', projectId: 'p1' },
          },
          {
            thread_id: 'b',
            updated_at: at(2),
            metadata: { title: 'B', projectId: 'p1', archived: true },
          },
          {
            thread_id: 'c',
            updated_at: at(3),
            metadata: { title: 'C', projectId: 'p2' },
          },
        ],
        [
          { id: 'p1', name: 'One' },
          { id: 'p2', name: 'Two' },
        ]
      );
      await directory.refresh();
      expect(entry(directory, 'a')?.projectId).toBe('p1');

      await directory.removeProject?.('p1');

      expect(entry(directory, 'a')?.projectId).toBeNull();
      expect(entry(directory, 'b')?.projectId).toBeNull();
      expect(entry(directory, 'c')?.projectId).toBe('p2');
      expect(metadata(client, 'a')?.['projectId']).toBeNull();
      expect(directory.getSnapshot().projects).toEqual([
        { id: 'p2', name: 'Two' },
      ]);
      expect(client.items().map((item) => item.key)).toEqual(['p2']);
    });

    it.skipIf(!withProjects)(
      'lists threads when the project store is unavailable',
      async () => {
        const { client, directory } = setup([
          { thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } },
        ]);
        client.failNext('store.searchItems', 404);

        await directory.refresh();

        const snapshot = directory.getSnapshot();
        expect(snapshot.status).toBe('idle');
        expect(snapshot.error).toBeUndefined();
        expect(snapshot.threads.map((t) => t.id)).toEqual(['a']);
        expect(snapshot.projects).toBeUndefined();
        await expect(directory.createProject?.('Trips')).rejects.toThrow(
          'The LangGraph request failed.'
        );
        expect(client.puts).toEqual([]);
      }
    );

    it.skipIf(!withProjects)(
      'stops publishing projects when the project store later fails',
      async () => {
        const { client, directory } = setup(
          [{ thread_id: 'a', updated_at: at(1), metadata: { title: 'A' } }],
          [{ id: 'p1', name: 'One' }]
        );
        await directory.refresh();
        expect(directory.getSnapshot().projects).toEqual([
          { id: 'p1', name: 'One' },
        ]);
        client.failNext('store.searchItems', 500);

        await directory.refresh();

        expect(directory.getSnapshot().projects).toBeUndefined();
        expect(directory.getSnapshot().threads.map((t) => t.id)).toEqual([
          'a',
        ]);

        await directory.refresh();

        expect(directory.getSnapshot().projects).toEqual([
          { id: 'p1', name: 'One' },
        ]);
      }
    );
  });
}
