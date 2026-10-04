import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RenderSpec,
  type ReactRenderFunctions,
  type RenderViewProps,
} from '@threadplane/react/render';
import { projectPartialSpec, validateCompleteSpec } from './projection';

afterEach(cleanup);
const expression = (name = 'multiply', args: unknown = { a: 12, b: 5 }) => ({
  $computed: name,
  args,
});
const sample = (value: unknown = expression()) => ({
  root: 'root',
  elements: {
    root: {
      type: 'Heading',
      props: { content: 'Pure local values' },
      children: ['value'],
    },
    value: { type: 'Value', props: { label: 'Result', value } },
  },
});
const cases = [
  ['uppercase', { value: 'hello world' }, 'HELLO WORLD'],
  ['uppercase', { value: 'computed functions' }, 'COMPUTED FUNCTIONS'],
  ['reverse', { value: 'streaming' }, 'gnimaerts'],
  ['multiply', { a: 7, b: 6 }, 42],
  ['multiply', { a: 12, b: 5 }, 60],
  [
    'formatDate',
    { value: '2024-06-15T12:00:00Z' },
    new Date('2024-06-15T12:00:00Z').toLocaleDateString(),
  ],
  [
    'formatDate',
    { value: '2025-01-01T00:00:00Z' },
    new Date('2025-01-01T00:00:00Z').toLocaleDateString(),
  ],
] as const;
function Heading({ props, children }: RenderViewProps) {
  return (
    <>
      <h3>{String(props.content ?? '')}</h3>
      {children}
    </>
  );
}
function Value({ props }: RenderViewProps) {
  return (
    <output>
      {typeof props.value === 'string' || typeof props.value === 'number'
        ? String(props.value)
        : ''}
    </output>
  );
}
const registry = { Heading, Value };
function functions() {
  return {
    uppercase: vi.fn((args) => String(args.value).toUpperCase()),
    reverse: vi.fn((args) => String(args.value).split('').reverse().join('')),
    multiply: vi.fn((args) => Number(args.a) * Number(args.b)),
    formatDate: vi.fn((args) =>
      new Date(String(args.value)).toLocaleDateString()
    ),
  } satisfies ReactRenderFunctions;
}

describe('owned computed projection', () => {
  it.each(cases)(
    'preserves native %s expressions and actual resolved output',
    (name, args, expected) => {
      const source = sample(expression(name, args));
      const spec = validateCompleteSpec(source);
      expect(spec).toEqual(source);
      const view = render(
        <RenderSpec spec={spec} registry={registry} functions={functions()} />
      );
      expect(view.getByRole('status').textContent).toBe(String(expected));
    }
  );

  it.each(cases)(
    'withholds every unfinished %s expression during actual streaming',
    (name, args, expected) => {
      const parser = createPartialJsonParser();
      const source = JSON.stringify(sample(expression(name, args)), null, 2);
      const callbacks = functions();
      let admitted = false;
      for (const character of source) {
        parser.push(character);
        const data = parser.root ? materialize(parser.root) : null;
        const spec = projectPartialSpec(data, parser.root);
        const node = parser.getByPath('/elements/value/props/value');
        const callback = callbacks[name];
        callback.mockClear();
        if (!spec) continue;
        const view = render(
          <RenderSpec spec={spec} registry={registry} functions={callbacks} />
        );
        if (node?.status !== 'complete') {
          expect(Object.hasOwn(spec.elements.value?.props ?? {}, 'value')).toBe(
            false
          );
          expect(callback).not.toHaveBeenCalled();
          expect(view.queryByRole('status')?.textContent ?? '').toBe('');
        } else {
          admitted = true;
          expect(callback).toHaveBeenCalled();
          expect(view.getByRole('status').textContent).toBe(String(expected));
        }
        view.unmount();
      }
      parser.finish();
      expect(admitted).toBe(true);
      expect(
        projectPartialSpec(materialize(parser.root!), parser.root)
      ).toEqual(validateCompleteSpec(JSON.parse(source)));
    }
  );

  it('copies nested expression data and freezes the owned result without freezing the caller', () => {
    const args = { a: 12, b: 5 };
    const source = sample(expression('multiply', args));
    const spec = validateCompleteSpec(source);
    expect(Object.isFrozen(spec)).toBe(true);
    const value = spec.elements.value.props.value as { readonly args: unknown };
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.args)).toBe(true);
    args.a = 7;
    source.elements.root.children.length = 0;
    expect(value.args).toEqual({ a: 12, b: 5 });
    expect(spec.elements.root.children).toEqual(['value']);
    expect(Object.isFrozen(args)).toBe(false);
  });

  it.each([
    expression('unknown'),
    expression('constructor'),
    expression('__proto__'),
    expression('multiply', { a: 1, b: 5 }),
    expression('multiply', { a: 12 }),
    expression('multiply', { a: '12', b: 5 }),
    expression('multiply', { a: 12, b: 5, c: 1 }),
    expression('uppercase', { value: 'arbitrary editor' }),
    expression('formatDate', { value: '2024-06' }),
    expression('reverse', {
      value: { $computed: 'uppercase', args: { value: 'hello world' } },
    }),
    { ...expression(), other: true },
    { $state: '/result' },
    { $item: 'result' },
    42,
    null,
    [],
    () => 42,
  ])('rejects data outside the authored computed profile: %j', (value) => {
    expect(() => validateCompleteSpec(sample(value))).toThrow(TypeError);
  });

  it('does not trust matching value text without complete parser metadata', () => {
    const source = sample(
      expression('formatDate', { value: '2024-06-15T12:00:00Z' })
    );
    const spec = projectPartialSpec(source, null);
    expect(spec?.elements.value).toBeDefined();
    expect(Object.hasOwn(spec!.elements.value.props, 'value')).toBe(false);
  });

  it('rejects extra fields, executable fields and prototype keys', () => {
    for (const extra of [
      { on: {} },
      { watch: {} },
      { repeat: {} },
      { visible: true },
    ]) {
      const source = sample();
      Object.assign(source.elements.root, extra);
      expect(() => validateCompleteSpec(source)).toThrow();
    }
    expect(() =>
      validateCompleteSpec(
        JSON.parse(
          JSON.stringify(sample()).replace('"args":', '"__proto__":{},"args":')
        )
      )
    ).toThrow();
    expect(() =>
      validateCompleteSpec(
        sample(Object.assign(expression(), { [Symbol('private')]: 1 }))
      )
    ).toThrow();
  });

  it('rejects accessors without reading them', () => {
    let reads = 0;
    const value = expression();
    Object.defineProperty(value, 'args', {
      enumerable: true,
      get() {
        reads++;
        return { a: 12, b: 5 };
      },
    });
    expect(() => validateCompleteSpec(sample(value))).toThrow();
    expect(reads).toBe(0);
  });

  it('bounds nodes, text, references and graph depth', () => {
    const long = sample();
    long.elements.root.props.content = 'x'.repeat(16385);
    expect(() => validateCompleteSpec(long)).toThrow();
    const many = sample() as {
      root: string;
      elements: Record<string, unknown>;
    };
    for (let index = 0; index < 33; index++)
      many.elements['node' + index] = {
        type: 'Heading',
        props: { content: 'x' },
      };
    expect(() => validateCompleteSpec(many)).toThrow();
    const cyclic = sample();
    cyclic.elements.root.children = ['root'];
    expect(() => validateCompleteSpec(cyclic)).toThrow();
    const duplicate = sample();
    duplicate.elements.root.children = ['value', 'value'];
    expect(() => validateCompleteSpec(duplicate)).toThrow();
    const deep = { root: 'node0', elements: {} as Record<string, unknown> };
    for (let index = 0; index < 17; index++)
      deep.elements['node' + index] = {
        type: 'Heading',
        props: { content: 'x' },
        ...(index < 16 ? { children: ['node' + (index + 1)] } : {}),
      };
    expect(() => validateCompleteSpec(deep)).toThrow();
  });
});
