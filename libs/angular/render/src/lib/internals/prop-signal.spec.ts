import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createStateStore } from '@json-render/core';
import { buildPropResolutionContext } from './prop-signal';

describe('buildPropResolutionContext', () => {
  it('should build context from store snapshot', () => {
    TestBed.runInInjectionContext(() => {
      const store = createStateStore({ name: 'test' });
      const ctx = buildPropResolutionContext(store);
      expect(ctx.stateModel).toEqual({ name: 'test' });
    });
  });

  it('should include repeat scope when provided', () => {
    TestBed.runInInjectionContext(() => {
      const store = createStateStore({ items: ['a', 'b'] });
      const repeatScope = { item: 'a', index: 0, basePath: '/items/0' };
      const ctx = buildPropResolutionContext(store, repeatScope);
      expect(ctx.repeatItem).toBe('a');
      expect(ctx.repeatIndex).toBe(0);
      expect(ctx.repeatBasePath).toBe('/items/0');
    });
  });

  it('should include functions when provided', () => {
    TestBed.runInInjectionContext(() => {
      const store = createStateStore({});
      const fns = { upper: (args: Record<string, unknown>) => String(args['text']).toUpperCase() };
      const ctx = buildPropResolutionContext(store, undefined, fns);
      expect(ctx.functions).toBe(fns);
    });
  });
});
