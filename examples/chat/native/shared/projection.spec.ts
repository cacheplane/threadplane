import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '@langchain/langgraph-sdk';
import {
  projectThread,
  projectThreads,
  filterLoadedTitles,
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
