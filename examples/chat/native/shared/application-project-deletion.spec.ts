import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './application.js';
import type {
  ThreadDirectory,
  ThreadRow,
  DirectoryResult,
} from './contracts.js';
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const rows: ThreadRow[] = [
  { id: 'a', title: 'A', projectId: 'p', archived: true, pinned: true },
  { id: 'b', title: 'B', projectId: 'other' },
];
function fixture(extra: Partial<ThreadDirectory> = {}) {
  return createApplication({
    directory: {
      list: async () => ({ kind: 'ready', value: rows }),
      get: async () => ({ kind: 'missing' }),
      create: async () => ({ kind: 'failed' }),
      projectMembers: async () => ({ kind: 'ready', value: [] }),
      setProject: async (id, projectId) => ({
        kind: 'ready',
        value: { id, projectId },
      }),
      ...extra,
    },
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
  });
}
test('drains over 50 archived and unloaded members and preserves conversations and other metadata', async () => {
  const members = new Set(
    Array.from({ length: 123 }, (_, i) => (i === 0 ? 'a' : `outside-${i}`))
  );
  const writes: string[] = [];
  let searches = 0;
  const app = fixture({
    projectMembers: async () => {
      searches++;
      return { kind: 'ready', value: [...members].slice(0, 50) };
    },
    setProject: async (id, projectId) => {
      writes.push(id);
      members.delete(id);
      return { kind: 'ready', value: { id, projectId } };
    },
  });
  assert.equal(app.canDeleteProject('p'), false);
  app.start();
  await tick();
  assert.equal(await app.deleteProject('p'), true);
  assert.equal(writes.length, 123);
  assert.equal(searches, 4);
  assert.deepEqual(app.getSnapshot().projectDeletion, {
    status: 'confirmed',
    id: 'p',
    cleared: 123,
  });
  assert.deepEqual(app.getSnapshot().list.rows, [
    { id: 'a', title: 'A', archived: true, pinned: true },
    rows[1],
  ]);
  app.dispose();
});
test('uncertain write retains target and retry re-queries rather than blindly replaying', async () => {
  const members = new Set(['a', 'unloaded']);
  const writes: string[] = [];
  let fail = true;
  const app = fixture({
    projectMembers: async () => ({ kind: 'ready', value: [...members] }),
    setProject: async (id, projectId) => {
      writes.push(id);
      members.delete(id);
      if (fail && id === 'unloaded') {
        fail = false;
        return { kind: 'failed' };
      }
      return { kind: 'ready', value: { id, projectId } };
    },
  });
  app.start();
  await tick();
  assert.equal(await app.deleteProject('p'), false);
  assert.equal(app.getSnapshot().projectDeletion.status, 'unconfirmed');
  assert.equal(app.canDeleteProject('other'), false);
  assert.equal(await app.setProject('b', 'p'), false);
  app.newConversation('p');
  await tick();
  assert.equal(app.getSnapshot().creation.status, 'idle');
  assert.equal(await app.deleteProject('p'), true);
  assert.deepEqual(writes, ['a', 'unloaded']);
  app.dispose();
});
for (const page of [
  ['a', 'a'],
  ['a', ' '],
  Array.from({ length: 51 }, (_, i) => String(i)),
  null,
])
  test(`whole batch validation precedes writes ${JSON.stringify(page)?.slice(
    0,
    50
  )}`, async () => {
    let writes = 0;
    const app = fixture({
      projectMembers: async () => ({
        kind: 'ready',
        value: page as readonly string[],
      }),
      setProject: async () => {
        writes++;
        return { kind: 'failed' };
      },
    });
    app.start();
    await tick();
    assert.equal(await app.deleteProject('p'), false);
    assert.equal(writes, 0);
    app.dispose();
  });
test('repeated already-cleared member stops without a second write', async () => {
  let writes = 0;
  const app = fixture({
    projectMembers: async () => ({ kind: 'ready', value: ['a'] }),
    setProject: async (id, projectId) => {
      writes++;
      return { kind: 'ready', value: { id, projectId } };
    },
  });
  app.start();
  await tick();
  assert.equal(await app.deleteProject('p'), false);
  assert.equal(writes, 1);
  app.dispose();
});
test('pending reservation rejects overlap, creation and moves before observers reenter', async () => {
  const held = deferred<DirectoryResult<readonly string[]>>();
  let reads = 0,
    creates = 0;
  const app = fixture({
    projectMembers: async () => {
      reads++;
      return held.promise;
    },
    create: async () => {
      creates++;
      return { kind: 'failed' };
    },
    remove: async () => ({ kind: 'failed' }),
    inspectRemoval: async () => ({ kind: 'failed' }),
  });
  app.start();
  await tick();
  let entered = false;
  app.subscribe(() => {
    if (app.getSnapshot().projectDeletion.status === 'pending' && !entered) {
      entered = true;
      assert.equal(app.canDeleteProject('p'), false);
      assert.equal(app.canRemove('a'), false);
      app.newConversation();
      void app.setProject('b', 'p');
      void app.deleteProject('other');
    }
  });
  const deleting = app.deleteProject('p');
  assert.equal(reads, 1);
  assert.equal(creates, 0);
  held.resolve({ kind: 'ready', value: [] });
  assert.equal(await deleting, true);
  assert.equal(await app.setProject('b', 'p'), false);
  app.newConversation('p');
  await tick();
  assert.equal(creates, 0);
  assert.equal(await app.deleteProject('p'), true);
  app.dispose();
});
test('disposal aborts membership and suppresses late publication', async () => {
  const held = deferred<DirectoryResult<readonly string[]>>();
  let signal: AbortSignal | undefined,
    writes = 0;
  const app = fixture({
    projectMembers: async (_id, s) => {
      signal = s;
      return held.promise;
    },
    setProject: async () => {
      writes++;
      return { kind: 'failed' };
    },
  });
  app.start();
  await tick();
  const deleting = app.deleteProject('p');
  app.dispose();
  const snap = app.getSnapshot();
  assert.equal(signal?.aborted, true);
  held.resolve({ kind: 'ready', value: ['a'] });
  assert.equal(await deleting, false);
  assert.equal(app.getSnapshot(), snap);
  assert.equal(writes, 0);
});
test('final empty evidence clears stale target rows, fences old reads, and accepts fresh backend associations', async () => {
  const held = deferred<DirectoryResult<readonly ThreadRow[]>>();
  let reads = 0;
  const app = fixture({
    list: async () =>
      ++reads === 2 ? held.promise : { kind: 'ready', value: rows },
  });
  app.start();
  await tick();
  app.refresh();
  assert.equal(await app.deleteProject('p'), true);
  held.resolve({ kind: 'ready', value: rows });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, undefined);
  app.refresh();
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'p');
  app.dispose();
});
test('rejects start during creation, project move and conversation deletion', async () => {
  for (const mode of ['create', 'move', 'remove']) {
    const held = deferred<any>();
    let reads = 0;
    const app = fixture({
      create: async () => held.promise,
      setProject: async () => held.promise,
      remove: async () => held.promise,
      inspectRemoval: async () => ({ kind: 'failed' }),
      projectMembers: async () => {
        reads++;
        return { kind: 'ready', value: [] };
      },
    });
    app.start();
    await tick();
    if (mode === 'create') app.newConversation();
    else if (mode === 'move') void app.setProject('a', 'next');
    else void app.remove('a');
    assert.equal(await app.deleteProject('p'), false);
    assert.equal(reads, 0);
    app.dispose();
    held.resolve({ kind: 'failed' });
  }
});

test('empty project evidence fences previously unknown rows from an older admitted list', async () => {
  const held = deferred<DirectoryResult<readonly ThreadRow[]>>();
  let reads = 0;
  const app = fixture({
    list: async () =>
      ++reads === 2 ? held.promise : { kind: 'ready', value: [] },
  });
  app.start();
  await tick();
  app.refresh();
  assert.equal(await app.deleteProject('p'), true);
  held.resolve({
    kind: 'ready',
    value: [{ id: 'previously-unloaded', title: 'Stale', projectId: 'p' }],
  });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, undefined);
  app.dispose();
});

test('bounded deletion stops after 200 nonempty unique pages without claiming completion', async () => {
  let reads = 0,
    writes = 0;
  const app = fixture({
    projectMembers: async () => ({
      kind: 'ready',
      value: [`member-${++reads}`],
    }),
    setProject: async (id, projectId) => {
      writes++;
      return { kind: 'ready', value: { id, projectId } };
    },
  });
  app.start();
  await tick();
  assert.equal(await app.deleteProject('p'), false);
  assert.equal(reads, 200);
  assert.equal(writes, 200);
  assert.equal(app.getSnapshot().projectDeletion.status, 'unconfirmed');
  app.dispose();
});
for (const evidence of [
  { kind: 'ready', value: { id: 'wrong', projectId: null } },
  { kind: 'ready', value: { id: 'a', projectId: 'p' } },
  { kind: 'cancelled' },
])
  test(`deletion requires exact per-member confirmation ${JSON.stringify(
    evidence
  )}`, async () => {
    let reads = 0;
    const app = fixture({
      projectMembers: async () => {
        reads++;
        return { kind: 'ready', value: ['a'] };
      },
      setProject: async () => evidence as any,
    });
    app.start();
    await tick();
    assert.equal(await app.deleteProject('p'), false);
    assert.equal(reads, 1);
    assert.equal(app.getSnapshot().list.rows[0].projectId, 'p');
    assert.equal(app.getSnapshot().projectDeletion.cleared, 0);
    app.dispose();
  });
test('pending notification disposal prevents even the first membership dispatch', async () => {
  let reads = 0;
  const app = fixture({
    projectMembers: async () => {
      reads++;
      return { kind: 'ready', value: [] };
    },
  });
  app.start();
  await tick();
  app.subscribe(() => {
    if (app.getSnapshot().projectDeletion.status === 'pending') app.dispose();
  });
  assert.equal(await app.deleteProject('p'), false);
  assert.equal(reads, 0);
});
test('owner validates deletion inputs and optional capabilities without IO', async () => {
  let reads = 0;
  const app = fixture({
    projectMembers: async () => {
      reads++;
      return { kind: 'ready', value: [] };
    },
  });
  app.start();
  await tick();
  for (const id of ['', ' ', null, 42, {}])
    assert.equal(await app.deleteProject(id as string), false);
  assert.equal(reads, 0);
  app.dispose();
  const legacy = fixture({ projectMembers: undefined });
  legacy.start();
  await tick();
  assert.equal(legacy.canDeleteProject('p'), false);
  legacy.dispose();
});

test('empty membership clears selected association while retaining session, messages, URL and transcript', async () => {
  const runtime = {
    status: 'idle',
    history: [],
    interrupts: [],
    messages: [],
    toolCalls: [],
  };
  const messages: readonly never[] = Object.freeze([]);
  let sessions = 0,
    loads = 0,
    disposals = 0,
    pushes = 0;
  const app = createApplication({
    directory: {
      list: async () => ({ kind: 'ready', value: rows }),
      get: async () => ({ kind: 'ready', value: rows[0] }),
      create: async () => ({ kind: 'failed' }),
      projectMembers: async () => ({ kind: 'ready', value: [] }),
      setProject: async () => ({ kind: 'failed' }),
    },
    history: {
      currentUrl: () => 'http://localhost/?thread=a',
      push: () => {
        pushes++;
      },
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () => {
      sessions++;
      return {
        getSnapshot: () => runtime,
        subscribe: () => () => {},
        load: async () => {
          loads++;
        },
        dispose: async () => {
          disposals++;
        },
      } as unknown as import('./application.js').ApplicationSession;
    },
    contentFactory: () => ({
      getSnapshot: () => messages,
      update: () => {},
      dispose: () => {},
    }),
  });
  app.start();
  await tick();
  const before = app.getSnapshot();
  assert.equal(before.selection.status, 'ready');
  assert.equal(await app.deleteProject('p'), true);
  const after = app.getSnapshot();
  assert.equal(after.selection.id, 'a');
  assert.equal(after.selection.row?.projectId, undefined);
  assert.equal(after.runtime, before.runtime);
  assert.equal(after.messages, before.messages);
  assert.equal(sessions, 1);
  assert.equal(loads, 1);
  assert.equal(disposals, 0);
  assert.equal(pushes, 0);
  app.dispose();
});

for (const cleared of [false, true])
  test(`fresh ${
    cleared ? 'patched-member' : 'unknown-row'
  } evidence wins over an older selection admitted before empty membership`, async () => {
    const held = deferred<import('./contracts.js').ThreadLookupResult>();
    let reads = 0,
      membershipReads = 0;
    const row = { id: 'unknown', title: 'Server', projectId: 'p' };
    const runtime = {
      status: 'idle',
      history: [],
      interrupts: [],
      messages: [],
      toolCalls: [],
    };
    const app = createApplication({
      directory: {
        list: async () => ({
          kind: 'ready',
          value: ++reads === 1 ? [] : [row],
        }),
        get: async () => held.promise,
        create: async () => ({ kind: 'failed' }),
        projectMembers: async () => ({
          kind: 'ready',
          value: cleared && ++membershipReads === 1 ? ['unknown'] : [],
        }),
        setProject: async (id, projectId) => ({
          kind: 'ready',
          value: { id, projectId },
        }),
      },
      history: {
        currentUrl: () => 'http://localhost/?thread=unknown',
        push: () => {},
        subscribe: () => () => {},
      },
      apiUrl: 'http://localhost/api',
      assistantId: 'test',
      sessionFactory: () =>
        ({
          getSnapshot: () => runtime,
          subscribe: () => () => {},
          load: async () => {},
          dispose: async () => {},
        } as unknown as import('./application.js').ApplicationSession),
      contentFactory: () => ({
        getSnapshot: () => [],
        update: () => {},
        dispose: () => {},
      }),
    });
    app.start();
    await tick();
    assert.equal(await app.deleteProject('p'), true);
    app.refresh();
    await tick();
    held.resolve({ kind: 'ready', value: row });
    await tick();
    assert.equal(app.getSnapshot().selection.row?.projectId, 'p');
    app.dispose();
  });

test('deletion rejects inherited project association confirmation', async () => {
  const app = fixture({
    projectMembers: async () => ({ kind: 'ready', value: ['a'] }),
    setProject: async (id) => ({
      kind: 'ready',
      value: Object.assign(Object.create({ projectId: null }), { id }),
    }),
  });
  app.start();
  await tick();
  assert.equal(await app.deleteProject('p'), false);
  assert.equal(app.getSnapshot().projectDeletion.cleared, 0);
  app.dispose();
});

test('runtime snapshot reentry cannot admit thread removal after project deletion reserves', async () => {
  const held = deferred<DirectoryResult<readonly string[]>>();
  const runtime = {
    status: 'idle',
    history: [],
    interrupts: [],
    messages: [],
    toolCalls: [],
  };
  let reenter = false,
    removes = 0;
  const app = createApplication({
    directory: {
      list: async () => ({ kind: 'ready', value: rows }),
      get: async () => ({ kind: 'ready', value: rows[0] }),
      create: async () => ({ kind: 'failed' }),
      projectMembers: async () => held.promise,
      setProject: async () => ({ kind: 'failed' }),
      remove: async (id) => {
        removes++;
        return { kind: 'ready', value: { id } };
      },
      inspectRemoval: async () => ({ kind: 'failed' }),
    },
    history: {
      currentUrl: () => 'http://localhost/?thread=a',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () =>
      ({
        getSnapshot: () => {
          if (reenter) {
            reenter = false;
            void app.deleteProject('p');
          }
          return runtime;
        },
        subscribe: () => () => {},
        load: async () => {},
        dispose: async () => {},
      } as unknown as import('./application.js').ApplicationSession),
    contentFactory: () => ({
      getSnapshot: () => [],
      update: () => {},
      dispose: () => {},
    }),
  });
  app.start();
  await tick();
  reenter = true;
  assert.equal(await app.remove('a'), false);
  assert.equal(removes, 0);
  assert.equal(app.getSnapshot().projectDeletion.status, 'pending');
  app.dispose();
  held.resolve({ kind: 'cancelled' });
});

test('final empty evidence supersedes newer pre-empty row evidence omitted from the loaded window', async () => {
  const held = deferred<import('./contracts.js').ThreadLookupResult>();
  const row = { id: 'a', title: 'Server', projectId: 'p' };
  const runtime = {
    status: 'idle',
    history: [],
    interrupts: [],
    messages: [],
    toolCalls: [],
  };
  let reads = 0;
  const app = createApplication({
    directory: {
      list: async () => ({ kind: 'ready', value: ++reads === 2 ? [row] : [] }),
      get: async () => held.promise,
      create: async () => ({ kind: 'failed' }),
      projectMembers: async () => ({ kind: 'ready', value: [] }),
      setProject: async () => ({ kind: 'failed' }),
    },
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () =>
      ({
        getSnapshot: () => runtime,
        subscribe: () => () => {},
        load: async () => {},
        dispose: async () => {},
      } as unknown as import('./application.js').ApplicationSession),
    contentFactory: () => ({
      getSnapshot: () => [],
      update: () => {},
      dispose: () => {},
    }),
  });
  app.start();
  await tick();
  assert.equal(await app.deleteProject('q'), true);
  app.select('a');
  app.refresh();
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'p');
  app.refresh();
  await tick();
  assert.equal(app.getSnapshot().list.rows.length, 0);
  assert.equal(await app.deleteProject('p'), true);
  held.resolve({ kind: 'ready', value: row });
  await tick();
  assert.equal(app.getSnapshot().selection.row?.projectId, undefined);
  app.dispose();
});

function projectAbsenceRace() {
  const row: ThreadRow = { id: 'a', title: 'A', projectId: 'p', pinned: true };
  let rows: readonly ThreadRow[] = [row];
  const lookup = deferred<import('./contracts.js').ThreadLookupResult>();
  let nextList:
    | ReturnType<typeof deferred<DirectoryResult<readonly ThreadRow[]>>>
    | undefined;
  const writes: { id: string; projectId: string | null }[] = [];
  const runtime = {
    status: 'idle',
    history: [],
    interrupts: [],
    messages: [],
    toolCalls: [],
  };
  const app = createApplication({
    directory: {
      list: async () => {
        const held = nextList;
        nextList = undefined;
        return held ? held.promise : { kind: 'ready', value: rows };
      },
      get: async () => lookup.promise,
      create: async () => ({ kind: 'failed' }),
      projectMembers: async () => ({ kind: 'ready', value: [] }),
      setProject: async (id, projectId) => {
        writes.push({ id, projectId });
        return { kind: 'ready', value: { id, projectId } };
      },
    },
    history: {
      currentUrl: () => 'http://localhost/?thread=a',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () =>
      ({
        getSnapshot: () => runtime,
        subscribe: () => () => {},
        load: async () => {},
        dispose: async () => {},
      } as unknown as import('./application.js').ApplicationSession),
    contentFactory: () => ({
      getSnapshot: () => [],
      update: () => {},
      dispose: () => {},
    }),
  });
  return {
    app,
    row,
    lookup,
    writes,
    setRows(value: readonly ThreadRow[]) {
      rows = value;
    },
    holdList() {
      const held = deferred<DirectoryResult<readonly ThreadRow[]>>();
      nextList = held;
      return held;
    },
  };
}

test('project absence preserves a confirmed move to another project against an older lookup and list', async () => {
  const race = projectAbsenceRace();
  const { app, row, lookup } = race;
  app.start();
  await tick();
  assert.equal(app.getSnapshot().selection.status, 'pending');
  assert.equal(await app.setProject('a', 'q'), true);
  const list = race.holdList();
  app.refresh();
  await tick();
  assert.equal(await app.deleteProject('p'), true);
  lookup.resolve({ kind: 'ready', value: row });
  await tick();
  assert.equal(app.getSnapshot().selection.row?.projectId, 'q');
  list.resolve({ kind: 'ready', value: [{ ...row, projectId: 'q' }] });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'q');
  assert.equal(app.getSnapshot().selection.row?.projectId, 'q');
  assert.deepEqual(race.writes, [{ id: 'a', projectId: 'q' }]);
  app.dispose();
});

test('project absence preserves a newer readonly association before the first deletion', async () => {
  const race = projectAbsenceRace();
  const { app, row, lookup } = race;
  app.start();
  await tick();
  race.setRows([{ ...row, projectId: 'q' }]);
  app.refresh();
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'q');
  assert.equal(await app.deleteProject('p'), true);
  lookup.resolve({ kind: 'ready', value: row });
  await tick();
  assert.equal(app.getSnapshot().selection.row?.projectId, 'q');
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'q');
  assert.deepEqual(race.writes, []);
  app.dispose();
});

test('project absence preserves an independently observed unassigned row', async () => {
  const race = projectAbsenceRace();
  const { app, row, lookup } = race;
  const { projectId: _project, ...unassigned } = row;
  app.start();
  await tick();
  race.setRows([unassigned]);
  app.refresh();
  await tick();
  assert.equal(await app.deleteProject('p'), true);
  lookup.resolve({ kind: 'ready', value: row });
  await tick();
  assert.equal(
    Object.hasOwn(app.getSnapshot().selection.row!, 'projectId'),
    false
  );
  assert.equal(
    Object.hasOwn(app.getSnapshot().list.rows[0], 'projectId'),
    false
  );
  app.dispose();
});

test('project absence fences the winning project when it too was emptied after row omission', async () => {
  const race = projectAbsenceRace();
  const { app, row, lookup } = race;
  app.start();
  await tick();
  assert.equal(await app.setProject('a', 'q'), true);
  assert.equal(await app.deleteProject('p'), true);
  race.setRows([]);
  app.refresh();
  await tick();
  assert.equal(await app.deleteProject('q'), true);
  lookup.resolve({ kind: 'ready', value: row });
  await tick();
  assert.equal(
    Object.hasOwn(app.getSnapshot().selection.row!, 'projectId'),
    false
  );
  race.setRows([{ ...row, projectId: 'q' }]);
  app.refresh();
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'q');
  assert.equal(app.getSnapshot().selection.row?.projectId, 'q');
  app.dispose();
});
