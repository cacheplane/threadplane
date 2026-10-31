import { expect, it } from 'vitest';
import {
  projectCheckpointMetadata,
  type CheckpointPage,
} from './checkpoint-metadata';

const page = (value: unknown) => value as CheckpointPage;
it('reads only admitted display metadata and preserves occurrence order', () => {
  const forbidden = {
    get() {
      throw new Error('historical state read');
    },
    enumerable: true,
  };
  const checkpoint = Object.defineProperties(
    { checkpoint_id: '<b>same</b>', checkpoint_ns: '' },
    { checkpoint_map: forbidden, thread_id: forbidden, extra: forbidden }
  );
  const entry = Object.defineProperties(
    { checkpoint, parent_checkpoint: null, created_at: 'now', next: [] },
    {
      values: forbidden,
      tasks: forbidden,
      metadata: forbidden,
      extra: forbidden,
    }
  );
  const result = projectCheckpointMetadata(page([entry, entry, {}]));
  expect(
    result.rows.map((row) => [row.id, row.label, row.description])
  ).toEqual([
    ['0', 'Checkpoint 1', '<b>same</b>'],
    ['1', 'Checkpoint 2', '<b>same</b>'],
    ['2', 'Checkpoint 3', 'Checkpoint ID unavailable'],
  ]);
  expect(result.rows[0].metadata).toEqual({
    checkpointId: '<b>same</b>',
    namespace: 'Root namespace (empty)',
    createdAt: 'now',
    parentId: 'No parent checkpoint',
    nextNames: 'No next nodes',
    truncated: false,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.rows)).toBe(true);
  expect(Object.isFrozen(result.rows[0].metadata)).toBe(true);
});
it('distinguishes malformed and unavailable fields from valid empty metadata', () => {
  const result = projectCheckpointMetadata(
    page([
      null,
      [],
      4,
      { checkpoint: [], parent_checkpoint: [], next: 'bad' },
      {
        checkpoint: { checkpoint_id: '', checkpoint_ns: 4 },
        parent_checkpoint: {},
        next: ['valid', 3],
      },
      { next: Array(2) },
    ])
  );
  for (const row of result.rows) {
    expect(row.metadata.namespace).toBe('Namespace unavailable');
    expect(row.metadata.parentId).toBe('Parent checkpoint ID unavailable');
    expect(row.metadata.nextNames).toBe('Next nodes unavailable');
    expect(row.metadata.createdAt).toBe('Created timestamp unavailable');
  }
  expect(projectCheckpointMetadata(undefined).loaded).toBe(false);
  expect(projectCheckpointMetadata(page([]))).toMatchObject({
    loaded: true,
    rows: [],
    omittedRows: 0,
  });
});
it('bounds rows, UTF-16 strings and next names with explicit truncation metadata', () => {
  const long = 'x'.repeat(511) + '😀suffix';
  const entry = {
    checkpoint: { checkpoint_id: long, checkpoint_ns: long },
    parent_checkpoint: { checkpoint_id: long },
    created_at: long,
    next: Array.from({ length: 12 }, () => long),
  };
  const result = projectCheckpointMetadata(page(Array(13).fill(entry)));
  expect(result.rows).toHaveLength(10);
  expect(result.omittedRows).toBe(3);
  expect(result.rows[0].description).toBe(long.slice(0, 512));
  expect(result.rows[0].metadata.truncated).toBe(true);
  expect(result.rows[0].metadata.nextNames.split(', ')).toHaveLength(10);
  expect(result.rows[0].metadata.namespace.length).toBe(512);
});
it('does not inspect omitted rows or next names beyond the display bound', () => {
  const names = Array(11).fill('node');
  Object.defineProperty(names, 10, {
    get() {
      throw new Error('omitted node read');
    },
  });
  const entries = Array(11).fill({ next: names });
  Object.defineProperty(entries, 10, {
    get() {
      throw new Error('omitted entry read');
    },
  });
  const result = projectCheckpointMetadata(page(entries));
  expect(result.rows).toHaveLength(10);
  expect(result.rows[0].metadata.truncated).toBe(true);
});
it('keeps sparse missing entries as distinct inspectable occurrences', () => {
  const result = projectCheckpointMetadata(page(Array(2)));
  expect(result.rows.map((row) => row.id)).toEqual(['0', '1']);
  expect(result.rows[1].description).toBe('Checkpoint ID unavailable');
});
it('labels observed empty strings separately from unavailable metadata without trimming', () => {
  const result = projectCheckpointMetadata(
    page([
      {
        checkpoint: { checkpoint_id: '', checkpoint_ns: '' },
        parent_checkpoint: { checkpoint_id: '' },
        created_at: '',
        next: [''],
      },
      {},
      {
        checkpoint: { checkpoint_id: ' ', checkpoint_ns: ' ' },
        parent_checkpoint: { checkpoint_id: ' ' },
        created_at: ' ',
        next: [' '],
      },
    ])
  );
  expect(result.rows[0].description).toBe('Checkpoint ID empty');
  expect(result.rows[0].metadata).toEqual({
    checkpointId: 'Checkpoint ID empty',
    namespace: 'Root namespace (empty)',
    parentId: 'Parent checkpoint ID empty',
    createdAt: 'Created timestamp empty',
    nextNames: 'Empty next-node name',
    truncated: false,
  });
  expect(result.rows[1].metadata).toEqual({
    checkpointId: 'Checkpoint ID unavailable',
    namespace: 'Namespace unavailable',
    parentId: 'Parent checkpoint ID unavailable',
    createdAt: 'Created timestamp unavailable',
    nextNames: 'Next nodes unavailable',
    truncated: false,
  });
  expect(result.rows[2].metadata).toEqual({
    checkpointId: ' ',
    namespace: ' ',
    parentId: ' ',
    createdAt: ' ',
    nextNames: ' ',
    truncated: false,
  });
});
