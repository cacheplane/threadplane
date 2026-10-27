import { describe, expect, it } from 'vitest';
import { captureRecord, captureValue } from './owned-value.js';
import { applyPointer, parsePointer, readPointer } from './pointer.js';
import type { RenderStateSnapshot } from './types.js';

const read = (state: RenderStateSnapshot, path: string) => readPointer(state, parsePointer(path));
const write = (state: RenderStateSnapshot, path: string, value: unknown) => applyPointer(state, parsePointer(path), captureValue(value));

describe('private render-state pointers', () => {
  it('ignores inherited numeric data when writing through an absent array index', () => {
    const state = captureRecord({ items: [] });
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '7');
    let next = state;
    try {
      Object.defineProperty(Array.prototype, '7', { configurable: true, writable: true, value: { inherited: 'unexpected' } });
      next = write(state, '/items/7/value', 1);
    } finally {
      if (prior) Object.defineProperty(Array.prototype, '7', prior);
      else Reflect.deleteProperty(Array.prototype, '7');
    }
    expect(read(next, '/items/7')).toEqual({ value: 1 });
    expect(read(next, '/items/7/inherited')).toBeUndefined();
    expect(read(state, '/items')).toEqual([]);
    expect(Object.keys(read(next, '/items') as object)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });
  it('never invokes an inherited numeric getter on the owned array during writes', () => {
    const state = captureRecord({ items: [] });
    const items = state.items;
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '7');
    let reads = 0;
    let next = state;
    try {
      Object.defineProperty(Array.prototype, '7', {
        configurable: true,
        get() { if (this === items) { reads++; return { inherited: 'unexpected' }; } return undefined; },
        set(value) { Object.defineProperty(this, '7', { value, writable: true, enumerable: true, configurable: true }); },
      });
      next = write(state, '/items/7/value', 1);
    } finally {
      if (prior) Object.defineProperty(Array.prototype, '7', prior);
      else Reflect.deleteProperty(Array.prototype, '7');
    }
    expect(reads).toBe(0);
    expect(read(next, '/items/7')).toEqual({ value: 1 });
    expect(read(state, '/items')).toEqual([]);
  });
  it('supports empty and slash root aliases', () => {
    const state = captureRecord({ value: 1 });
    expect(read(state, '')).toBe(state);
    expect(read(state, '/')).toBe(state);
    const replacement = captureRecord({ next: 2 });
    expect(applyPointer(state, parsePointer('/'), replacement)).toBe(replacement);
    expect(applyPointer(state, parsePointer(''), replacement)).toBe(replacement);
  });
  it('requires leading slash and decodes escaped members once', () => {
    const state = captureRecord({ 'a/b': { '~key': 1 }, '~1': 2, '': { child: 3 } });
    expect(read(state, '/a~1b/~0key')).toBe(1);
    expect(read(state, '/~01')).toBe(2);
    expect(read(state, '//child')).toBe(3);
    expect(read(write(state, '/a~1b/~0key', 4), '/a~1b/~0key')).toBe(4);
  });
  it.each(['plain', 'x/y', '/~', '/~2', '/a~x', '/a/~10~'])('rejects malformed path %s', path => {
    expect(() => parsePointer(path)).toThrow(TypeError);
  });
  it('reads only own data and permits prototype names and numeric record keys', () => {
    const input = Object.create(null);
    input.__proto__ = { own: 1 };
    input['01'] = 2;
    const state = captureRecord(input);
    expect(read(state, '/constructor')).toBeUndefined();
    expect(read(state, '/toString')).toBeUndefined();
    expect(read(state, '/missing/deep')).toBeUndefined();
    expect(read(state, '/__proto__/own')).toBe(1);
    expect(read(state, '/01')).toBe(2);
    const next = write(write(state, '/constructor/prototype', 3), '/__proto__/safe', 4);
    expect(read(next, '/constructor/prototype')).toBe(3);
    expect(read(next, '/__proto__/safe')).toBe(4);
    expect(read(state, '/__proto__/safe')).toBeUndefined();
    expect(Object.getPrototypeOf(next)).toBeNull();
  });
  it('creates records through missing and scalar branches, including numeric branches', () => {
    const state = captureRecord({ scalar: 1, nullable: null });
    for (const path of ['/missing/0/name', '/scalar/0/name', '/nullable/0/name']) {
      const next = write(state, path, 'value');
      expect(read(next, path)).toBe('value');
      const branch = read(next, path.split('/').slice(0, -1).join('/'));
      expect(Array.isArray(branch)).toBe(false);
      expect(Object.getPrototypeOf(branch)).toBeNull();
    }
  });
  it('copies only changed branches and never mutates retained snapshots', () => {
    const state = captureRecord({ stable: { value: 1 }, changed: { child: { value: 2 } } });
    const next = write(state, '/changed/child/value', 3);
    expect(next).not.toBe(state);
    expect(next.stable).toBe(state.stable);
    expect(next.changed).not.toBe(state.changed);
    expect(read(state, '/changed/child/value')).toBe(2);
    expect(read(next, '/changed/child/value')).toBe(3);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.changed)).toBe(true);
    expect(Object.isFrozen(read(next, '/changed/child'))).toBe(true);
  });
  it('preserves existing arrays and fills all growth gaps with own undefined', () => {
    const state = captureRecord({ list: [{ value: 1 }] });
    let next = write(state, '/list/3/value', 4);
    next = write(next, '/list/1', 2);
    expect(read(next, '/list')).toEqual([{ value: 1 }, 2, undefined, { value: 4 }]);
    expect(Object.keys(read(next, '/list') as object)).toEqual(['0', '1', '2', '3']);
    expect(read(next, '/list/0')).toBe(read(state, '/list/0'));
    expect(read(state, '/list')).toEqual([{ value: 1 }]);
    expect(Object.isFrozen(read(next, '/list'))).toBe(true);
    expect(read(next, '/list/4294967294')).toBeUndefined();
  });
  it.each(['length', '-1', '01', '1.0', '+1', '1e1', '4294967295', 'constructor', '__proto__', ''])('rejects invalid array member %s for reads and writes', member => {
    const state = captureRecord({ list: [] });
    const path = '/list/' + member;
    expect(() => read(state, path)).toThrow(TypeError);
    expect(() => write(state, path, 1)).toThrow(TypeError);
  });
  it('validates arrays against the current ordered working state', () => {
    const state = captureRecord({ branch: {} });
    expect(read(write(state, '/branch/length', 1), '/branch/length')).toBe(1);
    const next = write(state, '/branch', []);
    expect(() => write(next, '/branch/length', 1)).toThrow(TypeError);
    expect(read(state, '/branch')).toEqual({});
  });
  it.each([[], 1, null, undefined].map(value => ({ value })))('rejects nonrecord root replacements $value', ({ value }) => {
    expect(() => write(captureRecord({}), '/', value)).toThrow(TypeError);
  });
});
