import { describe, expect, it } from 'vitest';
import { createLangGraphProjectStore } from './create-session';
import { createFakeThreadsClient } from './testing/fake-threads-client';

describe('createLangGraphProjectStore', () => {
  it('creates, lists, renames and removes under the default namespace', async () => {
    const client = createFakeThreadsClient();
    const store = createLangGraphProjectStore(client);

    const { id } = await store.create(' Trips ');
    expect(client.puts).toEqual([
      { namespace: ['threadplane', 'projects'], key: id, value: { name: 'Trips' } },
    ]);
    await store.create('Alpha');
    expect((await store.list()).map((p) => p.name)).toEqual(['Alpha', 'Trips']);

    await store.rename(id, 'Voyages');
    expect(await store.list()).toContainEqual({ id, name: 'Voyages' });

    await store.remove(id);
    expect((await store.list()).map((p) => p.name)).toEqual(['Alpha']);
  });

  it('honours a custom namespace', async () => {
    const client = createFakeThreadsClient();
    await createLangGraphProjectStore(client, { namespace: ['app', 'p'] }).create('X');
    expect(client.puts[0]?.namespace).toEqual(['app', 'p']);
    expect(await createLangGraphProjectStore(client).list()).toEqual([]);
  });

  it('skips items without a usable name', async () => {
    const client = createFakeThreadsClient([], [
      { namespace: ['threadplane', 'projects'], key: 'a', value: { name: 7 } },
      { namespace: ['threadplane', 'projects'], key: 'b', value: { name: ' ' } },
      { namespace: ['threadplane', 'projects'], key: 'c', value: { name: 'Ok' } },
    ]);
    expect(await createLangGraphProjectStore(client).list()).toEqual([
      { id: 'c', name: 'Ok' },
    ]);
  });

  it('rejects a blank name', async () => {
    const client = createFakeThreadsClient();
    const store = createLangGraphProjectStore(client);
    await expect(store.create('   ')).rejects.toThrow('Project name is required');
    await expect(store.rename('p', '')).rejects.toThrow('Project name is required');
    expect(client.puts).toEqual([]);
  });
});
