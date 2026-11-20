import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoThreadDirectoryConfig } from './demo-threads';

describe('demoThreadDirectoryConfig — reading one thread', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answers every request the SDK client makes with one response. */
  function respondWith(status: number, body: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function createDirectory(reportOperationFailure?: (kind: string) => void) {
    const config = demoThreadDirectoryConfig();
    // The directory reads one thread itself: the app configures no reader.
    expect(config.getThread).toBeUndefined();
    return config.createDirectory({
      clientOptions: { maxRetries: 0 },
      reportOperationFailure,
    });
  }

  async function readThread(threadId: string) {
    const directory = createDirectory();
    try {
      return await directory.get(threadId);
    } finally {
      directory.dispose();
    }
  }

  it('resolves the thread the backend returns', async () => {
    const fetchMock = respondWith(200, {
      thread_id: 't-1',
      updated_at: '2026-11-20T10:00:00.000Z',
      metadata: { title: '  Backup cleanup  ', pinned: true, archived: true, projectId: 'p-1' },
    });
    await expect(readThread('t-1')).resolves.toMatchObject({
      id: 't-1',
      title: 'Backup cleanup',
      pinned: true,
      archived: true,
      projectId: 'p-1',
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/threads\/t-1$/);
  });

  it('falls back to "New chat" for a thread without a title', async () => {
    respondWith(200, { thread_id: 't-2', metadata: null });
    await expect(readThread('t-2')).resolves.toMatchObject({
      id: 't-2',
      title: 'New chat',
      pinned: false,
      archived: false,
    });
  });

  it.each([404, 422])('resolves null when the backend answers %i: no such thread', async (status) => {
    respondWith(status, { detail: 'missing' });
    await expect(readThread('nope')).resolves.toBeNull();
  });

  it('rejects when the backend could not say', async () => {
    respondWith(500, { detail: 'boom' });
    await expect(readThread('t-1')).rejects.toBeTruthy();
  });

  it('hands the host reporter to the directory: a refused request is reported', async () => {
    respondWith(401, { detail: 'unauthorized' });
    const report = vi.fn();
    const directory = createDirectory(report);
    try {
      await expect(directory.get('t-1')).rejects.toBeTruthy();
    } finally {
      directory.dispose();
    }
    expect(report).toHaveBeenCalledWith('unauthorized');
  });

  it('has every thread command and no project commands', () => {
    const directory = createDirectory();
    try {
      for (const command of ['create', 'rename', 'remove', 'setArchived', 'setPinned', 'reorderPinned', 'setProject'] as const) {
        expect(directory[command]).toEqual(expect.any(Function));
      }
      expect(directory.createProject).toBeUndefined();
    } finally {
      directory.dispose();
    }
  });
});
