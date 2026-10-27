import { describe, expect, it } from 'vitest';
import { createRenderState } from './create-render-state.js';

describe('application-owned render state', () => {
  it('rejects an accessor update atomically when Object.prototype supplies descriptor value', () => {
    const owner = createRenderState({ count: 0 });
    const retained = owner.getSnapshot();
    let reads = 0;
    let calls = 0;
    owner.subscribe(() => calls++);
    const updates = Object.defineProperty({ '/count': 1 }, '/bad', { enumerable: true, get() { reads++; return 2; } });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    if (prior) Object.setPrototypeOf(prior, null);
    let failure: unknown;
    try {
      Object.defineProperty(Object.prototype, 'value', { configurable: true, writable: true, value: 3 });
      owner.update(updates);
    } catch (error) {
      failure = error;
    } finally {
      if (prior) Object.defineProperty(Object.prototype, 'value', prior);
      else Reflect.deleteProperty(Object.prototype, 'value');
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
    expect(calls).toBe(0);
    expect(owner.getSnapshot()).toBe(retained);
    expect(owner.lastChange()).toBeUndefined();
  });

  it('captures sparse writes without adopting inherited numeric descriptors', () => {
    const owner = createRenderState();
    const retained = owner.getSnapshot();
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, '7');
    try {
      Object.defineProperty(Object.prototype, '7', { configurable: true, writable: true, value: { value: 'inherited-hole' } });
      owner.set('/items', new Array(8));
    } finally {
      if (prior) Object.defineProperty(Object.prototype, '7', prior);
      else Reflect.deleteProperty(Object.prototype, '7');
    }
    expect(owner.get('/items/7')).toBeUndefined();
    expect(Object.hasOwn(owner.get('/items') as object, '7')).toBe(true);
    expect(owner.lastChange()?.value).toBe(owner.get('/items'));
    expect(retained).toEqual({});
  });

  it('does not invoke inherited numeric descriptor getters during sparse writes', () => {
    const owner = createRenderState();
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, '7');
    let reads = 0;
    let failure: unknown;
    try {
      Object.defineProperty(Object.prototype, '7', {
        configurable: true,
        get() { reads++; throw new Error('Inherited descriptor getter must stay unread'); },
        set(value) { Object.defineProperty(this, '7', { value, writable: true, enumerable: true, configurable: true }); },
      });
      owner.set('/items', new Array(8));
    } catch (error) {
      failure = error;
    } finally {
      if (prior) Object.defineProperty(Object.prototype, '7', prior);
      else Reflect.deleteProperty(Object.prototype, '7');
    }
    expect(failure).toBeUndefined();
    expect(reads).toBe(0);
    expect(owner.get('/items/7')).toBeUndefined();
    expect(Object.hasOwn(owner.get('/items') as object, '7')).toBe(true);
  });

  it('publishes only own data after a write through an absent array index', () => {
    const owner = createRenderState({ items: [] });
    const retained = owner.getSnapshot();
    let calls = 0;
    owner.subscribe(() => calls++);
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '7');
    try {
      Object.defineProperty(Array.prototype, '7', { configurable: true, writable: true, value: { inherited: 'unexpected' } });
      owner.set('/items/7/value', 1);
    } finally {
      if (prior) Object.defineProperty(Array.prototype, '7', prior);
      else Reflect.deleteProperty(Array.prototype, '7');
    }
    expect(owner.get('/items/7')).toEqual({ value: 1 });
    expect(owner.get('/items/7/inherited')).toBeUndefined();
    expect(owner.lastChange()).toEqual({ path: '/items/7/value', value: 1 });
    expect(retained.items).toEqual([]);
    expect(calls).toBe(1);
  });

  it('does not evaluate inherited array getters while applying an ordered batch', () => {
    const owner = createRenderState({ items: [] });
    const retained = owner.getSnapshot();
    const items = retained.items;
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '7');
    let reads = 0;
    let calls = 0;
    owner.subscribe(() => calls++);
    try {
      Object.defineProperty(Array.prototype, '7', {
        configurable: true,
        get() { if (this === items) { reads++; return { inherited: 'unexpected' }; } return undefined; },
        set(value) { Object.defineProperty(this, '7', { value, writable: true, enumerable: true, configurable: true }); },
      });
      owner.update({ '/first': true, '/items/7/value': 1 });
    } finally {
      if (prior) Object.defineProperty(Array.prototype, '7', prior);
      else Reflect.deleteProperty(Array.prototype, '7');
    }
    expect(reads).toBe(0);
    expect(owner.get('/items/7')).toEqual({ value: 1 });
    expect(owner.get('/first')).toBe(true);
    expect(owner.lastChange()).toEqual({ path: '/items/7/value', value: 1 });
    expect(retained.items).toEqual([]);
    expect(calls).toBe(1);
  });

  it('owns initial data and later writes independently of caller aliases', () => {
    const input = { branch: { count: 1 } };
    const owner = createRenderState(input);
    const first = owner.getSnapshot();
    input.branch.count = 2;
    expect(owner.get('/branch/count')).toBe(1);
    owner.set('/branch', input.branch);
    input.branch.count = 3;
    expect(owner.get('/branch/count')).toBe(2);
    owner.set('/branch', input.branch);
    expect(owner.get('/branch/count')).toBe(3);
    expect(first.branch).toEqual({ count: 1 });
    expect(Object.isFrozen(owner.get('/branch'))).toBe(true);
  });

  it('uses original strict identity for noops and keeps snapshot and metadata stable', () => {
    const owner = createRenderState({ branch: { count: 1 }, flag: true });
    let calls = 0;
    owner.subscribe(() => calls++);
    const first = owner.getSnapshot();
    owner.update({ '/branch': first.branch, '/flag': true, '/absent': undefined });
    expect(owner.getSnapshot()).toBe(first);
    expect(owner.lastChange()).toBeUndefined();
    expect(calls).toBe(0);
    owner.set('/branch', { count: 1 });
    expect(owner.getSnapshot()).not.toBe(first);
    expect(calls).toBe(1);
    const change = owner.lastChange();
    const snapshot = owner.getSnapshot();
    owner.set('/branch', snapshot.branch);
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(owner.lastChange()).toBe(change);
    expect(Object.isFrozen(change)).toBe(true);
    expect(change?.value).toBe(snapshot.branch);
  });

  it('applies ordered overlapping and root alias writes in one publication', () => {
    const owner = createRenderState({ count: 0 });
    const seen: unknown[] = [];
    owner.subscribe(() => seen.push([owner.getSnapshot(), owner.lastChange()]));
    owner.update({ '/branch': { count: 1 }, '/branch/count': 2, '': { count: 3 }, '/count': 4 });
    expect(owner.getSnapshot()).toEqual({ count: 4 });
    expect(seen).toHaveLength(1);
    expect(owner.lastChange()).toEqual({ path: '/count', value: 4 });
    owner.set('/', { count: 5 });
    expect(owner.get('')).toBe(owner.getSnapshot());
    expect(owner.get('/')).toBe(owner.getSnapshot());
    expect(owner.lastChange()?.path).toBe('/');
  });

  it('accepts an applied batch that returns to equivalent data and ignores empty batches', () => {
    const owner = createRenderState({ count: 1 });
    let calls = 0;
    owner.subscribe(() => calls++);
    const first = owner.getSnapshot();
    owner.update({ '/count': 2, '/': { count: 1 } });
    expect(owner.getSnapshot()).toEqual(first);
    expect(owner.getSnapshot()).not.toBe(first);
    expect(calls).toBe(1);
    const change = owner.lastChange();
    owner.update({});
    expect(owner.lastChange()).toBe(change);
    expect(calls).toBe(1);
  });

  it.each([
    { '/count': 2, '/bad~2': 3 },
    { '/count': 2, '/bad': Number.NaN },
    { '/count': 2, '/items/length': 4 },
    { '/count': 2, '/items': [], '/items/01': 4 },
    { '/count': 2, '/': [] },
  ])('rolls back all writes and metadata after a later invalid entry: %j', updates => {
    const owner = createRenderState({ count: 0, items: [1] });
    owner.set('/seed', true);
    const snapshot = owner.getSnapshot();
    const change = owner.lastChange();
    let calls = 0;
    owner.subscribe(() => calls++);
    expect(() => owner.update(updates)).toThrow();
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(owner.lastChange()).toBe(change);
    expect(owner.get('/count')).toBe(0);
    expect(calls).toBe(0);
  });

  it('validates array traversal against ordered working state', () => {
    const owner = createRenderState({ items: [1] });
    owner.update({ '/items': {}, '/items/length': 4 });
    expect(owner.get('/items')).toEqual({ length: 4 });
    owner.update({ '/items': [], '/items/2': 9 });
    expect(owner.get('/items')).toEqual([undefined, undefined, 9]);
  });

  it('rejects descriptors and symbols without invoking getters or publishing', () => {
    const owner = createRenderState();
    const first = owner.getSnapshot();
    let reads = 0;
    const updates = Object.defineProperty({ '/ok': 1 }, '/bad', { get() { reads++; return 2; } });
    expect(() => owner.update(updates)).toThrow();
    expect(() => owner.update({ '/ok': 1, [Symbol('hidden')]: 2 })).toThrow();
    expect(reads).toBe(0);
    expect(owner.getSnapshot()).toBe(first);
  });

  it.each([null, [], 1, new Date()].map(value => [value]))('rejects invalid update root %j', value => {
    const owner = createRenderState();
    // @ts-expect-error Exercise the runtime unknown boundary.
    expect(() => owner.update(value)).toThrow();
  });

  it('validates invalid incoming values before a possible noop', () => {
    const owner = createRenderState();
    expect(() => owner.set('/absent', () => undefined)).toThrow();
    expect(() => owner.set('', undefined)).toThrow();
    expect(() => owner.set('/bad~', undefined)).toThrow();
    expect(owner.lastChange()).toBeUndefined();
  });

  it('captures preflight values before processing ordered writes', () => {
    const owner = createRenderState({ value: { count: 1 } });
    const original = owner.get('/value');
    owner.update({ '/value/count': 2, '/copy': original });
    expect(owner.get('/value/count')).toBe(2);
    expect(owner.get('/copy')).toEqual({ count: 1 });
  });

  it('treats duplicate callbacks as independent idempotent registrations', () => {
    const owner = createRenderState();
    let calls = 0;
    const callback = () => calls++;
    const release = owner.subscribe(callback);
    owner.subscribe(callback);
    expect(calls).toBe(0);
    owner.set('/count', 1);
    expect(calls).toBe(2);
    release(); release();
    owner.set('/count', 2);
    expect(calls).toBe(3);
  });

  it('respects removal during publication and contains observer exceptions', () => {
    const owner = createRenderState();
    const seen: number[] = [];
    let release = () => undefined as void;
    owner.subscribe(() => { release(); throw new Error('observer'); });
    release = owner.subscribe(() => seen.push(1));
    owner.subscribe(() => seen.push(2));
    expect(() => owner.set('/count', 1)).not.toThrow();
    expect(seen).toEqual([2]);
    expect(owner.get('/count')).toBe(1);
    expect(owner.lastChange()).toEqual({ path: '/count', value: 1 });
  });

  it('queues reentry without recursive delivery and exposes latest committed reads', () => {
    const owner = createRenderState();
    const seen: unknown[] = [];
    let depth = 0;
    owner.subscribe(() => {
      depth++;
      expect(depth).toBe(1);
      seen.push(['first', owner.get('/count'), owner.lastChange()?.value]);
      if (owner.get('/count') === 1) owner.set('/count', 2);
      depth--;
    });
    owner.subscribe(() => seen.push(['second', owner.get('/count')]));
    owner.set('/count', 1);
    expect(seen).toEqual([['first', 1, 1], ['second', 2], ['first', 2, 2], ['second', 2]]);
  });

  it('disposes terminally, retaining reads and making subscriptions inert', () => {
    const owner = createRenderState({ count: 0 });
    owner.set('/count', 1);
    const snapshot = owner.getSnapshot();
    const change = owner.lastChange();
    let calls = 0;
    const release = owner.subscribe(() => calls++);
    owner.dispose(); owner.dispose(); release();
    owner.subscribe(() => calls++);
    expect(() => owner.set('/count', 2)).toThrow(/disposed/);
    expect(() => owner.update({})).toThrow(/disposed/);
    expect(() => owner.set('invalid', Number.NaN)).toThrow(/disposed/);
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(owner.get('/count')).toBe(1);
    expect(owner.lastChange()).toBe(change);
    expect(calls).toBe(0);
  });

  it('clears queued reentry and stops remaining listeners on disposal during publication', () => {
    const owner = createRenderState();
    const seen: number[] = [];
    owner.subscribe(() => {
      seen.push(1);
      owner.set('/count', 2);
      owner.dispose();
    });
    owner.subscribe(() => seen.push(2));
    owner.set('/count', 1);
    expect(seen).toEqual([1]);
    expect(owner.get('/count')).toBe(2);
    expect(owner.lastChange()?.value).toBe(2);
  });
});
