import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RenderDevtools,
  RenderSpec,
  type ReactRenderRegistry,
  type RenderSpecData,
  type RenderViewProps,
} from './index';
import { resolveRenderTree, toRenderReport } from './devtools';

type Window = typeof window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

/** The extension's render-report grammar: exact keys, bounded names, known states. */
function isRenderReport(value: unknown): boolean {
  const exact = (object: unknown, keys: string[]) =>
    typeof object === 'object' &&
    object !== null &&
    Reflect.ownKeys(object).length === keys.length &&
    keys.every((key) => Object.hasOwn(object, key));
  const name = (text: unknown) =>
    typeof text === 'string' && text.length > 0 && text.length <= 128;
  if (
    !exact(value, ['v', 'kind', 'surface', 'seq', 'registry', 'elements', 'tMs'])
  )
    return false;
  const report = value as Record<string, unknown>;
  return (
    report['v'] === 1 &&
    report['kind'] === 'render' &&
    name(report['surface']) &&
    Number.isSafeInteger(report['seq']) &&
    (report['seq'] as number) >= 1 &&
    typeof report['tMs'] === 'number' &&
    (report['tMs'] as number) >= 0 &&
    (report['registry'] as unknown[]).every(name) &&
    (report['elements'] as unknown[]).every(
      (element) =>
        exact(element, ['key', 'type', 'state']) &&
        name((element as Record<string, unknown>)['key']) &&
        name((element as Record<string, unknown>)['type']) &&
        ['mounted', 'fallback', 'unresolved', 'hidden'].includes(
          (element as Record<string, string>)['state']
        )
    )
  );
}

let reports: Record<string, unknown>[] = [];
const listen = (event: Event) =>
  reports.push((event as CustomEvent<Record<string, unknown>>).detail);
beforeEach(() => {
  reports = [];
  vi.useFakeTimers();
  window.addEventListener('threadplane:devtools', listen);
});
afterEach(() => {
  cleanup();
  window.removeEventListener('threadplane:devtools', listen);
  delete (window as Window).__THREADPLANE_DEVTOOLS_DISABLED__;
  vi.useRealTimers();
});
const flush = () =>
  act(() => {
    vi.advanceTimersByTime(60);
  });
const states = (report: Record<string, unknown> | undefined) =>
  Object.fromEntries(
    ((report?.['elements'] ?? []) as { key: string; state: string }[]).map(
      ({ key, state }) => [key, state]
    )
  );

const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
/** Accepts children but never renders them. */
const Leaf = ({ props }: RenderViewProps) => <p>{String(props['text'])}</p>;
const Slow = ({ props }: RenderViewProps) => <p>{String(props['text'])}</p>;
const registry = (ready: boolean): ReactRenderRegistry => ({
  Box,
  Leaf,
  Gate: {
    kind: 'readiness',
    component: Slow,
    isReady: () => ready,
    fallback: () => <p>waiting</p>,
  },
});
const spec: RenderSpecData = {
  root: 'root',
  elements: {
    root: {
      type: 'Box',
      props: {},
      children: ['shown', 'off', 'missing', 'gate', 'rows', 'leaf'],
    },
    shown: { type: 'Leaf', props: { text: 'shown' } },
    off: { type: 'Leaf', props: { text: 'off' }, visible: false },
    missing: { type: 'Nope', props: {} },
    gate: { type: 'Gate', props: { text: 'gate' } },
    rows: {
      type: 'Box',
      props: {},
      children: ['row'],
      repeat: { statePath: '/rows' },
    },
    row: {
      type: 'Leaf',
      props: { text: { $item: 'text' } },
      visible: { $item: 'show' },
    },
    leaf: { type: 'Leaf', props: { text: 'leaf' }, children: ['under'] },
    under: { type: 'Leaf', props: { text: 'under' } },
    orphan: { type: 'Leaf', props: { text: 'orphan' } },
  },
};
const state = { rows: [{ text: 'a', show: false }, { text: 'b', show: true }] };
const surface = (ready: boolean, wrap: (node: ReactNode) => ReactNode) =>
  wrap(<RenderSpec spec={spec} registry={registry(ready)} state={state} />);
const devtools =
  (id?: string) =>
  (node: ReactNode): ReactNode =>
    <RenderDevtools surface={id}>{node}</RenderDevtools>;

describe('RenderDevtools', () => {
  it('reports each element as Angular does, from the views that actually committed', async () => {
    render(<>{surface(false, devtools())}</>);
    await flush();
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(isRenderReport(report)).toBe(true);
    expect(report).toMatchObject({
      v: 1,
      kind: 'render',
      surface: 'spec:root',
      registry: ['Box', 'Leaf', 'Gate'],
    });
    expect(
      (report['elements'] as { key: string }[]).map(({ key }) => key)
    ).toEqual([
      'root',
      'shown',
      'off',
      'missing',
      'gate',
      'rows',
      'row',
      'leaf',
      'under',
      'orphan',
    ]);
    expect(states(report)).toEqual({
      root: 'mounted',
      shown: 'mounted',
      off: 'hidden',
      missing: 'unresolved',
      gate: 'fallback',
      rows: 'mounted',
      // One repeat row is visible: the most-rendered state wins.
      row: 'mounted',
      leaf: 'mounted',
      // Its parent was handed `children` and never rendered them.
      under: 'hidden',
      orphan: 'hidden',
    });
  });

  it('reports a readiness gate opening, and nothing when the resolution is unchanged', async () => {
    const view = render(<>{surface(false, devtools('chat'))}</>);
    await flush();
    view.rerender(<>{surface(false, devtools('chat'))}</>);
    await flush();
    expect(reports).toHaveLength(1);
    view.rerender(<>{surface(true, devtools('chat'))}</>);
    await flush();
    expect(reports).toHaveLength(2);
    expect(reports[1]).toMatchObject({ surface: 'chat' });
    expect(states(reports[1])['gate']).toBe('mounted');
    expect(reports[1]['seq']).toBe((reports[0]['seq'] as number) + 1);
  });

  it('reports a repeated element as mounted when any row mounted', async () => {
    const rows: RenderSpecData = {
      root: 'list',
      elements: {
        list: {
          type: 'Box',
          props: {},
          children: ['item'],
          repeat: { statePath: '/rows' },
        },
        item: { type: 'Gate', props: { text: { $item: 'text' } } },
      },
    };
    const gated: ReactRenderRegistry = {
      Box,
      Gate: {
        kind: 'readiness',
        component: Slow,
        isReady: (props) => props['text'] === 'b',
      },
    };
    const wrap = devtools();
    const view = render(
      <>
        {wrap(
          <RenderSpec
            spec={rows}
            registry={gated}
            state={{ rows: [{ text: 'a' }, { text: 'b' }] }}
          />
        )}
      </>
    );
    await flush();
    expect(states(reports[0])['item']).toBe('mounted');
    view.rerender(
      <>
        {wrap(
          <RenderSpec
            spec={rows}
            registry={gated}
            state={{ rows: [{ text: 'a' }] }}
          />
        )}
      </>
    );
    await flush();
    expect(states(reports[1])['item']).toBe('fallback');
  });

  it('coalesces changes within the window into one report', async () => {
    const view = render(<>{surface(false, devtools())}</>);
    view.rerender(<>{surface(true, devtools())}</>);
    await flush();
    expect(reports).toHaveLength(1);
    expect(states(reports[0])['gate']).toBe('mounted');
  });

  it('reports under StrictMode and stops after unmount', async () => {
    const view = render(<StrictMode>{surface(false, devtools())}</StrictMode>);
    await flush();
    expect(reports).toHaveLength(1);
    expect(states(reports[0])['shown']).toBe('mounted');
    view.unmount();
    await flush();
    expect(reports).toHaveLength(1);
  });

  it('reports nothing without RenderDevtools, or once the page opts out', async () => {
    render(<>{surface(false, (node) => node)}</>);
    await flush();
    expect(reports).toHaveLength(0);
    cleanup();
    (window as Window).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    render(<>{surface(false, devtools())}</>);
    await flush();
    expect(reports).toHaveLength(0);
  });

  it('keeps reports inside the contract bounds', () => {
    const long = 'x'.repeat(129);
    const resolution = resolveRenderTree(
      {
        root: 'root',
        elements: {
          root: { type: 'Box', props: {}, children: [long, 'blank'] },
          [long]: { type: 'Box', props: {} },
          blank: { type: '', props: {} },
        },
      },
      { Box, [long]: Box },
      new Map([['root', 'mounted']])
    );
    if (!resolution) throw new Error('expected a resolution');
    expect(toRenderReport(resolution, long)).toBeNull();
    const report = toRenderReport(resolution, undefined);
    expect(report?.registry).toEqual(['Box']);
    expect(report?.elements).toEqual([
      { key: 'root', type: 'Box', state: 'mounted' },
    ]);
  });
});

describe('RenderDevtools in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('renders the children and reports nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const production = await import('./index');
    const view = render(
      <production.RenderDevtools surface="chat">
        <production.RenderSpec
          spec={spec}
          registry={registry(false)}
          state={state}
        />
      </production.RenderDevtools>
    );
    await flush();
    expect(view.getByText('shown')).toBeTruthy();
    expect(view.getByText('waiting')).toBeTruthy();
    expect(reports).toHaveLength(0);
  });
});
