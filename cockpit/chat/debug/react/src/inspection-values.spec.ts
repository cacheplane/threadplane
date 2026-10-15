import { describe, it, expect } from 'vitest';
import { captureInspectionValues as capture } from './inspection-values';
describe('selected values ownership', () => {
  it('distinguishes missing values from valid only-messages and never reads messages', () => {
    expect(capture(undefined).kind).toBe('unavailable');
    expect(capture(null).kind).toBe('unavailable');
    const v = {};
    Object.defineProperty(v, 'messages', {
      enumerable: true,
      get() {
        throw Error('transcript read');
      },
    });
    expect(capture(v)).toEqual({ kind: 'available', values: {} });
  });
  it('owns and recursively freezes nonmessage fields before caller mutation', () => {
    const source = {
      messages: ['private'],
      analysis: { characters: 4, words: 1 },
    };
    const result = capture(source);
    expect(result.kind).toBe('available');
    source.analysis.words = 99;
    if (result.kind === 'available') {
      expect(result.values).toEqual({ analysis: { characters: 4, words: 1 } });
      expect(Object.isFrozen(result.values)).toBe(true);
      expect(Object.isFrozen(result.values.analysis)).toBe(true);
      expect('messages' in result.values).toBe(false);
    }
  });
  it.each([
    NaN,
    Infinity,
    () => 1,
    new Date(),
    {
      get a() {
        throw Error('getter');
      },
    },
    new Array(2),
  ])('rejects unsupported capture', (v) =>
    expect(capture({ field: v }).kind).toBe('unavailable')
  );
  it('rejects cycles, excessive entries, depth, codepoints, keys, and 128KiB total without partial output', () => {
    const cycle: any = {};
    cycle.self = cycle;
    for (const field of [
      cycle,
      Array.from({ length: 201 }, () => 0),
      '🛩'.repeat(2001),
      { ['x'.repeat(2001)]: 1 },
      Array.from({ length: 100 }, () => 'x'.repeat(1900)),
      { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    ])
      expect(capture({ field }).kind).toBe('unavailable');
  });
  it('counts escaped UTF8 JSON overhead at the exact 128KiB boundary', () => {
    const values: Record<string, string> = {};
    for (let i = 0; i < 10; i++) values['k' + i] = '\0'.repeat(2000);
    values.tail = '';
    const budget =
      131072 - new TextEncoder().encode(JSON.stringify(values)).length;
    values.tail = '\0'.repeat(Math.floor(budget / 6)) + 'x'.repeat(budget % 6);
    expect(new TextEncoder().encode(JSON.stringify(values)).length).toBe(
      131072
    );
    expect(capture(values).kind).toBe('available');
    values.tail += 'x';
    expect(capture(values).kind).toBe('unavailable');
  });
  it('rejects class-derived arrays as unsupported owned values', () => {
    class Specialized extends Array<number> {}
    expect(capture({ field: new Specialized(1, 2) }).kind).toBe('unavailable');
  });
});
