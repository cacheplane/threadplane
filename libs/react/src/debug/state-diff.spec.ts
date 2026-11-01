import { expect, it, vi } from 'vitest';
import { compareDebugStates } from './state-diff';

function changes(before: unknown, after: unknown) {
  const result = compareDebugStates(before, after);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.status);
  expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(
    32768
  );
  return JSON.parse(result.text);
}
it('compares own keys recursively in before-first order and preserves missing versus null', () => {
  expect(
    changes(
      { removed: null, nested: { old: false, same: '' } },
      { nested: { same: '', old: true }, added: null }
    )
  ).toEqual([
    { kind: 'removed', path: '/removed', before: null },
    { kind: 'changed', path: '/nested/old', before: false, after: true },
    { kind: 'added', path: '/added', after: null },
  ]);
});
it('ignores object ordering everywhere but reports a differing array atomically', () => {
  expect(
    changes({ a: [{ x: 1, y: 2 }], b: true }, { b: true, a: [{ y: 2, x: 1 }] })
  ).toEqual([]);
  expect(changes([1, 2], [2, 1])).toEqual([
    { kind: 'changed', path: '', before: [1, 2], after: [2, 1] },
  ]);
  expect(changes(null, {})).toEqual([
    { kind: 'changed', path: '', before: null, after: {} },
  ]);
});
it('escapes JSON Pointer tokens while preserving literal special own keys', () => {
  const before = JSON.parse('{"__proto__":1,"constructor":2,"a~/b.c":false}');
  const after = JSON.parse('{"__proto__":2,"constructor":3,"a~/b.c":true}');
  expect(changes(before, after)).toEqual([
    { kind: 'changed', path: '/__proto__', before: 1, after: 2 },
    { kind: 'changed', path: '/constructor', before: 2, after: 3 },
    { kind: 'changed', path: '/a~0~1b.c', before: false, after: true },
  ]);
});
it('refuses invalid inputs before equality without invoking getters', () => {
  const getter = vi.fn(() => 1);
  const accessor = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: getter,
  });
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  for (const invalid of [
    undefined,
    NaN,
    Infinity,
    cyclic,
    accessor,
    new Date(),
  ]) {
    expect(compareDebugStates(invalid, invalid).status).toBe('invalid');
  }
  expect(getter).not.toHaveBeenCalled();
});
it('refuses all truncated inputs, including equal prefixes, without visiting tails', () => {
  let deep: unknown = 1;
  for (let i = 0; i < 7; i++) deep = { child: deep };
  const entries = Object.fromEntries(
    Array.from({ length: 201 }, (_, i) => [i, i])
  );
  const tail = vi.fn(() => {
    throw new Error('unvisited');
  });
  Object.defineProperty(entries, 'tail', { enumerable: true, get: tail });
  const bytes = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [i, '😀'.repeat(1000)])
  );
  for (const limited of [
    deep,
    entries,
    'x'.repeat(2001),
    { ['k'.repeat(2001)]: true },
    bytes,
  ]) {
    expect(compareDebugStates(limited, limited).status).toBe('input-limit');
  }
  expect(tail).not.toHaveBeenCalled();
});
it('refuses output entry, string, depth and byte amplification rather than partial changes', () => {
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, 1]));
  const manyAfter = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [i, 2])
  );
  const longKey = { ['k'.repeat(2000)]: { child: 1 } };
  const longAfter = { ['k'.repeat(2000)]: { child: 2 } };
  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  const wide = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i, 'x'.repeat(1800)])
  );
  const wideAfter = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i, 'y'.repeat(1800)])
  );
  for (const [before, after] of [
    [many, manyAfter],
    [longKey, longAfter],
    [null, deep],
    [wide, wideAfter],
  ]) {
    expect(compareDebugStates(before, after).status).toBe('output-limit');
  }
});
