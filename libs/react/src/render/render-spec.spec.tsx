import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderSpecData,
  type RenderViewProps,
} from './index';

afterEach(cleanup);
const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
const Text = ({ props }: RenderViewProps) => (
  <p>{String(props['text'] ?? '')}</p>
);
const registry: ReactRenderRegistry = { Box, Text };
const tree: RenderSpecData = {
  root: 'root',
  elements: {
    root: { type: 'Box', props: {}, children: ['title', 'rows'] },
    title: {
      type: 'Text',
      props: { text: { $state: '/title' } },
      visible: { $state: '/show' },
    },
    rows: {
      type: 'Box',
      props: {},
      children: ['row'],
      repeat: { statePath: '/rows', key: 'id' },
    },
    row: { type: 'Text', props: { text: { $item: 'text' } } },
  },
};
describe('RenderSpec', () => {
  it('uses an explicitly empty repeat-key field to retain reordered view identity', () => {
    const Counter = ({ props }: RenderViewProps) => {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount(count + 1)}>
          {String(props['text'])}:{count}
        </button>
      );
    };
    const spec: RenderSpecData = {
      root: 'rows',
      elements: {
        rows: {
          type: 'Box',
          props: {},
          children: ['row'],
          repeat: { statePath: '/rows', key: '' },
        },
        row: { type: 'Counter', props: { text: { $item: 'text' } } },
      },
    };
    const a = { '': 'a', text: 'A' },
      b = { '': 'b', text: 'B' };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ Box, Counter }}
        state={{ rows: [a, b] }}
      />
    );
    fireEvent.click(view.getByText('A:0'));
    const mounted = view.getByText('A:1');
    view.rerender(
      <RenderSpec
        spec={spec}
        registry={{ Box, Counter }}
        state={{ rows: [b, a] }}
      />
    );
    expect(view.getByText('A:1')).toBe(mounted);
  });
  it('renders literal supplied text, ordered children and explicit state', () => {
    const view = render(
      <RenderSpec
        spec={tree}
        registry={registry}
        state={{
          title: '<b>literal</b>',
          show: true,
          rows: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        }}
      />
    );
    expect(view.getAllByRole('paragraph').map((p) => p.textContent)).toEqual([
      '<b>literal</b>',
      'A',
      'B',
    ]);
    expect(view.container.querySelector('b')).toBeNull();
  });
  it('updates state bindings, visibility and repeat children without commands', () => {
    const view = render(
      <RenderSpec
        spec={tree}
        registry={registry}
        state={{ title: 'First', show: true, rows: [{ id: 'a', text: 'A' }] }}
      />
    );
    const row = view.getByText('A');
    view.rerender(
      <RenderSpec
        spec={tree}
        registry={registry}
        state={{
          title: 'Second',
          show: false,
          rows: [{ id: 'a', text: 'Changed' }],
        }}
      />
    );
    expect(view.queryByText('First')).toBeNull();
    expect(view.queryByText('Second')).toBeNull();
    expect(view.getByText('Changed')).toBe(row);
  });
  it('handles null, missing and inherited root IDs without a fallback', () => {
    const fallback = vi.fn(() => <p>Fallback</p>);
    const view = render(
      <RenderSpec spec={null} registry={registry} fallback={fallback} />
    );
    for (const root of ['missing', 'constructor', '__proto__', 'toString']) {
      view.rerender(
        <RenderSpec
          spec={{ root, elements: {} }}
          registry={registry}
          fallback={fallback}
        />
      );
      expect(view.container.textContent).toBe('');
    }
    expect(fallback).not.toHaveBeenCalled();
  });
  it('uses own element and registry keys even for special names', () => {
    for (const key of ['', 'constructor', '__proto__', 'toString']) {
      const spec = {
        root: key,
        elements: Object.fromEntries([
          [key, { type: key, props: { text: key || 'Empty key' } }],
        ]),
      };
      const view = render(
        <RenderSpec spec={spec} registry={Object.fromEntries([[key, Text]])} />
      );
      expect(view.getByText(key || 'Empty key')).toBeTruthy();
      view.unmount();
    }
  });
  it('omits unknown types and missing children or renders an authored fallback', () => {
    const spec = {
      root: 'root',
      elements: {
        root: {
          type: 'Box',
          props: {},
          children: ['missing', 'unknown', 'constructor'],
        },
        unknown: { type: 'constructor', props: { text: 'Unknown' } },
      },
    };
    const view = render(<RenderSpec spec={spec} registry={registry} />);
    expect(view.container.textContent).toBe('');
    view.rerender(
      <RenderSpec spec={spec} registry={registry} fallback={Text} />
    );
    expect(view.container.textContent).toBe('Unknown');
  });
  it('renders a repeating container once and passes item, index and binding paths', () => {
    const captured: RenderViewProps[] = [];
    const Capture = (props: RenderViewProps) => {
      captured.push(props);
      return <p>{String(props.props['text'])}</p>;
    };
    const spec: RenderSpecData = {
      root: 'rows',
      elements: {
        rows: {
          type: 'Box',
          props: {},
          children: ['row'],
          repeat: { statePath: '/rows' },
        },
        row: {
          type: 'Capture',
          props: {
            text: { $bindItem: 'text' },
            index: { $index: true },
            title: { $bindState: '/title' },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ Box, Capture }}
        state={{ title: 'Title', rows: [{ text: 'A' }, { text: 'B' }] }}
        loading
      />
    );
    expect(view.container.querySelectorAll('section')).toHaveLength(1);
    expect(captured.map(({ props }) => props['index'])).toEqual([0, 1]);
    expect(captured.map(({ bindings }) => bindings)).toEqual([
      { text: '/rows/0/text', title: '/title' },
      { text: '/rows/1/text', title: '/title' },
    ]);
    expect(captured.every(({ loading }) => loading)).toBe(true);
  });
  it('treats non-array repeats as empty and resolves nested absolute repeats', () => {
    const spec: RenderSpecData = {
      root: 'outer',
      elements: {
        outer: {
          type: 'Box',
          props: {},
          children: ['inner'],
          repeat: { statePath: '/outer' },
        },
        inner: {
          type: 'Box',
          props: {},
          children: ['text'],
          repeat: { statePath: '/inner' },
        },
        text: {
          type: 'Text',
          props: { text: { $item: '' } },
          visible: { $index: true, eq: 0 },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ outer: [{}], inner: ['A', 'B'] }}
      />
    );
    expect(view.container.textContent).toBe('A');
    view.rerender(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ outer: {}, inner: ['A'] }}
      />
    );
    expect(view.container.textContent).toBe('');
  });
  it('preserves keyed view-local state across reorder and distinguishes key types/index fallback', () => {
    const Counter = ({ props }: RenderViewProps) => {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount(count + 1)}>
          {String(props['text'])}:{count}
        </button>
      );
    };
    const spec: RenderSpecData = {
      ...tree,
      elements: {
        ...tree.elements,
        row: { type: 'Counter', props: { text: { $item: 'text' } } },
      },
    };
    const state = {
      show: false,
      rows: [
        { id: 1, text: 'Number' },
        { id: '1', text: 'String' },
        { id: 'index:3', text: 'Explicit' },
        { text: 'Fallback' },
      ],
    };
    const view = render(
      <RenderSpec spec={spec} registry={{ Box, Counter }} state={state} />
    );
    fireEvent.click(view.getByText('Number:0'));
    const mounted = view.getByText('Number:1');
    view.rerender(
      <RenderSpec
        spec={spec}
        registry={{ Box, Counter }}
        state={{
          ...state,
          rows: [state.rows[1], state.rows[0], state.rows[2], state.rows[3]],
        }}
      />
    );
    expect(view.getByText('Number:1')).toBe(mounted);
    expect(view.getByText('String:0')).toBeTruthy();
    expect(view.getByText('Explicit:0')).toBeTruthy();
    expect(view.getByText('Fallback:0')).toBeTruthy();
  });
  it('rejects duplicate sibling and repeated identities', () => {
    const repeated = {
      show: false,
      rows: [
        { id: 'same', text: 'A' },
        { id: 'same', text: 'B' },
      ],
    };
    expect(() =>
      render(<RenderSpec spec={tree} registry={registry} state={repeated} />)
    ).toThrow(/duplicate.*repeat/i);
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'Box', props: {}, children: ['text', 'text'] },
        text: { type: 'Text', props: { text: 'Same' } },
      },
    };
    expect(() =>
      render(<RenderSpec spec={spec} registry={registry} />)
    ).toThrow(/duplicate.*child/i);
  });
  it('cuts ancestor cycles while allowing a child in separate branches', () => {
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'Box', props: {}, children: ['left', 'right'] },
        left: { type: 'Box', props: {}, children: ['root', 'text'] },
        right: { type: 'Box', props: {}, children: ['text'] },
        text: { type: 'Text', props: { text: 'Shared' } },
      },
    };
    const view = render(<RenderSpec spec={spec} registry={registry} />);
    expect(view.getAllByText('Shared')).toHaveLength(2);
  });
  it('owns frozen resolved props without freezing or changing caller data', () => {
    let captured: RenderViewProps | undefined;
    const Capture = (props: RenderViewProps) => {
      captured = props;
      return null;
    };
    const state = { payload: { list: ['A'], nested: { count: 1 } } };
    const spec = {
      root: 'root',
      elements: {
        root: {
          type: 'Capture',
          props: {
            payload: { $state: '/payload' },
            missing: { $state: '/missing' },
          },
        },
      },
    };
    const before = JSON.stringify({ state, spec });
    render(<RenderSpec spec={spec} registry={{ Capture }} state={state} />);
    if (!captured) throw new Error('Capture view did not render');
    expect(captured.props['missing']).toBeUndefined();
    const payload = captured.props['payload'] as {
      readonly list: readonly string[];
      readonly nested: { readonly count: number };
    };
    expect(payload).not.toBe(state.payload);
    expect(Object.isFrozen(captured.props)).toBe(true);
    expect(Object.isFrozen(payload.list)).toBe(true);
    expect(Object.isFrozen(payload.nested)).toBe(true);
    expect(Object.isFrozen(state.payload)).toBe(false);
    expect(JSON.stringify({ state, spec })).toBe(before);
  });
  it('preserves state-bound special keys and rejects unsupported raw __proto__ props', () => {
    let captured: RenderViewProps | undefined;
    const Capture = (props: RenderViewProps) => {
      captured = props;
      return null;
    };
    const payload = JSON.parse(
      '{"":1,"__proto__":{"own":true},"constructor":2}'
    );
    render(
      <RenderSpec
        spec={{
          root: 'root',
          elements: {
            root: {
              type: 'Capture',
              props: { payload: { $state: '/payload' } },
            },
          },
        }}
        registry={{ Capture }}
        state={{ payload }}
      />
    );
    if (!captured) throw new Error('Capture view did not render');
    const owned = captured.props['payload'] as Record<string, unknown>;
    expect(Object.hasOwn(owned, '__proto__')).toBe(true);
    expect(owned['__proto__']).toEqual({ own: true });
    expect(owned['']).toBe(1);
    expect(owned['constructor']).toBe(2);
    expect(() =>
      render(
        <RenderSpec
          spec={{
            root: 'root',
            elements: { root: { type: 'Capture', props: payload } },
          }}
          registry={{ Capture }}
        />
      )
    ).toThrow(/__proto__/);
  });
  it('rejects cyclic/non-JSON raw props rather than invoking data callbacks', () => {
    const invoke = vi.fn();
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    for (const props of [
      { value: invoke },
      { value: new Date() },
      { value: Infinity },
      cyclic,
    ]) {
      const spec = {
        root: 'root',
        elements: { root: { type: 'Text', props } },
      } as unknown as RenderSpecData;
      expect(() =>
        render(<RenderSpec spec={spec} registry={registry} />)
      ).toThrow(/JSON|cyclic|finite/i);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects array accessors without invoking them', () => {
    const getter = vi.fn(() => 'surprise');
    const values: string[] = [];
    Object.defineProperty(values, '0', { enumerable: true, get: getter });
    expect(() =>
      render(
        <RenderSpec
          spec={{
            root: 'root',
            elements: { root: { type: 'Text', props: {} } },
          }}
          registry={registry}
          state={{ values }}
        />
      )
    ).toThrow(/data properties/);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects executable array overrides without invoking them', () => {
    const invoke = vi.fn(() => []);
    const mapped = Object.assign(['text'], { map: invoke });
    const iterated = Object.assign(['text'], { [Symbol.iterator]: invoke });
    class CustomArray extends Array<unknown> {}
    Object.defineProperty(CustomArray.prototype, 'map', { value: invoke });
    for (const values of [mapped, iterated, new CustomArray()]) {
      const spec = {
        root: 'root',
        elements: { root: { type: 'Text', props: { values } } },
      } as unknown as RenderSpecData;
      expect(() =>
        render(<RenderSpec spec={spec} registry={registry} />)
      ).toThrow(/JSON|array/i);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it('ignores structural action/watch/state extras through mount, update and unmount', () => {
    const command = vi.fn();
    const spec = {
      root: 'root',
      state: { text: 'Implicit' },
      elements: {
        root: {
          type: 'Text',
          props: { text: { $state: '/text' } },
          on: { press: { action: command } },
          watch: { '/text': { action: command } },
        },
      },
    };
    const view = render(
      <StrictMode>
        <RenderSpec
          spec={spec}
          registry={registry}
          state={{ text: 'Explicit' }}
        />
      </StrictMode>
    );
    expect(view.getByText('Explicit')).toBeTruthy();
    view.rerender(
      <StrictMode>
        <RenderSpec
          spec={spec}
          registry={registry}
          state={{ text: 'Changed' }}
        />
      </StrictMode>
    );
    view.unmount();
    expect(command).not.toHaveBeenCalled();
  });
});
