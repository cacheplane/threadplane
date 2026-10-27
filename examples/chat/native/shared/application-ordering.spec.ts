import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './application.js';
import type {
  ThreadDirectory,
  ThreadRow,
  DirectoryResult,
} from './contracts.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const initial: readonly ThreadRow[] = Object.freeze([
  { id: 'u', title: 'Unpinned' },
  { id: 'a', title: 'Alpha', pinned: true, pinnedOrder: 0 },
  { id: 'b', title: 'Beta', pinned: true, pinnedOrder: 1 },
  { id: 'c', title: 'Gamma', pinned: true, pinnedOrder: 2 },
  { id: 'x', title: 'Archive', pinned: true, archived: true, pinnedOrder: 0 },
]);
function fixture(
  write: (
    id: string,
    rank: number,
    signal: AbortSignal
  ) => Promise<DirectoryResult<ThreadRow>>,
  list?: ThreadDirectory['list']
) {
  const directory = {
    get: async () => ({ kind: 'missing' as const }),
    create: async () => ({ kind: 'failed' as const }),
    list: list ?? (async () => ({ kind: 'ready' as const, value: initial })),
    setPinnedOrder: write,
    rename: async (id: string, title: string) => ({
      kind: 'ready' as const,
      value: { id, title },
    }),
    setPinned: async (id: string, pinned: boolean) => ({
      kind: 'ready' as const,
      value: { id, title: 'stale', pinned },
    }),
    setArchived: async (id: string, archived: boolean) => ({
      kind: 'ready' as const,
      value: { id, title: 'stale', archived },
    }),
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
const ready = (
  id: string,
  pinnedOrder: number
): DirectoryResult<ThreadRow> => ({
  kind: 'ready',
  value: { id, title: 'stale', pinnedOrder },
});

test('pinned ordering owner validates full loaded slice and writes only changed ranks with global admission', async () => {
  const held = deferred<DirectoryResult<ThreadRow>>();
  const calls: [string, number][] = [];
  const app = fixture(async (id, rank) => {
    calls.push([id, rank]);
    return calls.length === 1 ? held.promise : ready(id, rank);
  });
  assert.equal(typeof app.reorderPinned, 'function');
  assert.equal(await app.reorderPinned('b', 'a'), false);
  app.start();
  await tick();
  for (const [id, before] of [
    ['u', 'a'],
    ['x', 'a'],
    ['missing', 'a'],
    ['b', 'b'],
    ['a', 'b'],
    ['b', 'u'],
    ['c', null],
  ] as const)
    assert.equal(await app.reorderPinned(id, before), false);
  const moving = app.reorderPinned('b', 'a');
  assert.equal(app.getSnapshot().ordering.status, 'pending');
  assert.equal(await app.reorderPinned('c', 'a'), false);
  assert.deepEqual(calls, [['b', 0]]);
  await app.rename('b', 'Renamed');
  await app.setPinned('a', false);
  await app.setArchived('b', true);
  held.resolve(ready('b', 0));
  assert.equal(await moving, true);
  assert.deepEqual(calls, [
    ['b', 0],
    ['a', 1],
  ]);
  const rows = app.getSnapshot().list.rows;
  assert.equal(rows.find((row) => row.id === 'b')?.title, 'Renamed');
  assert.equal(rows.find((row) => row.id === 'b')?.archived, true);
  assert.equal(rows.find((row) => row.id === 'a')?.pinned, false);
  assert.equal(rows.find((row) => row.id === 'b')?.pinnedOrder, 0);
  assert.equal(app.getSnapshot().ordering.status, 'confirmed');
  assert.ok(Object.isFrozen(app.getSnapshot().ordering));
  app.dispose();
});

test('pinned ordering unconfirmed settlement fences the entire slice and only a later successful list clears the barrier', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const held = deferred<DirectoryResult<ThreadRow>>();
  const calls: [string, number][] = [];
  const app = fixture(
    async (id, rank) => {
      calls.push([id, rank]);
      return calls.length === 1 ? held.promise : { kind: 'failed' };
    },
    async () => {
      const read = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(read);
      return read.promise;
    }
  );
  assert.equal(typeof app.reorderPinned, 'function');
  app.start();
  reads[0].resolve({ kind: 'ready', value: initial });
  await tick();
  const moving = app.reorderPinned('b', 'a');
  app.refresh();
  held.resolve(ready('b', 0));
  assert.equal(await moving, false);
  assert.equal(app.getSnapshot().ordering.status, 'unconfirmed');
  assert.equal(app.canReorderPinned(), false);
  reads[1].resolve({
    kind: 'ready',
    value: initial.map((row) => ({ ...row, pinnedOrder: 99 })),
  });
  await tick();
  assert.equal(app.getSnapshot().ordering.status, 'unconfirmed');
  assert.deepEqual(
    app
      .getSnapshot()
      .list.rows.filter((row) => row.pinned && !row.archived)
      .map((row) => row.pinnedOrder),
    [0, 1, 2]
  );
  assert.equal(await app.reorderPinned('c', 'a'), false);
  app.refresh();
  reads[2].resolve({ kind: 'failed' });
  await tick();
  assert.equal(app.getSnapshot().ordering.status, 'unconfirmed');
  app.refresh();
  reads[3].resolve({
    kind: 'ready',
    value: initial.map((row) => ({ ...row, pinnedOrder: 42 })),
  });
  await tick();
  assert.equal(app.getSnapshot().ordering.status, 'idle');
  assert.equal(app.canReorderPinned(), true);
  assert.equal(app.getSnapshot().list.rows[1].pinnedOrder, 42);
  app.dispose();
});

test('pinned ordering reserves before observer reentry and disposal prevents further dispatch/publication', async () => {
  const held = deferred<DirectoryResult<ThreadRow>>();
  const calls: string[] = [];
  const app = fixture(async (id, rank) => {
    calls.push(id);
    app.dispose();
    return held.promise;
  });
  assert.equal(typeof app.reorderPinned, 'function');
  app.start();
  await tick();
  let duplicate: Promise<boolean> | undefined;
  app.subscribe(() => {
    if (app.getSnapshot().ordering.status === 'pending')
      duplicate = app.reorderPinned('c', 'a');
  });
  const moving = app.reorderPinned('b', 'a');
  const snapshot = app.getSnapshot();
  held.resolve(ready('b', 0));
  assert.equal(await moving, false);
  assert.equal(await duplicate, false);
  assert.deepEqual(calls, ['b']);
  assert.equal(app.getSnapshot(), snapshot);
});

test('pinned ordering limits admitted restamps to the fifty loaded conversation contract', async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: String(index),
    title: String(index),
    pinned: true,
    pinnedOrder: index,
  }));
  const app = fixture(
    async (id, rank) => {
      calls.push(id);
      return ready(id, rank);
    },
    async () => ({ kind: 'ready', value: rows })
  );
  app.start();
  await tick();
  assert.equal(await app.reorderPinned('1', '0'), false);
  assert.deepEqual(calls, []);
  assert.equal(app.getSnapshot().ordering.status, 'idle');
  app.dispose();
});

test('pinned ordering waits for a later held write after immediate failure and fences absent ranks', async () => {
  const held = deferred<DirectoryResult<ThreadRow>>();
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const rows: readonly ThreadRow[] = [
    { id: 'a', title: 'A', pinned: true, pinnedOrder: -1 },
    { id: 'b', title: 'B', pinned: true },
  ];
  let calls = 0;
  const app = fixture(
    async (id, rank) => (++calls === 1 ? { kind: 'failed' } : held.promise),
    async () => {
      const read = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(read);
      return read.promise;
    }
  );
  app.start();
  reads[0].resolve({ kind: 'ready', value: rows });
  await tick();
  assert.equal(await app.reorderPinned('a', 'b'), false);
  assert.equal(calls, 0);
  let settled = false;
  const moving = app.reorderPinned('b', 'a').then((result) => {
    settled = true;
    return result;
  });
  await tick();
  assert.equal(calls, 2);
  assert.equal(settled, false);
  assert.equal(app.getSnapshot().ordering.status, 'pending');
  app.refresh();
  held.resolve(ready('a', 1));
  assert.equal(await moving, false);
  reads[1].resolve({
    kind: 'ready',
    value: rows.map((row) => ({ ...row, pinnedOrder: 99 })),
  });
  await tick();
  assert.deepEqual(
    app.getSnapshot().list.rows.map((row) => row.pinnedOrder),
    [-1, undefined]
  );
  app.refresh();
  reads[2].resolve({ kind: 'ready', value: [] });
  await tick();
  assert.equal(app.getSnapshot().ordering.status, 'idle');
  assert.deepEqual(app.getSnapshot().list.rows, []);
  app.dispose();
});

test('pinned ordering confirmed settlement fences unchanged rows and permits later list authority', async () => {
  const reads: ReturnType<
    typeof deferred<DirectoryResult<readonly ThreadRow[]>>
  >[] = [];
  const app = fixture(
    async (id, rank) => ready(id, rank),
    async () => {
      const read = deferred<DirectoryResult<readonly ThreadRow[]>>();
      reads.push(read);
      return read.promise;
    }
  );
  app.start();
  reads[0].resolve({ kind: 'ready', value: initial });
  await tick();
  app.refresh();
  assert.equal(await app.reorderPinned('b', 'a'), true);
  reads[1].resolve({
    kind: 'ready',
    value: initial.map((row) => ({ ...row, pinnedOrder: 99 })),
  });
  await tick();
  assert.deepEqual(
    app
      .getSnapshot()
      .list.rows.filter((row) => row.pinned && !row.archived)
      .map((row) => row.pinnedOrder),
    [1, 0, 2]
  );
  app.refresh();
  reads[2].resolve({
    kind: 'ready',
    value: initial.map((row) => ({ ...row, pinnedOrder: 42 })),
  });
  await tick();
  assert.equal(app.getSnapshot().list.rows[1].pinnedOrder, 42);
  app.dispose();
});

for (const outcome of [
  'mismatch-id',
  'mismatch-rank',
  'cancelled',
  'throw',
] as const)
  test(`pinned ordering ${outcome} installs an honest unconfirmed barrier with no implicit read`, async () => {
    let reads = 0;
    let writes = 0;
    const app = fixture(
      async (id, rank) => {
        writes++;
        if (outcome === 'throw') throw new Error('transport');
        if (outcome === 'cancelled') return { kind: 'cancelled' };
        return ready(
          outcome === 'mismatch-id' ? 'wrong' : id,
          outcome === 'mismatch-rank' ? 99 : rank
        );
      },
      async () => {
        reads++;
        return { kind: 'ready', value: initial };
      }
    );
    app.start();
    await tick();
    const rows = app.getSnapshot().list.rows;
    assert.equal(await app.reorderPinned('b', 'a'), false);
    assert.equal(writes, 2);
    assert.equal(reads, 1);
    assert.equal(app.getSnapshot().list.rows, rows);
    assert.equal(app.getSnapshot().ordering.status, 'unconfirmed');
    app.dispose();
  });

test('pinned ordering observer disposal before dispatch prevents every write', async () => {
  let writes = 0;
  const app = fixture(async (id, rank) => {
    writes++;
    return ready(id, rank);
  });
  app.start();
  await tick();
  app.subscribe(() => {
    if (app.getSnapshot().ordering.status === 'pending') app.dispose();
  });
  assert.equal(await app.reorderPinned('b', 'a'), false);
  assert.equal(writes, 0);
});

test('pinned ordering does not normalize a legacy no-op and gracefully omits unavailable capability', async () => {
  let writes = 0;
  const rows: readonly ThreadRow[] = [
    { id: 'a', title: 'A', pinned: true, pinnedOrder: -0.5 },
    { id: 'b', title: 'B', pinned: true },
  ];
  const app = fixture(
    async (id, rank) => {
      writes++;
      return ready(id, rank);
    },
    async () => ({ kind: 'ready', value: rows })
  );
  app.start();
  await tick();
  assert.equal(await app.reorderPinned('a', 'b'), false);
  assert.equal(await app.reorderPinned('b', null), false);
  assert.equal(writes, 0);
  app.dispose();
  const unsupported = createApplication({
    directory: {
      get: async () => ({ kind: 'missing' }),
      list: async () => ({ kind: 'ready', value: rows }),
      create: async () => ({ kind: 'failed' }),
    },
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
  });
  unsupported.start();
  await tick();
  assert.equal(unsupported.canReorderPinned(), false);
  assert.equal(await unsupported.reorderPinned('b', 'a'), false);
  unsupported.dispose();
});
