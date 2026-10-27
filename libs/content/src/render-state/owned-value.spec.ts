import { describe, expect, it } from 'vitest';
import { captureRecord, captureValue } from './owned-value.js';

describe('owned render-state data', () => {
  it('requires an own descriptor value even when Object.prototype supplies one', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'bad', { enumerable: true, get() { reads++; return 1; } });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    if (prior) Object.setPrototypeOf(prior, null);
    let failure: unknown;
    try {
      Object.defineProperty(Object.prototype, 'value', { configurable: true, writable: true, value: 3 });
      captureRecord(input);
    } catch (error) {
      failure = error;
    } finally {
      if (prior) Object.defineProperty(Object.prototype, 'value', prior);
      else Reflect.deleteProperty(Object.prototype, 'value');
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
  });
  it('normalizes sparse holes without reading inherited numeric descriptors', () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, '7');
    let result: readonly unknown[] = [];
    try {
      Object.defineProperty(Object.prototype, '7', { configurable: true, writable: true, value: { value: 'inherited-hole' } });
      result = captureValue(new Array(8)) as readonly unknown[];
    } finally {
      if (prior) Object.defineProperty(Object.prototype, '7', prior);
      else Reflect.deleteProperty(Object.prototype, '7');
    }
    expect(result[7]).toBeUndefined();
    expect(Object.hasOwn(result, '7')).toBe(true);
    expect(Object.keys(result)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });
  it('does not invoke inherited numeric descriptor getters while capturing sparse arrays', () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, '7');
    let reads = 0;
    let failure: unknown;
    let result: readonly unknown[] = [];
    try {
      Object.defineProperty(Object.prototype, '7', {
        configurable: true,
        get() { reads++; throw new Error('Inherited descriptor getter must stay unread'); },
        set(value) { Object.defineProperty(this, '7', { value, writable: true, enumerable: true, configurable: true }); },
      });
      result = captureValue(new Array(8)) as readonly unknown[];
    } catch (error) {
      failure = error;
    } finally {
      if (prior) Object.defineProperty(Object.prototype, '7', prior);
      else Reflect.deleteProperty(Object.prototype, '7');
    }
    expect(failure).toBeUndefined();
    expect(reads).toBe(0);
    expect(result[7]).toBeUndefined();
    expect(Object.hasOwn(result, '7')).toBe(true);
  });
  it('captures independent recursively frozen null-prototype records', () => {
    const input = { nested: { values: [1, { name: 'first' }] } };
    const result = captureRecord(input);
    expect(result).not.toBe(input);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(result.nested)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nested)).toBe(true);
    const nested = result.nested as { readonly values: readonly unknown[] };
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(Object.isFrozen(nested.values[1])).toBe(true);
    input.nested.values.push(3);
    expect(nested.values).toHaveLength(2);
  });
  it('captures repeated noncyclic aliases independently', () => {
    const shared = { value: 1 };
    const result = captureRecord({ a: shared, b: shared });
    expect(result.a).toEqual(result.b);
    expect(result.a).not.toBe(result.b);
    shared.value = 2;
    expect(result.a).toEqual({ value: 1 });
  });
  it('preserves own prototype names and ignores nonenumerable record data', () => {
    const input = Object.create(null);
    input.__proto__ = { safe: true };
    input.constructor = 'own';
    Object.defineProperty(input, 'hidden', { value: () => 1 });
    const result = captureRecord(input);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result.__proto__).toEqual({ safe: true });
    expect(result.constructor).toBe('own');
    expect(Object.hasOwn(result, 'hidden')).toBe(false);
  });
  it('normalizes every sparse slot to own undefined', () => {
    const sparse = new Array(3);
    sparse[1] = 2;
    const result = captureValue(sparse) as readonly unknown[];
    expect(result).toEqual([undefined, 2, undefined]);
    expect(Object.keys(result)).toEqual(['0', '1', '2']);
  });
  it('rejects accessors without evaluating them, including hidden accessors', () => {
    let calls = 0;
    for (const enumerable of [true, false]) {
      const input = Object.defineProperty({}, 'value', {
        enumerable, get: () => { calls++; return 1; },
      });
      expect(() => captureRecord(input)).toThrow(TypeError);
    }
    const array = Object.defineProperty([], '0', { get: () => { calls++; return 1; } });
    expect(() => captureValue(array)).toThrow(TypeError);
    expect(calls).toBe(0);
  });
  it.each([NaN, Infinity, -Infinity, Symbol('value'), () => 1, new Date(), new Map(), new (class Example {})()])('rejects unsupported nested values %s', value => {
    expect(() => captureRecord({ value })).toThrow(TypeError);
  });
  it('rejects symbols and cycles', () => {
    expect(() => captureRecord({ [Symbol('key')]: 1 })).toThrow(TypeError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => captureRecord(cyclic)).toThrow(TypeError);
    const array: unknown[] = []; array.push(array);
    expect(() => captureValue(array)).toThrow(TypeError);
  });
  it('rejects exotic arrays', () => {
    const extra = Object.assign([1], { extra: 2 });
    const hidden = Object.defineProperty([], 'extra', { value: 1 });
    const symbol = Object.assign([], { [Symbol('key')]: 1 });
    const noncanonical = Object.assign([], { '01': 1 });
    const subclass = new (class extends Array {})();
    const nullPrototype = Object.setPrototypeOf([], null);
    for (const value of [extra, hidden, symbol, noncanonical, subclass, nullPrototype]) {
      expect(() => captureValue(value)).toThrow(TypeError);
    }
  });
  it.each([[], 1, 'value', true, null, undefined].map(value => ({ value })))('rejects root nonrecords $value', ({ value }) => {
    expect(() => captureRecord(value)).toThrow(TypeError);
  });
  it('accepts all supported scalars and null-prototype input', () => {
    const value = Object.assign(Object.create(null), { data: [null, undefined, false, '', 0, -1.5] });
    expect(captureRecord(value)).toEqual(value);
  });
});
