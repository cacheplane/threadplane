import { describe, it, expect, vi } from 'vitest';
// Must use zod/v4 z — the root 'zod' package exports a v3 runtime that lacks
// _zod.def internals required by toJSONSchema. All schema construction goes
// through the v4 sub-path to keep parity with the declaration API's converter.
import { z } from 'zod/v4';
import { action, view, ask, tools } from './tools';

// Minimal Angular Component stand-in for tests (avoids requiring full TestBed).
class FakeComponent {}

describe('action()', () => {
  it('returns a FunctionToolDef with kind "function"', () => {
    const schema = z.object({ x: z.number() });
    const handler = vi.fn().mockReturnValue(42);
    const def = action('my desc', schema, handler);

    expect(def.kind).toBe('function');
    expect(def.description).toBe('my desc');
    expect(def.schema).toBe(schema);
    expect(def.handler).toBe(handler);
  });

  it('preserves inference — handler args are typed from the Zod schema', () => {
    // This line is the compile-time gate: if `args.city` is not typed as string
    // the assignment `const c: string = args.city` will be a TS error.
    const t = action('w', z.object({ city: z.string() }), (args) => {
      const c: string = args.city;
      return c;
    });
    expect(t.kind).toBe('function');
  });

  it('carries followUp:false from options', () => {
    const def = action('no follow-up', z.object({}), async () => undefined, { followUp: false });
    expect(def.followUp).toBe(false);
  });
});

describe('view()', () => {
  it('returns a ViewToolDef with kind "view"', () => {
    const schema = z.object({ label: z.string() });
    const def = view('render a map', schema, FakeComponent as unknown as import('@angular/core').Type<unknown>);

    expect(def.kind).toBe('view');
    expect(def.description).toBe('render a map');
    expect(def.schema).toBe(schema);
    expect((def as { component: unknown }).component).toBe(FakeComponent);
  });

  it('carries followUp:false from options', () => {
    const def = view(
      'terminal view',
      z.object({}),
      FakeComponent as unknown as import('@angular/core').Type<unknown>,
      { followUp: false },
    );
    expect(def.followUp).toBe(false);
  });
});

describe('ask()', () => {
  it('returns an AskToolDef with kind "ask"', () => {
    const schema = z.object({ choice: z.string() });
    const def = ask('ask user', schema, FakeComponent as unknown as import('@angular/core').Type<unknown>);

    expect(def.kind).toBe('ask');
    expect(def.description).toBe('ask user');
    expect(def.schema).toBe(schema);
    expect((def as { component: unknown }).component).toBe(FakeComponent);
  });

  it('carries followUp:false from options', () => {
    const def = ask(
      'terminal ask',
      z.object({}),
      FakeComponent as unknown as import('@angular/core').Type<unknown>,
      { followUp: false },
    );
    expect(def.followUp).toBe(false);
  });
});

describe('tools()', () => {
  it('collects named tools into a frozen registry', () => {
    const schema = z.object({ q: z.string() });
    const aHandler = vi.fn();
    const registry = tools({
      a: action('tool a', schema, aHandler),
      b: view('tool b', schema, FakeComponent as unknown as import('@angular/core').Type<unknown>),
    });

    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry['a'].kind).toBe('function');
    expect(registry['b'].kind).toBe('view');
    expect(Object.keys(registry)).toEqual(['a', 'b']);
  });

  it('preserves all provided keys', () => {
    const schema = z.object({ n: z.number() });
    const registry = tools({
      foo: action('foo', schema, () => null),
      bar: ask('bar', schema, FakeComponent as unknown as import('@angular/core').Type<unknown>),
      baz: view('baz', schema, FakeComponent as unknown as import('@angular/core').Type<unknown>),
    });

    expect(Object.keys(registry).sort()).toEqual(['bar', 'baz', 'foo']);
  });
});
