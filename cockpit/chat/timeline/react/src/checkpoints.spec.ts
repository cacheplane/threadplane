import { describe, expect, it } from 'vitest';
import { copyData, captureHistoryPage } from './checkpoints';

const row = (id = 'c1') => ({
  checkpoint: { thread_id: 't', checkpoint_ns: '', checkpoint_id: id },
  next: [],
  values: { messages: ['secret'] },
});
describe('owned data', () => {
  it.each(['4294967295', '9007199254740993'])(
    'rejects an array hole masked by numeric non-index property %s',
    (key) => {
      const value = new Array(1);
      Object.defineProperty(value, key, {
        value: 'masked hole',
        enumerable: true,
      });
      expect(() => copyData(value)).toThrow('Malformed array');
    }
  );
  it('owns and freezes nested data without modifying the original', () => {
    const source = { a: [{ text: 'literal' }] };
    const result = copyData(source) as typeof source;
    source.a[0].text = 'changed';
    expect(result.a[0].text).toBe('literal');
    expect(Object.isFrozen(result.a[0])).toBe(true);
  });
  it.each([
    NaN,
    Infinity,
    new Date(),
    Symbol(),
    () => 1,
    new Array(2),
    Object.assign([], { extra: 1 }),
    { [Symbol()]: 1 },
  ])('rejects unsupported data %s', (value) =>
    expect(() => copyData(value)).toThrow()
  );
  it('rejects cycles and accessors without evaluating them', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => copyData(cyclic)).toThrow();
    let calls = 0;
    expect(() =>
      copyData({
        get bad() {
          calls++;
          return 1;
        },
      })
    ).toThrow();
    expect(calls).toBe(0);
  });
});
describe('checkpoint metadata', () => {
  it('keeps server order and owns only metadata', () => {
    const rows = captureHistoryPage([row('b'), row('a')], 't')!;
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0].source?.checkpoint_id).toBe('b');
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(Object.isFrozen(rows[0].source)).toBe(true);
  });
  it.each([
    { thread_id: 'other' },
    { checkpoint_ns: 'child' },
    { checkpoint_id: '' },
    { checkpoint_map: { a: 3 } },
    { checkpoint_map: null },
  ])('keeps invalid checkpoint unavailable %s', (patch) => {
    const value = row();
    Object.assign(value.checkpoint, patch);
    expect(captureHistoryPage([value], 't')![0].source).toBeNull();
  });
  it('disables pending, malformed next and duplicate identities', () => {
    expect(
      captureHistoryPage([row(), row()], 't')!.every((r) => !r.source)
    ).toBe(true);
    for (const next of [['generate'], null, [3]])
      expect(
        captureHistoryPage([{ ...row(), next }], 't')![0].source
      ).toBeNull();
  });
  it('never evaluates accessors even on ignored transcript data', () => {
    let calls = 0;
    expect(
      captureHistoryPage(
        [
          {
            ...row(),
            get values() {
              calls++;
              return {};
            },
          },
        ],
        't'
      )
    ).toBeUndefined();
    expect(calls).toBe(0);
  });
});
