import { describe, it, expect } from 'vitest';
import {
  captureCheckpoint,
  sameCheckpoint,
  captureCheckpointPage as page,
  selectCheckpoint,
} from './checkpoint-page';
const cp = (id = 'a') => ({
  thread_id: 't',
  checkpoint_ns: '',
  checkpoint_id: id,
});
describe('metadata-only bounded history', () => {
  it('captures first ten metadata in backend order without reading values or tasks', () => {
    const row = {
      checkpoint: cp(),
      created_at: 'now',
      next: ['process'],
      get values() {
        throw Error('values');
      },
      get tasks() {
        throw Error('tasks');
      },
    };
    const p = page([row, { checkpoint: cp('b') }], 'context', 't', 3);
    expect(p.kind).toBe('available');
    expect(p.rows.map((r: any) => r.checkpoint?.checkpoint_id)).toEqual([
      'a',
      'b',
    ]);
    expect(
      selectCheckpoint(p, {
        context: 'context',
        threadId: 't',
        generation: 3,
        key: p.rows[0].key,
      })
    ).toEqual(cp());
  });
  it('rejects empty undefined malformed and oversized pages', () => {
    for (const v of [
      undefined,
      {},
      Array.from({ length: 11 }, (_, i) => ({ checkpoint: cp(String(i)) })),
    ])
      expect(page(v, 'c', 't', 1).kind).toBe('unavailable');
  });
  it('distinguishes an observed empty page and accepts full safe maps independent of key order', () => {
    expect(page([], 'c', 't', 1).kind).toBe('available');
    const a = captureCheckpoint(
      { ...cp(), checkpoint_map: { child: 'b', '': 'a' } },
      't'
    );
    expect(a?.checkpoint_map).toEqual({ child: 'b', '': 'a' });
  });
  it('marks missing wrong namespace/thread/map duplicate identities uninspectable', () => {
    const p = page(
      [
        { checkpoint: cp() },
        { checkpoint: cp() },
        {},
        { checkpoint: { ...cp('b'), checkpoint_ns: 'child' } },
        { checkpoint: { ...cp('c'), thread_id: 'other' } },
        { checkpoint: { ...cp('d'), checkpoint_map: { '': 3 } } },
      ],
      'c',
      't',
      1
    );
    expect(p.rows).toHaveLength(6);
    expect(p.rows.every((r: any) => !r.inspectable)).toBe(true);
  });
  it('owns identity/map and validates entire stale tuple', () => {
    const c = { ...cp(), checkpoint_map: { '': 'a' } };
    const p = page([{ checkpoint: c }], 'c', 't', 2);
    c.checkpoint_id = 'mutated';
    c.checkpoint_map[''] = 'mutated';
    const token = {
      context: 'c',
      threadId: 't',
      generation: 2,
      key: p.rows[0].key,
    };
    expect(selectCheckpoint(p, token)).toEqual({
      ...cp(),
      checkpoint_map: { '': 'a' },
    });
    for (const bad of [
      { ...token, context: 'x' },
      { ...token, threadId: 'x' },
      { ...token, generation: 1 },
      { ...token, key: 'x' },
    ])
      expect(selectCheckpoint(p, bad)).toBeUndefined();
    expect(
      captureCheckpoint(
        {
          get thread_id() {
            throw Error('getter');
          },
        },
        't'
      )
    ).toBeUndefined();
  });
  it('copies safe intermediate next/parent metadata and omits oversized date labels', () => {
    const p = page(
      [
        {
          checkpoint: cp(),
          next: ['process'],
          parent_checkpoint: cp('parent'),
          created_at: 'x'.repeat(1000000),
        },
      ],
      'c',
      't',
      1
    );
    expect(p.rows[0].inspectable).toBe(true);
    expect(p.rows[0].next).toEqual(['process']);
    expect(p.rows[0].parentCheckpoint).toEqual(cp('parent'));
    expect(p.rows[0].createdAt).toBeUndefined();
    expect(
      sameCheckpoint(
        captureCheckpoint(
          { ...cp(), checkpoint_map: { child: 'b', '': 'a' } },
          't'
        ),
        captureCheckpoint(
          { ...cp(), checkpoint_map: { '': 'a', child: 'b' } },
          't'
        )
      )
    ).toBe(true);
    expect(
      sameCheckpoint(
        captureCheckpoint(cp(), 't'),
        captureCheckpoint({ ...cp(), checkpoint_map: {} }, 't')
      )
    ).toBe(false);
  });
});
