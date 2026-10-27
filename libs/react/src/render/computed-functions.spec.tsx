import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RenderSpec,
  type ReactRenderFunctions,
  type ReactRenderRegistry,
  type RenderSpecData,
  type RenderValue,
} from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
type Functions = ReactRenderFunctions;
const registry: ReactRenderRegistry = {
  Box: ({ children }) => <section>{children}</section>,
  Text: ({ props }) => <p>{String(props['text'] ?? '')}</p>,
};
const computedSpec = (name: string): RenderSpecData => ({
  root: 'text',
  elements: { text: { type: 'Text', props: { text: { $computed: name } } } },
});

describe('RenderSpec computed functions', () => {
  it('resolves host functions with state and repeat-scoped arguments', () => {
    const spec: RenderSpecData = {
      root: 'root',
      elements: {
        root: { type: 'Box', props: {}, children: ['name', 'rows'] },
        name: {
          type: 'Text',
          props: {
            text: {
              $computed: 'uppercase',
              args: { value: { $state: '/name' } },
            },
          },
        },
        rows: {
          type: 'Box',
          props: {},
          children: ['row'],
          repeat: { statePath: '/rows', key: 'id' },
        },
        row: {
          type: 'Text',
          props: {
            text: {
              $computed: 'rowLabel',
              args: { value: { $item: 'name' }, index: { $index: true } },
            },
          },
        },
      },
    };
    const functions: Functions = {
      uppercase: ({ value }) => String(value).toUpperCase(),
      rowLabel: ({ value, index }) => `${String(value)}/${String(index)}`,
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{
          name: 'Ada',
          rows: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
        }}
        {...{ functions }}
      />
    );
    expect(view.getByText('ADA')).toBeTruthy();
    expect(view.getByText('A/0')).toBeTruthy();
    expect(view.getByText('B/1')).toBeTruthy();
  });

  it('gives callbacks owned recursively frozen arguments without freezing caller data', () => {
    const input = { list: [{ name: 'Ada' }] };
    let received: Readonly<Record<string, RenderValue>> | undefined;
    const functions: Functions = {
      inspect: (args) => {
        received = args;
        return 'owned';
      },
    };
    const spec: RenderSpecData = {
      root: 'text',
      elements: {
        text: {
          type: 'Text',
          props: {
            text: {
              $computed: 'inspect',
              args: {
                input: { $state: '/input' },
                absent: { $state: '/absent' },
              },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ input }}
        {...{ functions }}
      />
    );
    expect(view.getByText('owned')).toBeTruthy();
    expect(received).toEqual({ input, absent: undefined });
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(received?.['input'])).toBe(true);
    const nested = received?.['input'] as Readonly<Record<string, RenderValue>>;
    expect(Object.isFrozen(nested['list'])).toBe(true);
    expect(nested['list']).not.toBe(input.list);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.list)).toBe(false);
  });

  it('owns a nested computed result before another callback receives it', () => {
    const result = { list: [{ value: 42 }] };
    let received: RenderValue;
    const functions: Functions = {
      inner: () => result,
      outer: ({ value }) => {
        received = value;
        return Object.isFrozen(value) &&
          Object.isFrozen((value as Record<string, RenderValue>)['list'])
          ? 'frozen'
          : 'mutable';
      },
    };
    const spec: RenderSpecData = {
      root: 'text',
      elements: {
        text: {
          type: 'Text',
          props: {
            text: {
              $computed: 'outer',
              args: { value: { $computed: 'inner' } },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={registry} {...{ functions }} />
    );
    expect(view.getByText('frozen')).toBeTruthy();
    expect(received).toEqual(result);
    expect(received).not.toBe(result);
    expect(Object.isFrozen(result)).toBe(false);
    expect(Object.isFrozen(result.list)).toBe(false);
  });

  it('uses replacement registrations on rerender', () => {
    const spec = computedSpec('label');
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        {...{ functions: { label: () => 'before' } }}
      />
    );
    expect(view.getByText('before')).toBeTruthy();
    view.rerender(
      <RenderSpec
        spec={spec}
        registry={registry}
        {...{ functions: { label: () => 'after' } }}
      />
    );
    expect(view.getByText('after')).toBeTruthy();
    expect(view.queryByText('before')).toBeNull();
  });

  it('admits explicitly owned non-enumerable callable registrations', () => {
    const functions = Object.defineProperty({}, 'label', {
      value: () => 'explicit',
    });
    const view = render(
      <RenderSpec
        spec={computedSpec('label')}
        registry={registry}
        {...{ functions }}
      />
    );
    expect(view.getByText('explicit')).toBeTruthy();
    expect(Object.isFrozen(functions)).toBe(false);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'resolves an explicitly owned %s registration',
    (name) => {
      const functions = Object.fromEntries([[name, () => 'own registration']]);
      const view = render(
        <RenderSpec
          spec={computedSpec(name)}
          registry={registry}
          {...{ functions }}
        />
      );
      expect(view.getByText('own registration')).toBeTruthy();
    }
  );

  it.each(['constructor', 'toString', '__proto__'])(
    'treats absent %s as an unknown function',
    (name) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const view = render(
        <RenderSpec
          spec={computedSpec(name)}
          registry={registry}
          {...{ functions: {} }}
        />
      );
      expect(view.container.querySelector('p')?.textContent).toBe('');
    }
  );

  it('rejects accessors without invoking the getter', () => {
    let reads = 0;
    const functions = Object.defineProperty({}, 'label', {
      get: () => {
        reads++;
        return () => 'getter';
      },
    });
    expect(() =>
      render(
        <RenderSpec
          spec={computedSpec('label')}
          registry={registry}
          {...{ functions }}
        />
      )
    ).toThrow(/data properties/);
    expect(reads).toBe(0);
  });

  const invalidFunctionMaps: ReadonlyArray<
    readonly [string, () => unknown, RegExp]
  > = [
    ['symbol', () => ({ [Symbol('label')]: () => 'symbol' }), /symbol/],
    ['non-callable', () => ({ label: 1 }), /functions/],
    [
      'custom prototype',
      () => Object.create({ label: () => 'inherited' }),
      /plain/,
    ],
    ['array', () => [() => 'array'], /plain/],
    ['null', () => null, /plain/],
  ];
  it.each(invalidFunctionMaps)(
    'rejects a %s function map',
    (_label, make, error) => {
      expect(() =>
        render(
          <RenderSpec
            spec={computedSpec('label')}
            registry={registry}
            {...{ functions: make() as unknown as Functions }}
          />
        )
      ).toThrow(error);
    }
  );

  it.each([
    ['promise', () => Promise.resolve('later')],
    ['callback', () => () => 'callback'],
    ['nonfinite', () => Number.POSITIVE_INFINITY],
    ['date', () => new Date(0)],
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {};
        value['self'] = value;
        return value;
      },
    ],
    ['symbol', () => ({ [Symbol('value')]: 'symbol' })],
  ] as const)('rejects a %s computed result', (_label, label) => {
    expect(() =>
      render(
        <RenderSpec
          spec={computedSpec('label')}
          registry={registry}
          {...{ functions: { label } as unknown as Functions }}
        />
      )
    ).toThrow(TypeError);
  });

  it('rejects unsafe raw argument keys before a callback executes', () => {
    let calls = 0;
    const functions = {
      label: () => {
        calls++;
        return 'unsafe';
      },
    };
    const spec: RenderSpecData = {
      root: 'text',
      elements: {
        text: {
          type: 'Text',
          props: {
            text: {
              $computed: 'label',
              args: Object.fromEntries([['__proto__', { value: 1 }]]),
            },
          },
        },
      },
    };
    expect(() =>
      render(<RenderSpec spec={spec} registry={registry} {...{ functions }} />)
    ).toThrow(/__proto__/);
    expect(calls).toBe(0);
  });
});
