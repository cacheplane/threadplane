import {
  StrictMode,
  Suspense,
  forwardRef,
  memo,
  startTransition,
  useState,
} from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderReadinessEntry,
  type RenderSpecData,
  type RenderSpecProps,
  type RenderViewProps,
} from './index';

afterEach(cleanup);
const spec = {
  root: 'root',
  elements: {
    root: {
      type: 'Input',
      props: { value: { $bindState: '/value' } },
      children: ['child'],
    },
    child: { type: 'Child', props: {} },
  },
} as const;
const Input = ({ props, children }: RenderViewProps) => {
  const [value, setValue] = useState('initial');
  return (
    <section>
      <input
        aria-label="local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <span>{String(props['value'])}</span>
      {children}
    </section>
  );
};

it('waits without descendants, commits a real input, then retains its edited DOM through incomplete updates', () => {
  const isReady = vi.fn(
    (props: Readonly<Record<string, unknown>>) => props['value'] !== undefined
  );
  const Child = vi.fn(() => <p>child</p>);
  const registry = {
    Input: {
      kind: 'readiness',
      component: Input,
      isReady,
      fallback: () => <p>pending</p>,
    },
    Child,
  } satisfies ReactRenderRegistry;
  const view = render(
    <RenderSpec spec={spec} registry={registry} state={{}} />
  );
  expect(view.getByText('pending')).toBeTruthy();
  expect(Child).not.toHaveBeenCalled();
  view.rerender(
    <RenderSpec spec={spec} registry={registry} state={{ value: 'ready' }} />
  );
  const input = view.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'edited' } });
  expect(view.getByText('child')).toBeTruthy();
  isReady.mockClear();
  view.rerender(<RenderSpec spec={spec} registry={registry} state={{}} />);
  expect(view.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('edited');
  expect(view.getByText('undefined')).toBeTruthy();
  expect(isReady).not.toHaveBeenCalled();
});

const ready: RenderReadinessEntry['isReady'] = (props) =>
  props['value'] !== undefined;
const Pending = ({
  props,
  children,
  bindings,
  loading,
  elementKey,
}: RenderViewProps) => (
  <p>
    pending:{String(props['value'])}:{String(loading)}:{bindings?.['value']}:
    {elementKey}
    {children}
  </p>
);
function entry(
  overrides: Partial<RenderReadinessEntry> = {}
): RenderReadinessEntry {
  return {
    kind: 'readiness',
    component: Input,
    isReady: ready,
    fallback: Pending,
    ...overrides,
  };
}
function node(value?: string) {
  return { value };
}
function mount(
  initial: RenderReadinessEntry = entry(),
  state: NonNullable<RenderSpecProps['state']> = node('ready')
) {
  const view = render(
    <RenderSpec spec={spec} registry={{ Input: initial }} state={state} />
  );
  return {
    ...view,
    update(
      next: RenderReadinessEntry | ReactRenderRegistry[string],
      nextState = node()
    ) {
      view.rerender(
        <RenderSpec spec={spec} registry={{ Input: next }} state={nextState} />
      );
    },
  };
}
function edit(view: ReturnType<typeof render>) {
  const input = view.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'edited' } });
  return input;
}

describe('readiness contracts', () => {
  it.each(['function', 'memo', 'forwardRef'])(
    'keeps direct %s views immediate with undefined props',
    (kind) => {
      const Component =
        kind === 'memo'
          ? memo(Input)
          : kind === 'forwardRef'
          ? forwardRef<HTMLDivElement, RenderViewProps>((props, ref) => (
              <div ref={ref}>
                <Input {...props} />
              </div>
            ))
          : Input;
      const view = mount(entry());
      view.update(Component);
      expect(view.getByText('undefined')).toBeTruthy();
      expect(view.getByRole('textbox')).toBeTruthy();
    }
  );
  it.each(['memo', 'forwardRef'])(
    'supports %s descriptor real and fallback components',
    (kind) => {
      const wrap = (View: typeof Input | typeof Pending) =>
        kind === 'memo'
          ? memo(View)
          : forwardRef<HTMLDivElement, RenderViewProps>((props, ref) => (
              <div ref={ref}>
                <View {...props} />
              </div>
            ));
      const config = entry({ component: wrap(Input), fallback: wrap(Pending) });
      const view = mount(config, {});
      expect(view.getByText(/pending/)).toBeTruthy();
      view.update(config, node('ready'));
      expect(view.getByRole('textbox')).toBeTruthy();
    }
  );
  it('passes actual recursively frozen resolved props and current pending props without descendants', () => {
    const state = { payload: { nested: ['owned'] } };
    const predicate = vi.fn((props: Readonly<Record<string, unknown>>) => {
      expect(Object.isFrozen(props)).toBe(true);
      const payload = props['payload'] as { nested: string[] };
      expect(payload).not.toBe(state.payload);
      expect(Object.isFrozen(payload)).toBe(true);
      expect(Object.isFrozen(payload.nested)).toBe(true);
      expect(Object.keys(props)).toEqual(['value', 'payload']);
      return false;
    });
    const fallback = vi.fn(Pending);
    const frozenSpec = {
      ...spec,
      elements: {
        ...spec.elements,
        root: {
          ...spec.elements.root,
          props: {
            ...spec.elements.root.props,
            payload: { $state: '/payload' },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={frozenSpec}
        registry={{ Input: entry({ isReady: predicate, fallback }) }}
        state={state}
        loading
      />
    );
    expect(view.getByText('pending:undefined:true:/value:root')).toBeTruthy();
    expect(Object.hasOwn(fallback.mock.calls[0][0], 'children')).toBe(false);
    expect(Object.isFrozen(state.payload)).toBe(false);
  });
  it('keeps bindings and loading current after admission without checking again', () => {
    const capture = vi.fn(Input);
    const predicate = vi.fn(ready);
    const config = entry({ component: capture, isReady: predicate });
    const view = mount(config);
    const input = edit(view);
    predicate.mockClear();
    view.rerender(
      <RenderSpec spec={spec} registry={{ Input: config }} state={{}} loading />
    );
    expect(view.getByRole('textbox')).toBe(input);
    expect(capture.mock.lastCall?.[0]).toMatchObject({
      loading: true,
      bindings: { value: '/value' },
      props: { value: undefined },
    });
    expect(predicate).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 'yes', 1, Promise.resolve(true)])(
    'rejects nonboolean predicate result %s',
    (result) => {
      const invalid = (() =>
        result) as unknown as RenderReadinessEntry['isReady'];
      expect(() => mount(entry({ isReady: invalid }))).toThrow(
        /synchronous boolean/
      );
    }
  );
  it('rejects malformed predicates and propagates authored errors', () => {
    expect(() =>
      mount(
        entry({ isReady: null as unknown as RenderReadinessEntry['isReady'] })
      )
    ).toThrow(/isReady must be a function/);
    const error = new Error('authored predicate');
    expect(() =>
      mount(
        entry({
          isReady: () => {
            throw error;
          },
        })
      )
    ).toThrow(error);
  });
  it('uses null for absent pending fallback and reserves top fallback for unknown types', () => {
    const top = vi.fn(() => <p>unknown</p>);
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ Input: entry({ fallback: undefined }) }}
        state={{}}
        fallback={top}
      />
    );
    expect(view.container.textContent).toBe('');
    expect(top).not.toHaveBeenCalled();
    view.rerender(<RenderSpec spec={spec} registry={{}} fallback={top} />);
    expect(view.getByText('unknown')).toBeTruthy();
  });
  it('ignores inherited readiness discriminants on direct component objects', () => {
    const Component = memo(Input);
    Object.setPrototypeOf(Component, { kind: 'readiness' });
    const view = render(
      <RenderSpec spec={spec} registry={{ Input: Component }} />
    );
    expect(view.getByRole('textbox')).toBeTruthy();
  });
  it('retains real state for equivalent config and fallback-only replacement', () => {
    const view = mount();
    const input = edit(view);
    view.update(entry());
    expect(view.getByRole('textbox')).toBe(input);
    view.update(entry({ fallback: () => <p>other pending</p> }));
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('edited');
  });
  it.each(['predicate', 'component', 'type', 'root'])(
    'resets admission and actual real state on %s change',
    (change) => {
      const view = mount();
      const old = edit(view);
      const next =
        change === 'predicate'
          ? entry({ isReady: (props) => ready(props) })
          : change === 'component'
          ? entry({ component: (props) => <Input {...props} /> })
          : entry();
      const nextSpec: RenderSpecData =
        change === 'type'
          ? {
              ...spec,
              elements: {
                ...spec.elements,
                root: { ...spec.elements.root, type: 'Other' },
              },
            }
          : change === 'root'
          ? { root: 'other', elements: { other: spec.elements.root } }
          : spec;
      const registry = { Input: next, Other: next };
      view.rerender(
        <RenderSpec spec={nextSpec} registry={registry} state={{}} />
      );
      expect(view.queryByRole('textbox')).toBeNull();
      view.rerender(
        <RenderSpec spec={nextSpec} registry={registry} state={node('ready')} />
      );
      const input = view.getByRole('textbox') as HTMLInputElement;
      expect(input).not.toBe(old);
      expect(input.value).toBe('initial');
    }
  );
  it.each(['predicate', 'type', 'root'])(
    'remounts a ready real view immediately on %s replacement',
    (change) => {
      const config = entry();
      const view = mount(config);
      const old = edit(view);
      const next =
        change === 'predicate'
          ? entry({ isReady: (props) => ready(props) })
          : config;
      const nextSpec: RenderSpecData =
        change === 'type'
          ? {
              ...spec,
              elements: {
                ...spec.elements,
                root: { ...spec.elements.root, type: 'Other' },
              },
            }
          : change === 'root'
          ? { root: 'other', elements: { other: spec.elements.root } }
          : spec;
      view.rerender(
        <RenderSpec
          spec={nextSpec}
          registry={{ Input: next, Other: next }}
          state={node('ready')}
        />
      );
      expect(view.getByRole('textbox')).not.toBe(old);
      expect((view.getByRole('textbox') as HTMLInputElement).value).toBe(
        'initial'
      );
    }
  );
  it.each(['hidden', 'missing', 'removed', 'null'])(
    'resets lifetime after %s admission removal',
    (change) => {
      const view = mount();
      const old = edit(view);
      const config = entry();
      const intermediate: RenderSpecData | null =
        change === 'null'
          ? null
          : change === 'hidden'
          ? {
              ...spec,
              elements: {
                ...spec.elements,
                root: { ...spec.elements.root, visible: false },
              },
            }
          : change === 'removed'
          ? {
              root: 'parent',
              elements: { parent: { type: 'Box', props: {}, children: [] } },
            }
          : { root: 'root', elements: {} };
      view.rerender(
        <RenderSpec
          spec={intermediate}
          registry={{
            Input: config,
            Box: ({ children }) => <div>{children}</div>,
          }}
        />
      );
      view.update(config);
      expect(view.queryByRole('textbox')).toBeNull();
      view.update(config, node('ready'));
      expect(view.getByRole('textbox')).not.toBe(old);
    }
  );
  it('retires A after B pending commits and does not resurrect it on A pending', () => {
    const a = entry();
    const b = entry({ isReady: (props) => ready(props) });
    const view = mount(a);
    edit(view);
    view.update(b);
    view.update(a);
    expect(view.queryByRole('textbox')).toBeNull();
    view.update(a, node('ready'));
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe(
      'initial'
    );
  });
  it('resets descriptor lifetime across direct component dispatch', () => {
    const config = entry();
    const view = mount(config);
    const old = edit(view);
    view.update(Input);
    expect(view.getByRole('textbox')).not.toBe(old);
    view.update(config);
    expect(view.queryByRole('textbox')).toBeNull();
  });
  it('isolates fallback state when fallback and real component are identical', () => {
    const config = entry({ fallback: Input });
    const view = mount(config, {});
    const pending = edit(view);
    view.update(config, node('ready'));
    expect(view.getByRole('textbox')).not.toBe(pending);
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe(
      'initial'
    );
  });
  it('validates duplicate children and repeated identities even while pending', () => {
    for (const root of [
      { ...spec.elements.root, children: ['child', 'child'] },
      { ...spec.elements.root, repeat: { statePath: '/rows', key: 'id' } },
    ]) {
      expect(() =>
        render(
          <RenderSpec
            spec={{ ...spec, elements: { ...spec.elements, root } }}
            registry={{ Input: entry() }}
            state={{ rows: [{ id: 'a' }, { id: 'a' }] }}
          />
        )
      ).toThrow(/Duplicate/);
    }
  });
  it('preserves per-item latches and edited local state across stable-key reorder', () => {
    const repeated: RenderSpecData = {
      root: 'rows',
      elements: {
        rows: {
          type: 'Box',
          props: {},
          children: ['item'],
          repeat: { statePath: '/rows', key: 'id' },
        },
        item: { type: 'Input', props: { value: { $bindItem: 'value' } } },
      },
    };
    const config = entry();
    const registry = {
      Input: config,
      Box: ({ children }: RenderViewProps) => <div>{children}</div>,
    };
    const view = render(
      <RenderSpec
        spec={repeated}
        registry={registry}
        state={{ rows: [{ id: 'a', value: 'A' }, { id: 'b' }] }}
      />
    );
    const input = edit(view);
    expect(view.getAllByRole('textbox')).toHaveLength(1);
    view.rerender(
      <RenderSpec
        spec={repeated}
        registry={registry}
        state={{ rows: [{ id: 'b' }, { id: 'a' }] }}
      />
    );
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('edited');
    view.rerender(
      <RenderSpec
        spec={repeated}
        registry={registry}
        state={{ rows: [{ id: 'b', value: 'B' }, { id: 'a' }] }}
      />
    );
    expect(view.getAllByRole('textbox')[1]).toBe(input);
    expect((view.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe(
      'initial'
    );
  });
  it('retains committed admission in StrictMode without invoking owner commands', () => {
    const command = vi.fn();
    const ownedSpec = {
      ...spec,
      state: { value: 'implicit' },
      elements: {
        ...spec.elements,
        root: {
          ...spec.elements.root,
          on: { press: { action: command } },
          watch: { '/value': { action: command } },
        },
      },
    };
    const predicate = vi.fn(ready);
    const config = entry({ isReady: predicate });
    const view = render(
      <StrictMode>
        <RenderSpec
          spec={ownedSpec}
          registry={{ Input: config }}
          state={node('ready')}
        />
      </StrictMode>
    );
    const input = edit(view);
    predicate.mockClear();
    view.rerender(
      <StrictMode>
        <RenderSpec spec={ownedSpec} registry={{ Input: config }} state={{}} />
      </StrictMode>
    );
    expect(view.getByRole('textbox')).toBe(input);
    expect(predicate).not.toHaveBeenCalled();
    view.unmount();
    expect(command).not.toHaveBeenCalled();
  });
  it('does not latch a ready candidate whose real subtree suspends before initial commit', async () => {
    const never = new Promise<void>(() => undefined);
    const Suspended = (props: RenderViewProps) => {
      if (props.props['value'] === 'ready') throw never;
      return <Input {...props} />;
    };
    const config = entry({ component: Suspended });
    const content = (state: NonNullable<RenderSpecProps['state']>) => (
      <Suspense fallback={<p>ancestor pending</p>}>
        <RenderSpec spec={spec} registry={{ Input: config }} state={state} />
      </Suspense>
    );
    const view = render(content(node('ready')));
    expect(view.getByText('ancestor pending')).toBeTruthy();
    await act(async () => view.rerender(content({})));
    expect(view.getByText(/pending:undefined/)).toBeTruthy();
    expect(view.queryByRole('textbox')).toBeNull();
  });
  it('does not leak local state through an abandoned same-component predicate replacement', async () => {
    const never = new Promise<void>(() => undefined);
    const attempts: string[] = [];
    const View = (props: RenderViewProps) => {
      attempts.push(String(props.props['value']));
      const [local, setLocal] = useState(() => String(props.props['value']));
      if (props.props['value'] === 'suspend') throw never;
      return (
        <input
          aria-label="local"
          value={local}
          onChange={(event) => setLocal(event.target.value)}
        />
      );
    };
    const a = entry({ component: View, isReady: () => true });
    const b = entry({ component: View, isReady: () => true });
    const c = entry({ component: View, isReady: () => true });
    const content = (config: RenderReadinessEntry, value: string) => (
      <Suspense fallback={<p>ancestor</p>}>
        <RenderSpec
          spec={spec}
          registry={{ Input: config }}
          state={node(value)}
        />
      </Suspense>
    );
    const view = render(content(a, 'ready'));
    const old = edit(view);
    await act(async () => {
      startTransition(() => view.rerender(content(b, 'suspend')));
    });
    expect(view.getByRole('textbox')).toBe(old);
    expect(attempts).toContain('suspend');
    await act(async () => view.rerender(content(c, 'replacement')));
    const input = view.getByRole('textbox') as HTMLInputElement;
    expect(input).not.toBe(old);
    expect(input.value).toBe('replacement');
  });
});
