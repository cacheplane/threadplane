import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signalStateStore } from './signal-state-store';

describe('signalStateStore', () => {
  it('should implement StateStore interface with get/set', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ name: 'test', count: 0 });
      expect(store.get('/name')).toBe('test');
      expect(store.get('/count')).toBe(0);
      store.set('/count', 5);
      expect(store.get('/count')).toBe(5);
    });
  });

  it('should return full state snapshot via getSnapshot', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ a: 1, b: 2 });
      expect(store.getSnapshot()).toEqual({ a: 1, b: 2 });
    });
  });

  it('should batch updates via update()', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ x: 0, y: 0 });
      store.update({ '/x': 10, '/y': 20 });
      expect(store.get('/x')).toBe(10);
      expect(store.get('/y')).toBe(20);
    });
  });

  it('should notify subscribers on state change', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ val: 'a' });
      const listener = vi.fn();
      const unsub = store.subscribe(listener);
      store.set('/val', 'b');
      expect(listener).toHaveBeenCalled();
      unsub();
    });
  });

  it('should handle nested paths', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ user: { name: 'Alice', age: 30 } });
      expect(store.get('/user/name')).toBe('Alice');
      store.set('/user/name', 'Bob');
      expect(store.get('/user/name')).toBe('Bob');
      expect(store.getSnapshot()).toEqual({ user: { name: 'Bob', age: 30 } });
    });
  });

  it('should handle array paths', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ items: ['a', 'b', 'c'] });
      expect(store.get('/items/0')).toBe('a');
      store.set('/items/1', 'B');
      expect(store.get('/items/1')).toBe('B');
    });
  });

  it('should preserve array type when setting by index', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ items: ['a', 'b', 'c'] });
      store.set('/items/1', 'B');
      const snapshot = store.getSnapshot();
      expect(Array.isArray(snapshot['items'])).toBe(true);
      expect(snapshot['items']).toEqual(['a', 'B', 'c']);
    });
  });
});

describe('signalStateStore — path validation', () => {
  it('should throw when get() receives a path without a leading slash', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ count: 0 });
      expect(() => store.get('count')).toThrow(/count/);
      expect(() => store.get('count')).toThrow(/leading "\/"/);
    });
  });

  it('should throw rather than replace the whole state when set() omits the leading slash', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ count: 0 });
      expect(() => store.set('count', 1)).toThrow(/count/);
      // The silent-data-loss behavior this replaces would have left `1` here.
      expect(store.getSnapshot()).toEqual({ count: 0 });
    });
  });

  it('should throw when update() carries a path without a leading slash', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ x: 0 });
      expect(() => store.update({ x: 1 })).toThrow(/leading "\/"/);
      expect(store.getSnapshot()).toEqual({ x: 0 });
    });
  });

  it('should accept the root pointer forms', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ a: 1 });
      expect(store.get('')).toEqual({ a: 1 });
      expect(store.get('/')).toEqual({ a: 1 });
    });
  });
});

describe('signalStateStore — lastChange', () => {
  it('should report the path and value of the most recent set()', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ user: { name: 'Alice' } });
      expect(store.lastChange?.()).toBeUndefined();
      store.set('/user/name', 'Bob');
      expect(store.lastChange?.()).toEqual({ path: '/user/name', value: 'Bob' });
    });
  });

  it('should report the last applied path from update()', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ x: 0, y: 0 });
      store.update({ '/x': 1, '/y': 2 });
      expect(store.lastChange?.()).toEqual({ path: '/y', value: 2 });
    });
  });

  it('should be readable from inside a subscriber', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ count: 0 });
      const seen: unknown[] = [];
      store.subscribe(() => seen.push(store.lastChange?.()));
      store.set('/count', 3);
      expect(seen).toEqual([{ path: '/count', value: 3 }]);
    });
  });

  it('should not record a change that was skipped as a no-op', () => {
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ count: 1 });
      store.set('/count', 1);
      expect(store.lastChange?.()).toBeUndefined();
    });
  });
});
