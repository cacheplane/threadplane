import { expect, it } from 'vitest';
import { captureHistoryPage } from './checkpoint-history';

const checkpoint = (id = 'root-A') => ({
  thread_id: 'thread-A',
  checkpoint_ns: '',
  checkpoint_id: id,
});
const entry = (id = 'root-A') => ({
  checkpoint: checkpoint(id),
  parent_checkpoint: checkpoint('parent-A'),
  created_at: '<literal date>',
  next: [] as string[],
});

it('owns full eligible root references without changing page order', () => {
  const a = entry(),
    b = entry('root-B');
  const source = {
    ...a,
    checkpoint: {
      ...a.checkpoint,
      checkpoint_map: { '': 'root-A', child: 'child-A' },
    },
  };
  const page = captureHistoryPage([b, source], 'thread-A')!;
  expect(page.map((row) => row.id)).toEqual(['root-B', 'root-A']);
  expect(page[1].source).toEqual(source.checkpoint);
  expect(page[1].createdAt).toBe('<literal date>');
  expect(page[1].parentId).toBe('parent-A');
  source.checkpoint.checkpoint_map.child = 'mutated';
  source.next.push('mutated');
  expect(page[1].source?.checkpoint_map?.['child']).toBe('child-A');
  expect(page[1].next).toEqual([]);
  expect(Object.isFrozen(page[1].source?.checkpoint_map)).toBe(true);
  expect(Object.isFrozen(page)).toBe(true);
});

it.each([
  { thread_id: 'other' },
  { checkpoint_ns: 'child:literal' },
  { checkpoint_id: '' },
  { checkpoint_id: '   ' },
  { checkpoint_map: null },
  { checkpoint_map: { child: { id: 'nested' } } },
  { checkpoint_map: { child: 1 } },
])('retains unavailable checkpoint row without authority: %j', (change) => {
  const page = captureHistoryPage(
    [{ ...entry(), checkpoint: { ...checkpoint(), ...change } }],
    'thread-A'
  )!;
  expect(page).toHaveLength(1);
  expect(page[0].source).toBeNull();
  expect(page[0].unavailable).toBeTruthy();
});

it('withholds every duplicate root ID even when one row is pending', () => {
  const rows = captureHistoryPage(
    [entry(), { ...entry(), next: ['generate'] }, entry('unique')],
    'thread-A'
  )!;
  expect(rows.slice(0, 2).every((row) => row.source === null)).toBe(true);
  expect(rows[2].source?.checkpoint_id).toBe('unique');
});

it.each([['generate'], [1], undefined, null])(
  'pending or malformed next cannot grant authority: %j',
  (next) => {
    expect(
      captureHistoryPage([{ ...entry(), next }], 'thread-A')![0].source
    ).toBeNull();
  }
);

it('distinguishes observed empty page from missing or malformed history', () => {
  expect(captureHistoryPage([], 'thread-A')).toEqual([]);
  expect(captureHistoryPage(undefined, 'thread-A')).toBeUndefined();
  expect(captureHistoryPage({}, 'thread-A')).toBeUndefined();
  const page = captureHistoryPage([null, {}], 'thread-A')!;
  expect(page).toHaveLength(2);
  expect(page.every((row) => row.source === null)).toBe(true);
});

it('never promotes inherited references or map fields', () => {
  const inherited = Object.create({ ...checkpoint() });
  const map = Object.create({ child: 'inherited' });
  expect(
    captureHistoryPage([{ ...entry(), checkpoint: inherited }], 'thread-A')![0]
      .source
  ).toBeNull();
  expect(
    captureHistoryPage(
      [{ ...entry(), checkpoint: { ...checkpoint(), checkpoint_map: map } }],
      'thread-A'
    )![0].source
  ).toBeNull();
});

it('fences reentrant getters before reading any subsequent external field', () => {
  let valid = true,
    laterReads = 0;
  const value = {
    get checkpoint() {
      valid = false;
      return checkpoint();
    },
    get next() {
      laterReads++;
      return [];
    },
  };
  expect(captureHistoryPage([value], 'thread-A', () => valid)).toBeUndefined();
  expect(laterReads).toBe(0);
});

it('captures each external checkpoint field once and owns the result', () => {
  let reads = 0;
  const source = {
    ...checkpoint(),
    get checkpoint_map() {
      reads++;
      return { '': 'root-A' };
    },
  };
  expect(
    captureHistoryPage([{ ...entry(), checkpoint: source }], 'thread-A')![0]
      .source?.checkpoint_map
  ).toEqual({ '': 'root-A' });
  expect(reads).toBe(1);
});
