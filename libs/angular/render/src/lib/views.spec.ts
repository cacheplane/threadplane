import { describe, it, expect } from 'vitest';
import { Component } from '@angular/core';
import { views, withViews, withoutViews, toRenderRegistry, overrideViews } from './views';
import type { RenderViewEntry } from './render.types';
import type { StandardSchemaV1 } from './standard-schema';

@Component({ selector: 'render-test-a', standalone: true, template: 'A' })
class CompA {}

@Component({ selector: 'render-test-b', standalone: true, template: 'B' })
class CompB {}

@Component({ selector: 'render-test-c', standalone: true, template: 'C' })
class CompC {}

describe('views()', () => {
  it('creates a frozen registry from a map', () => {
    const reg = views({ 'a': CompA, 'b': CompB });
    expect(reg['a']).toBe(CompA);
    expect(reg['b']).toBe(CompB);
    expect(Object.isFrozen(reg)).toBe(true);
  });

  it('returns empty frozen object for empty input', () => {
    const reg = views({});
    expect(Object.keys(reg)).toHaveLength(0);
    expect(Object.isFrozen(reg)).toBe(true);
  });

  it('composes via spread (last key wins)', () => {
    const base = views({ 'a': CompA });
    const override = views({ ...base, 'a': CompB });
    expect(override['a']).toBe(CompB);
  });
});

describe('withViews()', () => {
  it('adds new entries without overwriting existing', () => {
    const base = views({ 'a': CompA });
    const extended = withViews(base, { 'b': CompB, 'a': CompC });
    expect(extended['a']).toBe(CompA);
    expect(extended['b']).toBe(CompB);
  });

  it('returns a frozen registry', () => {
    const result = withViews(views({}), { 'a': CompA });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('withoutViews()', () => {
  it('removes named entries', () => {
    const base = views({ 'a': CompA, 'b': CompB, 'c': CompC });
    const result = withoutViews(base, 'b', 'c');
    expect(result['a']).toBe(CompA);
    expect(result['b']).toBeUndefined();
    expect(result['c']).toBeUndefined();
  });

  it('returns a frozen registry', () => {
    const result = withoutViews(views({ 'a': CompA }), 'a');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('handles removing non-existent keys gracefully', () => {
    const base = views({ 'a': CompA });
    const result = withoutViews(base, 'nonexistent');
    expect(result['a']).toBe(CompA);
  });
});

describe('overrideViews()', () => {
  it('replaces matching keys; overrides win over base', () => {
    const base = views({ 'foo': CompA, 'bar': CompB });
    const result = overrideViews(base, { 'foo': CompC });
    expect(result['foo']).toBe(CompC);
    expect(result['bar']).toBe(CompB);
  });

  it('adds new keys not present in base', () => {
    const base = views({ 'foo': CompA });
    const result = overrideViews(base, { 'bar': CompB });
    expect(result['foo']).toBe(CompA);
    expect(result['bar']).toBe(CompB);
  });

  it('does not mutate base', () => {
    const base = views({ 'foo': CompA });
    overrideViews(base, { 'foo': CompB });
    expect(base['foo']).toBe(CompA);
  });

  it('returns a frozen object', () => {
    const result = overrideViews(views({}), {});
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('toRenderRegistry()', () => {
  it('converts ViewRegistry to AngularRegistry', () => {
    const reg = views({ 'a': CompA, 'b': CompB });
    const renderReg = toRenderRegistry(reg);
    expect(renderReg.getEntry('a')?.component).toBe(CompA);
    expect(renderReg.getEntry('b')?.component).toBe(CompB);
    expect(renderReg.names()).toContain('a');
    expect(renderReg.names()).toContain('b');
  });
});

describe('RenderViewEntry schema + description', () => {
  it('preserves schema and description on object-form entries', () => {
    const schema = { '~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) } } as never;
    const reg = views({
      weather_card: { component: CompA, schema, description: 'Show a weather card' },
    });
    const entry = reg['weather_card'] as { component: unknown; schema?: unknown; description?: string };
    expect(entry.component).toBe(CompA);
    expect(entry.schema).toBe(schema);
    expect(entry.description).toBe('Show a weather card');
  });

  it('accepts schema + description without a cast (compile-time type gate)', () => {
    const schema: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
    };
    // This assignment is uncast — if `schema`/`description` were removed from
    // RenderViewEntry, tsc would fail here, so the test gates on the interface
    // change itself rather than on the runtime spread preserving extra keys.
    const entry: RenderViewEntry = { component: CompA, schema, description: 'Test' };
    expect(entry.schema).toBe(schema);
    expect(entry.description).toBe('Test');
  });
});
