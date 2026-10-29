import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './application.js';
import type {
  DirectoryResult,
  ThreadDirectory,
  ThreadRow,
} from './contracts.js';
type Assignment = DirectoryResult<
  Readonly<{ id: string; projectId: string | null }>
>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const initial: ThreadRow[] = [
  { id: 'a', title: 'Alpha', projectId: 'old', pinned: true, archived: true },
  { id: '__proto__', title: 'Prototype' },
];
const ready = (id: string, projectId: string | null): Assignment => ({
  kind: 'ready',
  value: { id, projectId },
});
function fixture(extra: Partial<ThreadDirectory> = {}) {
  const directory: ThreadDirectory = {
    get: async () => ({ kind: 'missing' }),
    create: async () => ({ kind: 'failed' }),
    list: async () => ({ kind: 'ready', value: initial }),
    setProject: async (id, projectId) => ready(id, projectId),
    ...extra,
  };
  return createApplication({
    directory,
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
  });
}
test('project owner validates capabilities, loaded IDs and exact association without IO', async () => {
  let calls = 0;
  const app = fixture({
    setProject: async (id, p) => {
      calls++;
      return ready(id, p);
    },
  });
  assert.equal(app.canSetProject(), false);
  app.start();
  await tick();
  assert.equal(app.canSetProject(), true);
  for (const id of ['', ' ', '.', '..', null, 42, 'missing'])
    assert.equal(await app.setProject(id as string, 'p'), false);
  for (const p of ['', ' ', undefined, 42, {}])
    assert.equal(await app.setProject('a', p as string), false);
  assert.equal(await app.setProject('a', 'old'), false);
  assert.equal(await app.setProject('__proto__', null), false);
  assert.equal(calls, 0);
  assert.equal(await app.setProject('__proto__', ' p/x '), true);
  assert.deepEqual(app.getSnapshot().projectMoves['__proto__'], {
    status: 'confirmed',
    projectId: ' p/x ',
  });
  assert.ok(Object.isFrozen(app.getSnapshot().projectMoves));
  app.dispose();
  assert.equal(app.canSetProject(), false);
  const legacy = fixture({ setProject: undefined });
  legacy.start();
  await tick();
  assert.equal(legacy.canSetProject(), false);
  legacy.dispose();
});
test('pending move preserves row until exact confirmation; failed attempts preserve last confirmed and retry', async () => {
  let held = deferred<Assignment>();
  let calls = 0;
  const app = fixture({
    setProject: async () => {
      calls++;
      return held.promise;
    },
    remove: async () => ({ kind: 'failed' }),
    inspectRemoval: async () => ({ kind: 'failed' }),
  });
  app.start();
  await tick();
  const moving = app.setProject('a', 'next');
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'old');
  assert.equal(app.canRemove('a'), false);
  assert.equal(await app.setProject('a', null), false);
  held.resolve(ready('wrong', 'next'));
  assert.equal(await moving, false);
  assert.equal(app.getSnapshot().projectMoves['a'].status, 'failed');
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'old');
  held = deferred();
  const retry = app.setProject('a', null);
  held.resolve(ready('a', null));
  assert.equal(await retry, true);
  assert.equal(
    Object.hasOwn(app.getSnapshot().list.rows[0], 'projectId'),
    false
  );
  assert.equal(app.getSnapshot().list.rows[0].title, 'Alpha');
  assert.equal(calls, 2);
  app.dispose();
});
test('pending notification disposal prevents dispatch and late settlement never publishes', async () => {
  let calls = 0;
  const app = fixture({
    setProject: async (id, p) => {
      calls++;
      return ready(id, p);
    },
  });
  app.start();
  await tick();
  app.subscribe(() => {
    if (app.getSnapshot().projectMoves['a']?.status === 'pending')
      app.dispose();
  });
  assert.equal(await app.setProject('a', 'p'), false);
  assert.equal(calls, 0);
  let signal: AbortSignal | undefined;
  const held = deferred<Assignment>();
  const second = fixture({
    setProject: async (_id, _p, s) => {
      signal = s;
      return held.promise;
    },
  });
  second.start();
  await tick();
  const moving = second.setProject('a', 'p');
  second.dispose();
  const snap = second.getSnapshot();
  assert.equal(signal?.aborted, true);
  held.resolve(ready('a', 'p'));
  assert.equal(await moving, false);
  assert.equal(second.getSnapshot(), snap);
});
test('project evidence fences before/during reads, survives omission, and accepts fresh reads', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const held = deferred<Assignment>();
  const app = fixture({
    list: async () => {
      const read = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(read);
      return read.promise;
    },
    setProject: async () => held.promise,
  });
  app.start();
  reads[0].resolve({ kind: 'ready', value: initial });
  await tick();
  app.refresh();
  const moving = app.setProject('a', 'new');
  held.resolve(ready('a', 'new'));
  assert.equal(await moving, true);
  reads[1].resolve({ kind: 'ready', value: initial });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'new');
  app.refresh();
  reads[2].resolve({ kind: 'ready', value: [] });
  await tick();
  app.refresh();
  reads[3].resolve({
    kind: 'ready',
    value: [{ id: 'a', title: 'Fresh', projectId: 'remote' }],
  });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'remote');
  app.dispose();
});
for (const projectFirst of [true, false])
  test(`project completion composes with other metadata writes ${projectFirst}`, async () => {
    const move = deferred<Assignment>(),
      rename = deferred<DirectoryResult<ThreadRow>>();
    const app = fixture({
      setProject: async () => move.promise,
      rename: async () => rename.promise,
    });
    app.start();
    await tick();
    const moving = app.setProject('a', 'new'),
      renaming = app.rename('a', 'Renamed');
    if (projectFirst) {
      move.resolve(ready('a', 'new'));
      await moving;
      rename.resolve({
        kind: 'ready',
        value: { id: 'a', title: 'Renamed', projectId: 'stale' },
      });
    } else {
      rename.resolve({
        kind: 'ready',
        value: { id: 'a', title: 'Renamed', projectId: 'stale' },
      });
      await renaming;
      move.resolve(ready('a', 'new'));
    }
    await Promise.all([moving, renaming]);
    assert.deepEqual(app.getSnapshot().list.rows[0], {
      ...initial[0],
      title: 'Renamed',
      projectId: 'new',
    });
    app.dispose();
  });

test('deletion uncertainty blocks a move; authoritative inspection seeds project evidence and retirement blocks reuse', async () => {
  const held = deferred<DirectoryResult<readonly ThreadRow[]>>();
  let listCalls = 0;
  const app = fixture({
    list: async () =>
      ++listCalls === 1 ? { kind: 'ready', value: initial } : held.promise,
    remove: async () => ({ kind: 'failed' }),
    inspectRemoval: async () => ({
      kind: 'ready',
      value: { id: 'a', title: 'Inspected', projectId: 'inspected' },
    }),
  });
  app.start();
  await tick();
  app.refresh();
  assert.equal(await app.remove('a'), false);
  assert.equal(await app.setProject('a', 'blocked'), false);
  const intent = app.getSnapshot().deletion.intent;
  assert.equal(await app.checkRemoval('a', intent), true);
  held.resolve({ kind: 'ready', value: initial });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'inspected');
  app.dispose();
  const retired = fixture({
    remove: async (id) => ({ kind: 'ready', value: { id } }),
    inspectRemoval: async () => ({ kind: 'failed' }),
  });
  retired.start();
  await tick();
  assert.equal(await retired.remove('a'), true);
  assert.equal(await retired.setProject('a', 'p'), false);
  retired.refresh();
  await tick();
  assert.equal(
    retired.getSnapshot().list.rows.some((row) => row.id === 'a'),
    false
  );
  retired.dispose();
});

function selectedFixture() {
  const gets: ReturnType<
    typeof deferred<import('./contracts.js').ThreadLookupResult>
  >[] = [];
  const lists: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  let sessions = 0,
    loads = 0,
    disposals = 0,
    contentDisposals = 0;
  const runtime = {
    status: 'idle',
    history: [],
    interrupts: [],
    messages: [],
    toolCalls: [],
  };
  const messages: readonly never[] = Object.freeze([]);
  const session = {
    getSnapshot: () => runtime,
    subscribe: () => () => {},
    load: async () => {
      loads++;
    },
    dispose: async () => {
      disposals++;
    },
  };
  const app = createApplication({
    directory: {
      get: async () => {
        const read = deferred<import('./contracts.js').ThreadLookupResult>();
        gets.push(read);
        return read.promise;
      },
      list: async () => {
        const read = deferred<DirectoryResult<readonly ThreadRow[]>>();
        lists.push(read);
        return read.promise;
      },
      create: async () => ({ kind: 'failed' }),
      setProject: async (id, p) => ready(id, p),
    },
    history: {
      currentUrl: () => 'http://localhost/?thread=a',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () => {
      sessions++;
      return session as unknown as import('./application.js').ApplicationSession;
    },
    contentFactory: () => ({
      getSnapshot: () => messages,
      update: () => {},
      dispose: () => {
        contentDisposals++;
      },
    }),
  });
  return {
    app,
    gets,
    lists,
    runtime,
    messages,
    counts: () => ({ sessions, loads, disposals, contentDisposals }),
  };
}

test('association changes and same-ID refresh preserve runtime, content and session identity', async () => {
  const f = selectedFixture();
  f.app.start();
  f.lists[0].resolve({ kind: 'ready', value: initial });
  f.gets[0].resolve({ kind: 'ready', value: initial[0] });
  await tick();
  assert.equal(f.app.getSnapshot().selection.status, 'ready');
  const runtime = f.app.getSnapshot().runtime,
    messages = f.app.getSnapshot().messages;
  assert.equal(await f.app.setProject('a', null), true);
  assert.equal(
    Object.hasOwn(f.app.getSnapshot().selection.row!, 'projectId'),
    false
  );
  f.app.refresh();
  f.lists[1].resolve({
    kind: 'ready',
    value: [{ ...initial[0], projectId: 'fresh' }],
  });
  await tick();
  assert.equal(f.app.getSnapshot().selection.row?.projectId, 'fresh');
  assert.equal(f.app.getSnapshot().runtime, runtime);
  assert.equal(f.app.getSnapshot().messages, messages);
  assert.deepEqual(f.counts(), {
    sessions: 1,
    loads: 1,
    disposals: 0,
    contentDisposals: 0,
  });
  f.app.dispose();
});

for (const getFirst of [true, false])
  test(`independent list/get read order protects newer association ${getFirst}`, async () => {
    const f = selectedFixture();
    f.app.start();
    f.lists[0].resolve({ kind: 'ready', value: initial });
    f.gets[0].resolve({ kind: 'ready', value: initial[0] });
    await tick();
    assert.equal(await f.app.setProject('a', 'written'), true);
    if (getFirst) {
      f.app.select('b');
      f.app.select('a');
      f.app.refresh();
      f.lists[1].resolve({
        kind: 'ready',
        value: [{ ...initial[0], projectId: 'newer-list' }],
      });
      await tick();
      f.gets[2].resolve({
        kind: 'ready',
        value: { ...initial[0], projectId: 'older-get' },
      });
      await tick();
      assert.equal(f.app.getSnapshot().selection.row?.projectId, 'newer-list');
    } else {
      f.app.refresh();
      f.app.select('b');
      f.app.select('a');
      f.gets[2].resolve({
        kind: 'ready',
        value: { ...initial[0], projectId: 'newer-get' },
      });
      await tick();
      f.lists[1].resolve({
        kind: 'ready',
        value: [{ ...initial[0], projectId: 'older-list' }],
      });
      await tick();
      assert.equal(f.app.getSnapshot().list.rows[0].projectId, 'newer-get');
      assert.equal(f.app.getSnapshot().selection.row?.projectId, 'newer-get');
    }
    f.app.dispose();
  });

test('list omission retains evidence against an older pending selection read', async () => {
  const f = selectedFixture();
  f.app.start();
  f.lists[0].resolve({ kind: 'ready', value: initial });
  await tick();
  assert.equal(await f.app.setProject('a', 'written'), true);
  f.app.refresh();
  f.lists[1].resolve({ kind: 'ready', value: [] });
  await tick();
  f.gets[0].resolve({ kind: 'ready', value: initial[0] });
  await tick();
  assert.equal(f.app.getSnapshot().selection.row?.projectId, 'written');
  f.app.dispose();
});

for (const field of ['pin', 'archive'] as const)
  for (const projectFirst of [true, false])
    test(`project and ${field} completions preserve each field ${projectFirst}`, async () => {
      const move = deferred<Assignment>(),
        metadata = deferred<DirectoryResult<ThreadRow>>();
      const app = fixture({
        setProject: async () => move.promise,
        setPinned: async () => metadata.promise,
        setArchived: async () => metadata.promise,
      });
      app.start();
      await tick();
      const moving = app.setProject('a', 'new');
      const updating =
        field === 'pin'
          ? app.setPinned('a', false)
          : app.setArchived('a', false);
      const updated: ThreadRow = {
        id: 'a',
        title: 'Stale',
        projectId: 'stale',
        ...(field === 'pin' ? { pinned: false } : { archived: false }),
      };
      if (projectFirst) {
        move.resolve(ready('a', 'new'));
        await moving;
        metadata.resolve({ kind: 'ready', value: updated });
      } else {
        metadata.resolve({ kind: 'ready', value: updated });
        await updating;
        move.resolve(ready('a', 'new'));
      }
      assert.deepEqual(await Promise.all([moving, updating]), [true, true]);
      assert.deepEqual(app.getSnapshot().list.rows[0], {
        ...initial[0],
        projectId: 'new',
        ...(field === 'pin' ? { pinned: false } : { archived: false }),
      });
      app.dispose();
    });

test('a list admitted while the move is pending cannot overwrite its later confirmation', async () => {
  let count = 0;
  const list = deferred<DirectoryResult<readonly ThreadRow[]>>(),
    move = deferred<Assignment>();
  const app = fixture({
    list: async () =>
      ++count === 1 ? { kind: 'ready', value: initial } : list.promise,
    setProject: async () => move.promise,
  });
  app.start();
  await tick();
  const moving = app.setProject('a', null);
  app.refresh();
  move.resolve(ready('a', null));
  await moving;
  list.resolve({ kind: 'ready', value: initial });
  await tick();
  assert.equal(
    Object.hasOwn(app.getSnapshot().list.rows[0], 'projectId'),
    false
  );
  app.dispose();
});
