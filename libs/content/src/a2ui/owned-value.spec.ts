import { describe, expect, it } from 'vitest';
import { captureValue } from './owned-value.js';

describe('A2UI owned values', () => {
  it('owns and freezes nested plain data without normalizing undefined or holes', () => {
    const array = new Array(3);
    array[1] = undefined;
    array[2] = { text: 'before' };
    const input = { array, nil: null, flag: true, number: 3, text: 'hi' };
    const result = captureValue(input) as typeof input;
    array[2].text = 'after';
    expect(result.array[2]).toEqual({ text: 'before' });
    expect(0 in result.array).toBe(false);
    expect(1 in result.array).toBe(true);
    expect(Object.isFrozen(result.array[2])).toBe(true);
    expect(Object.isFrozen(result.array)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => { result.array[2].text = 'no'; }).toThrow();
  });

  it('preserves own literal keys and deliberately retains null prototypes', () => {
    for (const prototype of [Object.prototype, null]) {
      const input = Object.create(prototype);
      for (const key of ['__proto__', 'constructor', 'prototype', 'hidden']) {
        Object.defineProperty(input, key, { value: { ok: true }, enumerable: key !== 'hidden' });
      }
      const result = captureValue(input) as object;
      expect(Object.getPrototypeOf(result)).toBe(prototype);
      for (const key of Object.getOwnPropertyNames(input)) {
        expect(Object.hasOwn(result, key)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(result, key)?.enumerable)
          .toBe(Object.getOwnPropertyDescriptor(input, key)?.enumerable);
      }
    }
  });

  it('rejects accessors without invoking them, including nonenumerable accessors', () => {
    let calls = 0;
    const input = Object.defineProperty({}, 'value', { get() { calls++; return 1; } });
    expect(() => captureValue(input)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it('rejects unsupported values and array properties', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const symbol = { [Symbol('key')]: 1 };
    const propertyArray = Object.assign([], { extra: 1 });
    for (const value of [NaN, Infinity, -Infinity, 1n, Symbol(), () => 1,
      new Date(), new Map(), cyclic, symbol, propertyArray]) {
      expect(() => captureValue(value)).toThrow(TypeError);
    }
  });

  it('accepts shared acyclic branches and owns each branch', () => {
    const shared = { text: 'yes' };
    const result = captureValue({ a: shared, b: shared });
    expect(result).toEqual({ a: shared, b: shared });
    expect((result as { a: unknown }).a).not.toBe(shared);
  });
});
