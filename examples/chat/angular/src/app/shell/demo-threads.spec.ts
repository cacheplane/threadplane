import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoThreadDirectoryConfig, toThreadEntry } from './demo-threads';

describe('toThreadEntry', () => {
  it('reads the title, flags and project from thread metadata', () => {
    expect(
      toThreadEntry({
        thread_id: 't-1',
        updated_at: '2026-11-20T10:00:00.000Z',
        metadata: { title: '  Backup cleanup  ', pinned: true, archived: true, projectId: 'p-1' },
      }),
    ).toEqual({
      id: 't-1',
      title: 'Backup cleanup',
      updatedAt: Date.parse('2026-11-20T10:00:00.000Z'),
      pinned: true,
      archived: true,
      projectId: 'p-1',
    });
  });

  it('falls back to "New chat" and plain defaults for a thread without metadata', () => {
    expect(toThreadEntry({ thread_id: 't-2', metadata: null })).toEqual({
      id: 't-2',
      title: 'New chat',
      pinned: false,
      archived: false,
      projectId: null,
    });
    expect(toThreadEntry({ thread_id: 't-3', metadata: { title: '   ', pinned: 'yes' } }).title).toBe('New chat');
    expect(toThreadEntry({ thread_id: 't-3', metadata: { pinned: 'yes' } }).pinned).toBe(false);
  });
});

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

  function readThread(threadId: string) {
    const config = demoThreadDirectoryConfig();
    const directory = config.createDirectory({
      clientOptions: { maxRetries: 0 },
      reportOperationFailure: undefined,
    });
    if (!config.getThread) throw new Error('the demo directory must read one thread');
    try {
      return config.getThread(threadId, directory);
    } finally {
      directory.dispose();
    }
  }

  it('resolves the thread the backend returns', async () => {
    const fetchMock = respondWith(200, { thread_id: 't-1', metadata: { title: 'Saved' } });
    await expect(readThread('t-1')).resolves.toMatchObject({ id: 't-1', title: 'Saved' });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/threads\/t-1$/);
  });

  it.each([404, 422])('resolves null when the backend answers %i: no such thread', async (status) => {
    respondWith(status, { detail: 'missing' });
    await expect(readThread('nope')).resolves.toBeNull();
  });

  it('rejects when the backend could not say', async () => {
    respondWith(500, { detail: 'boom' });
    await expect(readThread('t-1')).rejects.toBeTruthy();
  });
});
