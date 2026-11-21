import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLangGraphThreadDirectory } from './create-session';
import { describeThreadDirectoryConformance } from './testing/thread-directory-conformance';
import { createFakeThreadsClient } from './testing/fake-threads-client';

describeThreadDirectoryConformance('runtime, projects off', (client) => ({
  directory: createLangGraphThreadDirectory({ client, projects: false }),
}));

describeThreadDirectoryConformance(
  'runtime, default project store',
  (client) => ({ directory: createLangGraphThreadDirectory({ client }) }),
  { projects: true }
);

describe('createLangGraphThreadDirectory', () => {
  it('rejects a cross-origin apiUrl when browserOrigin is set', () => {
    expect(() =>
      createLangGraphThreadDirectory({
        apiUrl: 'https://other.test',
        browserOrigin: 'https://app.test',
      })
    ).toThrow('Directory requires an absolute same-origin API base');
  });

  it('rejects a relative or credentialed apiUrl when browserOrigin is set', () => {
    for (const apiUrl of ['/api', 'https://user:pw@app.test/api']) {
      expect(() =>
        createLangGraphThreadDirectory({
          apiUrl,
          browserOrigin: 'https://app.test',
        })
      ).toThrow('Directory requires an absolute same-origin API base');
    }
  });

  it('accepts a same-origin apiUrl when browserOrigin is set', () => {
    const directory = createLangGraphThreadDirectory({
      apiUrl: 'https://app.test/api',
      browserOrigin: 'https://app.test',
    });
    expect(directory.getSnapshot().status).toBe('idle');
    directory.dispose();
  });

  it('accepts a cross-origin apiUrl without browserOrigin', () => {
    const directory = createLangGraphThreadDirectory({
      apiUrl: 'https://other.test',
    });
    expect(directory.getSnapshot()).toEqual({
      threads: [],
      archived: [],
      projects: [],
      status: 'idle',
    });
    directory.dispose();
  });

  it('omits projects and never touches the store when projects is false', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({
      client,
      projects: false,
    });
    await directory.refresh();

    expect('projects' in directory.getSnapshot()).toBe(false);
    expect(client.calls.some((call) => call.startsWith('store.'))).toBe(false);
    expect(directory.createProject).toBeUndefined();
    expect(directory.renameProject).toBeUndefined();
    expect(directory.removeProject).toBeUndefined();
  });

  it('uses a supplied project store', async () => {
    const client = createFakeThreadsClient();
    const projects = {
      list: async () => [{ id: 'x', name: 'X' }],
      create: async () => ({ id: 'y' }),
      rename: async () => undefined,
      remove: async () => undefined,
    };
    const directory = createLangGraphThreadDirectory({ client, projects });
    await directory.refresh();
    expect(directory.getSnapshot().projects).toEqual([{ id: 'x', name: 'X' }]);
    expect(client.calls.some((call) => call.startsWith('store.'))).toBe(false);
  });

  it('requires an apiUrl or a client', () => {
    expect(() => createLangGraphThreadDirectory({})).toThrow(
      'Directory requires an apiUrl or a client'
    );
  });

  it('uses the configured title fallback', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({
      client,
      titleFallback: 'Untitled',
    });
    await directory.refresh();
    expect(directory.getSnapshot().threads[0]?.title).toBe('Untitled');
  });

  it('freezes snapshots and keeps unchanged entries by reference', async () => {
    const client = createFakeThreadsClient([
      { thread_id: 'a', updated_at: '2026-01-01T00:00:00Z', metadata: { title: 'A' } },
      { thread_id: 'b', updated_at: '2026-01-02T00:00:00Z', metadata: { title: 'B' } },
    ]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();
    const first = directory.getSnapshot();
    await directory.rename?.('b', 'Bee');
    const second = directory.getSnapshot();

    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.threads)).toBe(true);
    expect(Object.isFrozen(second.threads[0])).toBe(true);
    expect(second.threads.find((t) => t.id === 'a')).toBe(
      first.threads.find((t) => t.id === 'a')
    );
    expect(second.threads.find((t) => t.id === 'b')?.title).toBe('Bee');
  });

  it('reports loading while a refresh is in flight and stops on abort', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    const release = client.hold('threads.search');
    const controller = new AbortController();
    const refreshing = directory.refresh({ signal: controller.signal });

    expect(directory.getSnapshot().status).toBe('loading');
    controller.abort();
    release();
    await refreshing;

    expect(directory.getSnapshot()).toMatchObject({
      status: 'idle',
      threads: [],
    });
    expect(directory.getSnapshot().error).toBeUndefined();
  });

  it('rejects mutations after dispose without calling the server', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    directory.dispose();

    await expect(directory.rename?.('a', 'Trip')).rejects.toThrow(
      'The LangGraph request failed.'
    );
    expect(client.calls).toEqual([]);
  });
});

describe('createLangGraphThreadDirectory get', () => {
  it('reads one thread that the list does not hold', async () => {
    const client = createFakeThreadsClient([
      {
        thread_id: 'a',
        updated_at: '2026-01-01T00:00:00Z',
        metadata: { title: ' Trip ', archived: true, projectId: 'p' },
      },
      { thread_id: 'b' },
    ]);
    const directory = createLangGraphThreadDirectory({ client });
    const notify = vi.fn();
    directory.subscribe(notify);
    const before = directory.getSnapshot();

    const found = await directory.get('a');

    expect(found).toEqual({
      id: 'a',
      title: 'Trip',
      updatedAt: Date.parse('2026-01-01T00:00:00Z'),
      pinned: false,
      archived: true,
      projectId: 'p',
    });
    expect(Object.isFrozen(found)).toBe(true);
    await expect(directory.get('b')).resolves.toMatchObject({
      id: 'b',
      title: 'New chat',
    });
    // Reading one thread reads nothing else and publishes nothing.
    expect(client.calls).toEqual(['threads.get', 'threads.get']);
    expect(directory.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
  });

  it('applies the configured title fallback', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({
      client,
      titleFallback: 'Untitled',
    });
    await expect(directory.get('a')).resolves.toMatchObject({
      title: 'Untitled',
    });
  });

  it('answers null for a thread the server does not have', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    await expect(directory.get('missing')).resolves.toBeNull();
  });

  it('answers null for an id the server says is malformed', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    client.failNext('threads.get', 422);
    await expect(directory.get('a')).resolves.toBeNull();
  });

  it('reads a status the SDK put on the failure response', async () => {
    const client = createFakeThreadsClient();
    const directory = createLangGraphThreadDirectory({
      client: {
        ...client,
        threads: {
          ...client.threads,
          get: async () => {
            throw Object.assign(new Error('nested'), {
              response: { status: 404 },
            });
          },
        } as unknown as typeof client.threads,
      },
    });
    await expect(directory.get('a')).resolves.toBeNull();
  });

  it.each([401, 403, 500, 503])(
    'rejects with a safe error when the server answers %i',
    async (status) => {
      const client = createFakeThreadsClient([{ thread_id: 'a' }]);
      const directory = createLangGraphThreadDirectory({ client });
      client.failNext('threads.get', status);
      const failure = await directory.get('a').catch((error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.name).toBe('LangGraphRequestError');
      expect(failure.message).toBe('The LangGraph request failed.');
      expect('status' in failure).toBe(false);
    }
  );

  it('rejects when the status of a failure cannot be read', async () => {
    const client = createFakeThreadsClient();
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('trap');
        },
      }
    );
    const directory = createLangGraphThreadDirectory({
      client: {
        ...client,
        threads: {
          ...client.threads,
          get: async () => {
            throw hostile;
          },
        } as unknown as typeof client.threads,
      },
    });
    await expect(directory.get('a')).rejects.toThrow(
      'The LangGraph request failed.'
    );
  });

  it('encodes the thread id in the request path', async () => {
    const client = createFakeThreadsClient();
    const ids: string[] = [];
    const directory = createLangGraphThreadDirectory({
      client: {
        ...client,
        threads: {
          ...client.threads,
          get: async (id: string) => {
            ids.push(id);
            return { thread_id: 'a/b' };
          },
        } as unknown as typeof client.threads,
      },
    });
    await expect(directory.get('a/b')).resolves.toMatchObject({ id: 'a/b' });
    expect(ids).toEqual(['a%2Fb']);
  });

  it('returns the listed entry for a thread that has not changed', async () => {
    const client = createFakeThreadsClient([
      { thread_id: 'a', metadata: { title: 'A', pinned: true, pinnedOrder: 2 } },
    ]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();
    const listed = directory.getSnapshot().threads[0];

    await expect(directory.get('a')).resolves.toBe(listed);
  });

  it('rejects with an abort error when the caller aborts, even on a 404', async () => {
    const client = createFakeThreadsClient();
    const directory = createLangGraphThreadDirectory({ client });
    const release = client.hold('threads.get');
    const controller = new AbortController();
    const reading = directory.get('missing', { signal: controller.signal });
    controller.abort();
    release();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects after dispose without calling the server', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    directory.dispose();
    await expect(directory.get('a')).rejects.toThrow(
      'The LangGraph request failed.'
    );
    expect(client.calls).toEqual([]);
  });
});

describe('createLangGraphThreadDirectory pinnedOrderOf', () => {
  it('answers the saved rank of listed and read entries, which carry none', async () => {
    const client = createFakeThreadsClient([
      { thread_id: 'a', metadata: { pinned: true, pinnedOrder: 1 } },
      { thread_id: 'b', metadata: { pinned: true, pinnedOrder: 0 } },
      { thread_id: 'c', metadata: { pinned: true } },
      { thread_id: 'd', metadata: { pinnedOrder: '2' } },
      { thread_id: 'z', metadata: { archived: true, pinnedOrder: 7 } },
    ]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();
    const { threads, archived } = directory.getSnapshot();

    expect(
      threads.map((entry) => [entry.id, directory.pinnedOrderOf(entry)])
    ).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', undefined],
      ['d', undefined],
    ]);
    expect(directory.pinnedOrderOf(archived[0])).toBe(7);
    expect(threads.some((entry) => 'pinnedOrder' in entry)).toBe(false);

    // An entry read on its own, not taken from the list, has its rank too.
    const other = createLangGraphThreadDirectory({ client });
    const read = await other.get('a');
    expect(read && other.pinnedOrderOf(read)).toBe(1);
    expect(read && 'pinnedOrder' in read).toBe(false);
  });

  it('follows a reorder, at once and once confirmed', async () => {
    const client = createFakeThreadsClient([
      { thread_id: 'a', metadata: { pinned: true, pinnedOrder: 0 } },
      { thread_id: 'b', metadata: { pinned: true, pinnedOrder: 1 } },
    ]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();
    const ranks = () =>
      directory
        .getSnapshot()
        .threads.map((entry) => [entry.id, directory.pinnedOrderOf(entry)]);

    const release = client.hold('threads.update');
    const moving = directory.reorderPinned('b', 'a');
    expect(ranks()).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
    release();
    await moving;
    expect(ranks()).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
  });

  it('has no rank for an entry it did not produce', () => {
    const directory = createLangGraphThreadDirectory({
      client: createFakeThreadsClient(),
    });
    expect(
      directory.pinnedOrderOf({
        id: 'a',
        title: 'A',
        pinned: true,
        archived: false,
        projectId: null,
      })
    ).toBeUndefined();
  });
});

describe('createLangGraphThreadDirectory load order', () => {
  it('reads project names only after the thread list, and not when it failed', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    client.failNext('threads.search', 500);
    await directory.refresh();
    expect(client.calls).toEqual(['threads.search']);
    expect(directory.getSnapshot().status).toBe('error');

    await directory.refresh();
    expect(client.calls).toEqual([
      'threads.search',
      'threads.search',
      'store.searchItems',
    ]);
  });

  it('publishes the thread list before a slow project read, which refresh waits for', async () => {
    const client = createFakeThreadsClient(
      [{ thread_id: 'a' }],
      [{ namespace: ['threadplane', 'projects'], key: 'p', value: { name: 'P' } }]
    );
    const directory = createLangGraphThreadDirectory({ client });
    const release = client.hold('store.searchItems');
    let settled = false;
    const refreshing = directory.refresh().then(() => {
      settled = true;
    });

    await vi.waitFor(() =>
      expect(directory.getSnapshot().threads.map((t) => t.id)).toEqual(['a'])
    );
    expect(directory.getSnapshot().status).toBe('idle');
    expect(directory.getSnapshot().projects).toEqual([]);
    expect(settled).toBe(false);
    release();
    await refreshing;
    expect(directory.getSnapshot().projects).toEqual([{ id: 'p', name: 'P' }]);
  });

  it('confirms a thread command on the thread list alone', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();
    const release = client.hold('store.searchItems');

    await directory.rename('a', 'Trip');
    const created = await directory.create();

    expect(directory.getSnapshot().threads.map((t) => t.id)).toEqual([
      created.id,
      'a',
    ]);
    expect(directory.getSnapshot().threads[1]?.title).toBe('Trip');
    release();
  });

  it('waits for the project list after a project command', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const directory = createLangGraphThreadDirectory({ client });
    await directory.refresh();

    const created = await directory.createProject('Trips');

    expect(directory.getSnapshot().projects).toEqual([
      { id: created.id, name: 'Trips' },
    ]);
  });
});

describe('createLangGraphThreadDirectory reportOperationFailure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown = null) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  function owned(respond: (url: string) => Response | Promise<Response>) {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        return respond(url);
      })
    );
    const report = vi.fn();
    const directory = createLangGraphThreadDirectory({
      apiUrl: 'https://app.test/api',
      reportOperationFailure: report,
    });
    return { directory, report, requests };
  }

  it.each([401, 403])(
    'reports a %i on the thread list once, and reads nothing else',
    async (status) => {
      const { directory, report, requests } = owned(() => answer(status));
      await directory.refresh();

      expect(report.mock.calls).toEqual([['unauthorized']]);
      expect(requests).toHaveLength(1);
      expect(directory.getSnapshot()).toMatchObject({
        status: 'error',
        error: {
          kind: 'server',
          message: 'The LangGraph request failed.',
          retryable: true,
          recovery: 'retry',
        },
      });
    }
  );

  it('reports a request the network refused once, without retrying it', async () => {
    const { directory, report, requests } = owned(() => {
      throw new TypeError('Failed to fetch');
    });
    await directory.refresh();

    expect(report.mock.calls).toEqual([['network_blocked']]);
    expect(requests).toHaveLength(1);
    expect(directory.getSnapshot().status).toBe('error');
  });

  it('reports nothing for a server error or a successful read', async () => {
    let status = 500;
    const { directory, report } = owned((url) =>
      status === 200
        ? answer(200, url.includes('/store/') ? { items: [] } : [])
        : answer(status)
    );
    await directory.refresh();
    expect(directory.getSnapshot().status).toBe('error');
    status = 200;
    await directory.refresh();
    expect(directory.getSnapshot().status).toBe('idle');
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a rejected command and a rejected single read', async () => {
    const { directory, report } = owned(() => answer(401));
    await expect(directory.rename('a', 'Trip')).rejects.toThrow(
      'The LangGraph request failed.'
    );
    await expect(directory.get('a')).rejects.toThrow(
      'The LangGraph request failed.'
    );
    expect(report.mock.calls).toEqual([['unauthorized'], ['unauthorized']]);
  });

  it('reads one thread through the SDK: found, missing, malformed, and no report', async () => {
    const { directory, report, requests } = owned((url) =>
      url.endsWith('/threads/a')
        ? answer(200, { thread_id: 'a', metadata: { title: 'Trip' } })
        : answer(url.endsWith('/threads/bad') ? 422 : 404, {
            detail: 'private',
          })
    );
    await expect(directory.get('a')).resolves.toMatchObject({
      id: 'a',
      title: 'Trip',
    });
    await expect(directory.get('gone')).resolves.toBeNull();
    await expect(directory.get('bad')).resolves.toBeNull();
    expect(requests).toEqual([
      'https://app.test/api/threads/a',
      'https://app.test/api/threads/gone',
      'https://app.test/api/threads/bad',
    ]);
    expect(report).not.toHaveBeenCalled();
  });

  it('survives a reporter that throws', async () => {
    const { directory, report } = owned(() => answer(401));
    report.mockImplementation(() => {
      throw new Error('reporter');
    });
    await expect(directory.refresh()).resolves.toBeUndefined();
    expect(directory.getSnapshot().status).toBe('error');
  });

  it('does not report for a supplied client', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    const report = vi.fn();
    const directory = createLangGraphThreadDirectory({
      client,
      reportOperationFailure: report,
    });
    client.failNext('threads.search', 401);
    await directory.refresh();
    client.failNext('threads.update', 403);
    await expect(directory.rename('a', 'Trip')).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });
});
