import { describe, expect, it } from 'vitest';
import { createLangGraphThreadDirectory } from './create-session';
import { describeThreadDirectoryConformance } from './testing/thread-directory-conformance';
import { createFakeThreadsClient } from './testing/fake-threads-client';

describeThreadDirectoryConformance('runtime', (client) => ({
  directory: createLangGraphThreadDirectory({ client, projects: false }),
}));

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
      status: 'idle',
    });
    directory.dispose();
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
