import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './application.js';
import type {
  DirectoryResult,
  ThreadDirectory,
  ThreadRow,
} from './contracts.js';
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
const row = (extra: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 'created',
  title: 'Created',
  projectId: ' p/x ',
  ...extra,
});
function fixture(extra: Partial<ThreadDirectory> = {}) {
  const directory: ThreadDirectory = {
    get: async () => ({ kind: 'missing' }),
    list: async () => ({ kind: 'ready', value: [] }),
    create: async () => ({ kind: 'failed' }),
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

test('project creation captures exact target before pending observers and SDK duplicates', async () => {
  const held = deferred<DirectoryResult<ThreadRow>>();
  const targets: unknown[] = [];
  const app = fixture({
    create: async (_s, p) => {
      targets.push(p);
      app.newConversation('sdk replacement');
      return held.promise;
    },
  });
  app.start();
  await tick();
  const before = app.getSnapshot();
  app.subscribe(() => {
    if (app.getSnapshot().creation.status === 'pending')
      app.newConversation('observer replacement');
  });
  app.newConversation(' p/x ');
  app.newConversation('duplicate');
  assert.deepEqual(targets, [' p/x ']);
  assert.equal(app.getSnapshot().list.rows, before.list.rows);
  assert.equal(app.getSnapshot().selection, before.selection);
  held.resolve({ kind: 'ready', value: row() });
  await tick();
  assert.equal(app.getSnapshot().creation.status, 'confirmed');
  app.dispose();
});

test('project creation rejects malformed targets without IO or publication', async () => {
  let calls = 0;
  const app = fixture({
    create: async () => {
      calls++;
      return { kind: 'failed' };
    },
  });
  app.start();
  await tick();
  const before = app.getSnapshot();
  let publications = 0;
  app.subscribe(() => {
    publications++;
  });
  for (const project of ['', ' ', 42, false, {}, []])
    app.newConversation(project as string);
  await tick();
  assert.equal(calls, 0);
  assert.equal(publications, 0);
  assert.equal(app.getSnapshot(), before);
  app.dispose();
});

for (const value of [
  row({ projectId: undefined }),
  row({ projectId: 'wrong' }),
  row({ id: '' }),
  row({ id: ' ' }),
  row({ id: '.' }),
  row({ id: '..' }),
  row({ id: 42 as unknown as string }),
  Object.assign(Object.create({ projectId: ' p/x ' }), {
    id: 'created',
    title: 'Created',
  }) as ThreadRow,
])
  test(`project creation application independently requires exact evidence ${JSON.stringify(
    value
  )}`, async () => {
    const app = fixture({ create: async () => ({ kind: 'ready', value }) });
    app.start();
    await tick();
    const before = app.getSnapshot();
    app.newConversation(' p/x ');
    await tick();
    assert.equal(app.getSnapshot().creation.status, 'unconfirmed');
    assert.equal(app.getSnapshot().list.rows, before.list.rows);
    assert.equal(app.getSnapshot().selection, before.selection);
    app.dispose();
  });

for (const target of [null, undefined])
  test(`project creation preserves unassigned caller ${String(
    target
  )}`, async () => {
    const app = fixture({
      create: async () => ({
        kind: 'ready',
        value: row({ projectId: undefined }),
      }),
    });
    app.start();
    await tick();
    app.newConversation(target);
    await tick();
    assert.equal(app.getSnapshot().creation.status, 'confirmed');
    assert.equal(app.getSnapshot().list.rows.length, 1);
    app.dispose();
  });

test('project creation publishes confirmed status and deduplicated returned row atomically', async () => {
  const app = fixture({
    list: async () => ({
      kind: 'ready',
      value: [row({ title: 'Old' }), row({ title: 'Duplicate' })],
    }),
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  await tick();
  const observed: (readonly ThreadRow[])[] = [];
  app.subscribe(() => {
    const s = app.getSnapshot();
    if (s.creation.status === 'confirmed') observed.push(s.list.rows);
  });
  app.newConversation(' p/x ');
  await tick();
  assert.ok(observed.length);
  for (const rows of observed) assert.deepEqual(rows, [row()]);
  app.dispose();
});

test('project creation older omission retains latest row; postcreation omission retires retention', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const app = fixture({
    list: async () => {
      const d = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(d);
      return d.promise;
    },
    create: async () => ({ kind: 'ready', value: row() }),
    rename: async (id, title) => ({ kind: 'ready', value: row({ id, title }) }),
    setProject: async (id, projectId) => ({
      kind: 'ready',
      value: { id, projectId },
    }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  assert.equal(await app.rename('created', 'Latest'), true);
  assert.equal(await app.setProject('created', 'moved'), true);
  reads[0].resolve({ kind: 'ready', value: [] });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, [
    row({ title: 'Latest', projectId: 'moved' }),
  ]);
  app.refresh();
  reads[1].resolve({ kind: 'ready', value: [] });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, []);
  app.refresh();
  reads[2].resolve({ kind: 'ready', value: [] });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, []);
  app.dispose();
});

test('project creation association survives older row and fresh metadata stays authoritative', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const app = fixture({
    list: async () => {
      const d = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(d);
      return d.promise;
    },
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  reads[0].resolve({ kind: 'ready', value: [row({ projectId: undefined })] });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, ' p/x ');
  app.refresh();
  reads[1].resolve({
    kind: 'ready',
    value: [row({ title: 'Remote', projectId: 'remote' })],
  });
  await tick();
  assert.equal(app.getSnapshot().list.rows[0].projectId, 'remote');
  app.dispose();
});

for (const action of ['dispose', 'navigate'] as const)
  test(`project creation pending observer ${action} prevents dispatch`, async () => {
    let calls = 0;
    const app = fixture({
      create: async () => {
        calls++;
        return { kind: 'ready', value: row() };
      },
    });
    app.start();
    await tick();
    app.subscribe(() => {
      if (app.getSnapshot().creation.status === 'pending') {
        if (action === 'dispose') app.dispose();
        else app.select('other');
      }
    });
    app.newConversation(' p/x ');
    await tick();
    assert.equal(calls, 0);
    assert.equal(app.getSnapshot().list.rows.length, 0);
    app.dispose();
  });
for (const action of ['dispose', 'navigate'] as const)
  test(`project creation late completion after ${action} cannot add a row`, async () => {
    const held = deferred<DirectoryResult<ThreadRow>>();
    let signal: AbortSignal | undefined;
    const app = fixture({
      create: async (s) => {
        signal = s;
        return held.promise;
      },
    });
    app.start();
    await tick();
    app.newConversation(' p/x ');
    if (action === 'dispose') app.dispose();
    else app.select('other');
    const before = app.getSnapshot();
    held.resolve({ kind: 'ready', value: row() });
    await tick();
    assert.equal(signal?.aborted, true);
    assert.equal(app.getSnapshot().list.rows, before.list.rows);
    app.dispose();
  });

test('project creation confirmation observer navigation preserves row without stealing selection', async () => {
  const app = fixture({
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  await tick();
  let once = false;
  app.subscribe(() => {
    if (!once && app.getSnapshot().creation.status === 'confirmed') {
      once = true;
      assert.deepEqual(app.getSnapshot().list.rows, [row()]);
      app.select('other');
    }
  });
  app.newConversation(' p/x ');
  await tick();
  assert.equal(app.getSnapshot().selection.id, 'other');
  app.dispose();
});

for (const lifetime of ['deleting', 'retired'] as const)
  test(`project creation cannot confirm returned ID that is ${lifetime}`, async () => {
    const deletion = deferred<DirectoryResult<Readonly<{ id: string }>>>();
    const creation = deferred<DirectoryResult<ThreadRow>>();
    const app = fixture({
      list: async () => ({ kind: 'ready', value: [row()] }),
      create: async () => creation.promise,
      remove: async () => deletion.promise,
      inspectRemoval: async () => ({ kind: 'missing', id: 'created' }),
    });
    app.start();
    await tick();
    const removing = app.remove('created');
    assert.equal(app.getSnapshot().deletion.status, 'pending');
    if (lifetime === 'retired') {
      deletion.resolve({ kind: 'ready', value: { id: 'created' } });
      assert.equal(await removing, true);
    }
    const before = app.getSnapshot();
    app.newConversation(' p/x ');
    creation.resolve({ kind: 'ready', value: row() });
    await tick();
    assert.equal(app.getSnapshot().creation.status, 'unconfirmed');
    assert.equal(app.getSnapshot().list.rows, before.list.rows);
    assert.equal(app.getSnapshot().selection, before.selection);
    if (lifetime === 'deleting') {
      deletion.resolve({ kind: 'ready', value: { id: 'created' } });
      assert.equal(await removing, true);
    }
    assert.deepEqual(app.getSnapshot().list.rows, []);
    app.dispose();
  });

test('project creation fresh omission prevents a late older list from resurrecting insertion', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const app = fixture({
    list: async () => {
      const d = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(d);
      return d.promise;
    },
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, [row()]);
  app.refresh();
  reads[1].resolve({ kind: 'ready', value: [] });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, []);
  const before = app.getSnapshot();
  reads[0].resolve({ kind: 'ready', value: [row()] });
  await tick();
  assert.equal(app.getSnapshot(), before);
  app.dispose();
});

for (const action of ['dispose', 'new'] as const)
  test(`project creation confirmed observer ${action} sees atomic row without old adoption`, async () => {
    const second = deferred<DirectoryResult<ThreadRow>>();
    let calls = 0;
    const app = fixture({
      create: async () =>
        ++calls === 1 ? { kind: 'ready', value: row() } : second.promise,
    });
    app.start();
    await tick();
    let once = false;
    app.subscribe(() => {
      if (!once && app.getSnapshot().creation.status === 'confirmed') {
        once = true;
        assert.deepEqual(app.getSnapshot().list.rows, [row()]);
        if (action === 'dispose') app.dispose();
        else app.newConversation('second');
      }
    });
    app.newConversation(' p/x ');
    await tick();
    assert.equal(app.getSnapshot().selection.id, null);
    assert.deepEqual(app.getSnapshot().list.rows, [row()]);
    assert.equal(calls, action === 'new' ? 2 : 1);
    app.dispose();
    second.resolve({
      kind: 'ready',
      value: row({ id: 'second', projectId: 'second' }),
    });
    await tick();
    assert.deepEqual(app.getSnapshot().list.rows, [row()]);
  });

const fullPage = (): readonly ThreadRow[] =>
  Array.from({ length: 50 }, (_, index) => ({
    id: `loaded-${index}`,
    title: `Loaded ${index}`,
  }));

test('project creation confirmed insertion keeps the loaded directory within 50 rows', async () => {
  const loaded = fullPage();
  const app = fixture({
    list: async () => ({ kind: 'ready', value: loaded }),
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  await tick();
  app.newConversation(' p/x ');
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, [
    row(),
    ...loaded.slice(0, 49),
  ]);
  assert.equal(app.getSnapshot().list.rows.length, 50);
  app.dispose();
});

test('project creation stale full-page omission retains the new row within 50 rows', async () => {
  const loaded = fullPage();
  const older = deferred<DirectoryResult<readonly ThreadRow[]>>();
  const app = fixture({
    list: async () => older.promise,
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  older.resolve({ kind: 'ready', value: loaded });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, [
    row(),
    ...loaded.slice(0, 49),
  ]);
  assert.equal(app.getSnapshot().list.rows.length, 50);
  app.dispose();
});

test('project creation stale full page retains multiple rows in current snapshot order with latest metadata', async () => {
  const loaded = fullPage();
  const older = deferred<DirectoryResult<readonly ThreadRow[]>>();
  let creates = 0;
  const app = fixture({
    list: async () => older.promise,
    create: async () => ({
      kind: 'ready',
      value: row({ id: ++creates === 1 ? 'first' : 'second' }),
    }),
    rename: async (id, title) => ({ kind: 'ready', value: row({ id, title }) }),
    setProject: async (id, projectId) => ({
      kind: 'ready',
      value: { id, projectId },
    }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  app.newConversation(' p/x ');
  await tick();
  assert.equal(await app.rename('first', 'Latest first'), true);
  assert.equal(await app.setProject('first', 'moved'), true);
  const latest = app.getSnapshot().list.rows;
  assert.deepEqual(
    latest.map((item) => item.id),
    ['second', 'first']
  );
  older.resolve({ kind: 'ready', value: loaded });
  await tick();
  assert.deepEqual(app.getSnapshot().list.rows, [
    ...latest,
    ...loaded.slice(0, 48),
  ]);
  assert.equal(
    new Set(app.getSnapshot().list.rows.map((item) => item.id)).size,
    50
  );
  app.dispose();
});

test('project creation stale full page never adds a second copy of an included created ID', async () => {
  const older = deferred<DirectoryResult<readonly ThreadRow[]>>();
  const app = fixture({
    list: async () => older.promise,
    create: async () => ({ kind: 'ready', value: row() }),
  });
  app.start();
  app.newConversation(' p/x ');
  await tick();
  const loaded = [row({ projectId: undefined }), ...fullPage().slice(0, 49)];
  older.resolve({ kind: 'ready', value: loaded });
  await tick();
  const rows = app.getSnapshot().list.rows;
  assert.equal(rows.length, 50);
  assert.equal(rows.filter((item) => item.id === 'created').length, 1);
  assert.equal(rows[0].projectId, ' p/x ');
  app.dispose();
});

for (const includedWrite of [false, true])
  test(`project creation mixed full page retains all protected rows with ${
    includedWrite ? 'later writes' : 'accepted read fields'
  }`, async () => {
    const older = deferred<DirectoryResult<readonly ThreadRow[]>>();
    let creates = 0;
    const app = fixture({
      list: async () => older.promise,
      create: async () => ({
        kind: 'ready',
        value: row({ id: ++creates === 1 ? 'first' : 'second' }),
      }),
      rename: async (id, title) => ({
        kind: 'ready',
        value: row({ id, title }),
      }),
      setProject: async (id, projectId) => ({
        kind: 'ready',
        value: { id, projectId },
      }),
    });
    app.start();
    app.newConversation(' p/x ');
    await tick();
    app.newConversation(' p/x ');
    await tick();
    assert.equal(await app.rename('first', 'Latest first'), true);
    assert.equal(await app.setProject('first', 'moved'), true);
    if (includedWrite) {
      assert.equal(await app.rename('second', 'Latest second'), true);
      assert.equal(await app.setProject('second', 'second moved'), true);
    }
    const current = app.getSnapshot().list.rows;
    assert.deepEqual(
      current.map((item) => item.id),
      ['second', 'first']
    );
    const loaded = fullPage().slice(0, 49);
    // The included newer creation would fall off the end if only the omitted
    // older creation were prepended before applying the loaded-window bound.
    older.resolve({
      kind: 'ready',
      value: [
        ...loaded,
        row({ id: 'second', title: 'Read second', projectId: undefined }),
      ],
    });
    await tick();
    assert.deepEqual(app.getSnapshot().list.rows, [
      includedWrite ? current[0] : row({ id: 'second', title: 'Read second' }),
      current[1],
      ...loaded.slice(0, 48),
    ]);
    assert.equal(
      new Set(app.getSnapshot().list.rows.map((item) => item.id)).size,
      50
    );
    app.dispose();
  });
