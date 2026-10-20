import { describe, expect, it } from 'vitest';
import { copyData, equalData, plainRecord, closedFields } from './data.js';

describe('owned finite plain data', () => {
  it('captures nested values immutably without retaining caller objects', () => {
    const original = { a: [1, 'é', null, undefined, { b: true }] };
    const captured = copyData(original);
    original.a[0] = 9;
    expect(captured).toEqual({ a: [1, 'é', null, undefined, { b: true }] });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen((captured as any).a[4])).toBe(true);
    expect(equalData({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(equalData({ x: 1 }, { x: 2 })).toBe(false);
  });
  it('does not execute accessors while rejecting them', () => {
    let reads = 0;
    const value = Object.defineProperty({}, 'x', {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(() => copyData(value)).toThrow();
    expect(equalData(value, {})).toBe(false);
    expect(reads).toBe(0);
  });
  it.each([
    NaN,
    Infinity,
    () => 1,
    Symbol(),
    1n,
    new Date(),
    new Map(),
    Object.create({ x: 1 }),
    JSON.parse('{"__proto__":{}}'),
    { constructor: 1 },
    { prototype: 1 },
    // eslint-disable-next-line no-sparse-arrays -- Intentional unsafe sparse-array negative fixture.
    [, 1],
    Object.assign([1], { extra: 2 }),
    { [Symbol()]: 1 },
  ])('rejects unsafe data %#', (value) => {
    expect(() => copyData(value)).toThrow();
  });
  it('rejects arrays with custom or subclass prototypes', () => {
    class Values extends Array<unknown> {}
    expect(() => copyData(new Values(1, 2))).toThrow();
    expect(() =>
      copyData(Object.setPrototypeOf([1], { custom: true }))
    ).toThrow();
  });
  it('rejects cycles, deep data and UTF-8 oversized data', () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(() => copyData(cyclic)).toThrow();
    let deep: any = null;
    for (let i = 0; i < 66; i++) deep = { deep };
    expect(() => copyData(deep)).toThrow();
    expect(() => copyData('é'.repeat(524289))).toThrow();
    expect(() => copyData('a'.repeat(1048576))).not.toThrow();
  });
  it('bounds aggregate UTF-8 capture independently of each individual string', () => {
    expect(() =>
      copyData({ first: 'a'.repeat(600000), second: 'b'.repeat(600000) })
    ).toThrow();
  });
  it('recognizes records and closed field sets without invoking properties', () => {
    expect(plainRecord({ a: 1 })).toBe(true);
    expect(plainRecord([])).toBe(false);
    expect(closedFields({ a: 1 }, ['a'])).toBe(true);
    expect(closedFields({ a: 1, b: 2 }, ['a'])).toBe(false);
  });
});
