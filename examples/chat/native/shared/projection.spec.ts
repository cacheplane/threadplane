import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '@langchain/langgraph-sdk';
import {
  projectThread,
  projectThreads,
  filterLoadedTitles,
  orderActiveThreads,
} from './projection.js';

function envelope(title: unknown): Thread {
  return {
    thread_id: 'one',
    created_at: '',
    updated_at: '',
    state_updated_at: '',
    status: 'idle',
    metadata: { title },
    values: { messages: [] },
    interrupts: {},
  };
}

test('projection parses backend timestamps into frozen independent epoch snapshots', () => {
  for (const updated_at of [
    '2026-09-28T00:00:01.000Z',
    '1970-01-01T00:00:00.000Z',
    '1969-12-31T23:59:59.000Z',
    '-271821-04-20T00:00:00.000Z',
    '+275760-09-13T00:00:00.000Z',
  ]) {
    const source = { ...envelope('Title'), updated_at };
    const row = projectThread(source);
    assert.deepEqual(row, {
      id: 'one',
      title: 'Title',
      updatedAt: Date.parse(updated_at),
    });
    source.updated_at = '';
    assert.equal(row.updatedAt, Date.parse(updated_at));
    assert.ok(Object.isFrozen(row));
    assert.equal(Reflect.set(row, 'updatedAt', 1), false);
  }
});

test('projection omits missing, invalid and non-string backend timestamps', () => {
  for (const updated_at of [
    undefined,
    null,
    '',
    'invalid',
    '+275760-09-13T00:00:00.001Z',
    0,
    Infinity,
    {},
    new Date(0),
  ]) {
    const source = { ...envelope('Title'), updated_at } as unknown as Thread;
    assert.deepEqual(projectThread(source), { id: 'one', title: 'Title' });
  }
});

test('projection copies only display fields and retains immutable snapshots', () => {
  const source = envelope(' Original ');
  const input = [source];
  const rows = projectThreads(input);
  assert.deepEqual(rows, [{ id: 'one', title: 'Original' }]);
  source.metadata!.title = 'Changed';
  source.thread_id = 'changed';
  input.splice(0);
  assert.deepEqual(rows, [{ id: 'one', title: 'Original' }]);
  assert.ok(Object.isFrozen(rows));
  assert.ok(Object.isFrozen(rows[0]));
  assert.equal(Reflect.set(rows[0], 'title', 'change'), false);
});

test('projection uses only nonempty metadata.title, otherwise Untitled', () => {
  for (const title of [undefined, null, '', ' \t ', 42, {}, ['title']])
    assert.equal(projectThread(envelope(title)).title, 'Untitled');
  assert.equal(projectThread(envelope('A title')).title, 'A title');
  assert.equal(
    projectThread({ ...envelope('ignored'), metadata: null }).title,
    'Untitled'
  );
});

test('projection explicitly filters loaded titles case insensitively without changing retained arrays', () => {
  const rows = projectThreads([
    envelope('Planning'),
    { ...envelope('Weekend'), thread_id: 'two' },
  ]);
  const filtered = filterLoadedTitles(rows, ' PLAN ');
  assert.deepEqual(filtered, [{ id: 'one', title: 'Planning' }]);
  assert.ok(Object.isFrozen(filtered));
  assert.equal(rows.length, 2);
  assert.deepEqual(filterLoadedTitles(rows, 'two'), []);
  assert.deepEqual(filterLoadedTitles(rows, ' '), rows);
});

test('projection copies only strict true pin metadata into independent frozen snapshots without sorting', () => {
  for (const pinned of [true, false, undefined, null, 'true', 1, {}, []]) {
    const source = {
      ...envelope('Title'),
      metadata: { title: 'Title', pinned },
    };
    const row = projectThread(source);
    assert.deepEqual(row, {
      id: 'one',
      title: 'Title',
      ...(pinned === true ? { pinned: true } : {}),
    });
    source.metadata.pinned = pinned === true ? false : true;
    assert.equal(row.pinned, pinned === true ? true : undefined);
    assert.ok(Object.isFrozen(row));
    assert.equal(Reflect.set(row, 'pinned', false), false);
  }
  assert.deepEqual(projectThread({ ...envelope('ignored'), metadata: null }), {
    id: 'one',
    title: 'Untitled',
  });
  const rows = projectThreads([
    envelope('Plain'),
    {
      ...envelope('Pinned'),
      thread_id: 'two',
      metadata: { title: 'Pinned', pinned: true },
    },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['one', 'two']
  );
  const filtered = filterLoadedTitles(rows, 'pin');
  assert.equal(filtered[0], rows[1]);
  assert.ok(Object.isFrozen(filtered));
});

test('projection copies only strict true archive metadata into independent frozen snapshots without sorting', () => {
  for (const archived of [true, false, undefined, null, 'true', 1, {}, []]) {
    const source = {
      ...envelope('Title'),
      metadata: { title: 'Title', archived },
    };
    const row = projectThread(source);
    assert.deepEqual(row, {
      id: 'one',
      title: 'Title',
      ...(archived === true ? { archived: true } : {}),
    });
    source.metadata.archived = archived === true ? false : true;
    assert.equal(row.archived, archived === true ? true : undefined);
    assert.ok(Object.isFrozen(row));
    assert.equal(Reflect.set(row, 'archived', false), false);
  }
  assert.deepEqual(projectThread({ ...envelope('ignored'), metadata: null }), {
    id: 'one',
    title: 'Untitled',
  });
  const rows = projectThreads([
    envelope('Plain'),
    {
      ...envelope('Archived'),
      thread_id: 'two',
      metadata: { title: 'Archived', archived: true },
    },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['one', 'two']
  );
  const filtered = filterLoadedTitles(rows, 'archive');
  assert.equal(filtered[0], rows[1]);
  assert.ok(Object.isFrozen(filtered));
});

test('pinned ordering projects only finite ranks and stably groups the active loaded slice', async () => {
  for (const rank of [-2, 0, 0.5, 42, undefined, null, '2', NaN, Infinity]) {
    const row = projectThread({
      ...envelope('Rank'),
      metadata: { pinnedOrder: rank },
    });
    assert.equal(
      row.pinnedOrder,
      typeof rank === 'number' && Number.isFinite(rank) ? rank : undefined
    );
  }
  const rows = Object.freeze(
    [
      { id: 'u', title: 'U' },
      { id: 'missing', title: 'M', pinned: true },
      { id: 'two', title: 'T', pinned: true, pinnedOrder: 2 },
      {
        id: 'archived',
        title: 'A',
        pinned: true,
        pinnedOrder: -10,
        archived: true,
      },
      { id: 'first', title: 'F', pinned: true, pinnedOrder: -1 },
      { id: 'tie', title: 'T', pinned: true, pinnedOrder: 2 },
      { id: 'invalid', title: 'I', pinned: true, pinnedOrder: NaN },
      { id: 'v', title: 'V' },
    ].map((row) => Object.freeze(row))
  );
  const ordered = orderActiveThreads(rows);
  assert.deepEqual(
    ordered.map((row) => row.id),
    ['first', 'two', 'tie', 'missing', 'invalid', 'u', 'v']
  );
  assert.equal(ordered[0], rows[4]);
  assert.ok(Object.isFrozen(ordered));
  assert.equal(rows[0].id, 'u');
});

test('projection preserves exact nonblank project IDs and omits invalid associations', () => {
  for (const projectId of ['alpha', ' p/b ', '<Project>', '__proto__']) {
    const source = {
      ...envelope('Title'),
      metadata: { title: 'Title', projectId },
    };
    const row = projectThread(source);
    assert.equal(row.projectId, projectId);
    source.metadata.projectId = 'changed';
    assert.equal(row.projectId, projectId);
    assert.ok(Object.isFrozen(row));
  }
  for (const projectId of [undefined, null, '', ' \t ', 1, true, {}, ['p']]) {
    const row = projectThread({
      ...envelope('Title'),
      metadata: { title: 'Title', projectId },
    });
    assert.equal(Object.hasOwn(row, 'projectId'), false);
  }
});
