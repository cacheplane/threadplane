import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatDebug } from './chat-debug';
import type { ChatDebugProps, DebugSelection } from './types';
const selection: DebugSelection = {
  contextKey: 'owner',
  pageGeneration: 1,
  rowKey: 'row',
};
const base: ChatDebugProps = {
  contextKey: 'owner',
  defaultOpen: true,
  current: { contextKey: 'owner', status: 'ready', values: { current: 'now' } },
  checkpointPage: {
    contextKey: 'owner',
    pageGeneration: 1,
    rows: [{ rowKey: 'row', label: 'Checkpoint A', inspectable: true }],
    truncated: false,
  },
  selection,
  inspection: { status: 'ready', selection, values: { historical: 'then' } },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it('compares the matched historical checkpoint before current state in a collapsed passive disclosure', () => {
  const onRefresh = vi.fn(() => undefined);
  const onInspect = vi.fn(() => undefined);
  const v = render(
    <ChatDebug {...base} onRefresh={onRefresh} onInspect={onInspect} />
  );
  const summary = v.getByText('Compare selected checkpoint with current state');
  expect(summary.closest('details')?.open).toBe(false);
  fireEvent.click(summary);
  const comparison = v.getByRole('region', {
    name: 'Selected checkpoint to current state',
  });
  expect(
    JSON.parse(String(comparison.querySelector('pre')?.textContent))
  ).toEqual([
    { kind: 'removed', path: '/historical', before: 'then' },
    { kind: 'added', path: '/current', after: 'now' },
  ]);
  expect(onRefresh).not.toHaveBeenCalled();
  expect(onInspect).not.toHaveBeenCalled();
  expect(comparison.querySelector('button')).toBeNull();
});
it('retires checkpoint comparison immediately on all unavailable and mismatched ownership states', () => {
  const v = render(<ChatDebug {...base} />);
  const page = base.checkpointPage;
  if (!page) throw new Error('Missing fixture page');
  const changes: Partial<ChatDebugProps>[] = [
    { current: { contextKey: 'owner', status: 'unknown' } },
    { current: { contextKey: 'owner', status: 'unavailable' } },
    { current: { contextKey: 'other', status: 'ready', values: {} } },
    { inspection: { status: 'idle' } },
    { inspection: { status: 'loading', selection } },
    { inspection: { status: 'error', selection, message: 'Failed' } },
    { inspection: { status: 'unavailable', selection } },
    {
      inspection: {
        status: 'ready',
        selection: { ...selection, pageGeneration: 2 },
        values: {},
      },
    },
    {
      inspection: {
        status: 'ready',
        selection: { ...selection, contextKey: 'other' },
        values: {},
      },
    },
    {
      inspection: {
        status: 'ready',
        selection: { ...selection, rowKey: 'other' },
        values: {},
      },
    },
    { checkpointPage: undefined },
    { checkpointPage: { ...page, contextKey: 'other' } },
    { checkpointPage: { ...page, pageGeneration: 2 } },
    {
      checkpointPage: {
        ...page,
        rows: [{ ...page.rows[0], inspectable: false }],
      },
    },
    { selection: undefined },
    { contextKey: 'other' },
  ];
  for (const changed of changes) {
    v.rerender(<ChatDebug {...base} />);
    expect(
      v.getByText('Compare selected checkpoint with current state')
    ).toBeTruthy();
    v.rerender(<ChatDebug {...base} {...changed} />);
    expect(
      v.queryByText('Compare selected checkpoint with current state')
    ).toBeNull();
    expect(
      v.queryByRole('region', { name: 'Selected checkpoint to current state' })
    ).toBeNull();
  }
});
it('separates observed current and controlled historical values with identity', () => {
  const v = render(<ChatDebug {...base} />);
  expect(v.getByRole('heading', { name: 'Current state' })).toBeTruthy();
  expect(
    v.getByRole('heading', { name: 'Selected checkpoint: Checkpoint A' })
  ).toBeTruthy();
  expect(v.getByText(/"current":"now"/)).toBeTruthy();
  expect(v.getByText(/"historical":"then"/)).toBeTruthy();
});
it('distinguishes unknown, unavailable, empty state, unloaded and empty history', () => {
  const v = render(
    <ChatDebug
      {...base}
      current={{ contextKey: 'owner', status: 'unknown' }}
      checkpointPage={undefined}
    />
  );
  expect(v.getByText('Current state has not been observed.')).toBeTruthy();
  fireEvent.click(v.getByRole('tab', { name: 'Timeline' }));
  expect(v.getByText('Checkpoint page has not been loaded.')).toBeTruthy();
  v.rerender(
    <ChatDebug
      {...base}
      current={{ contextKey: 'owner', status: 'unavailable' }}
      checkpointPage={{ ...base.checkpointPage!, rows: [] }}
    />
  );
  expect(v.getByText('No saved checkpoints in this page.')).toBeTruthy();
  fireEvent.click(v.getByRole('tab', { name: 'State' }));
  expect(v.getByText('Current state is unavailable.')).toBeTruthy();
  v.rerender(
    <ChatDebug
      {...base}
      current={{ contextKey: 'owner', status: 'ready', values: {} }}
    />
  );
  expect(v.getByText('{}')).toBeTruthy();
});
it('suppresses mismatched context, page, row and error inspection', () => {
  const v = render(<ChatDebug {...base} contextKey="other" />);
  expect(v.queryByText(/"now"/)).toBeNull();
  expect(v.queryByText(/"then"/)).toBeNull();
  for (const changed of [
    { contextKey: 'other' },
    { pageGeneration: 2 },
    { rowKey: 'missing' },
  ]) {
    v.rerender(
      <ChatDebug
        {...base}
        inspection={{
          status: 'ready',
          selection: { ...selection, ...changed },
          values: { stale: 'secret' },
        }}
      />
    );
    expect(v.queryByText(/secret/)).toBeNull();
    v.rerender(
      <ChatDebug
        {...base}
        inspection={{
          status: 'error',
          selection: { ...selection, ...changed },
          message: 'stale failure',
        }}
      />
    );
    expect(v.queryByText('stale failure')).toBeNull();
  }
});
it('only explicit refresh and inspect notify once with exact tokens', () => {
  const onRefresh = vi.fn(() => undefined);
  const onInspect = vi.fn(() => undefined);
  const v = render(
    <ChatDebug {...base} onRefresh={onRefresh} onInspect={onInspect} />
  );
  fireEvent.click(v.getByRole('button', { name: 'Dock bottom' }));
  fireEvent.click(v.getByRole('tab', { name: 'Timeline' }));
  expect(onRefresh).not.toHaveBeenCalled();
  expect(onInspect).not.toHaveBeenCalled();
  fireEvent.click(v.getByRole('button', { name: 'Refresh checkpoints' }));
  fireEvent.click(v.getByRole('button', { name: 'Inspect Checkpoint A' }));
  expect(onRefresh.mock.calls).toEqual([
    [{ contextKey: 'owner', pageGeneration: 1 }],
  ]);
  expect(onInspect.mock.calls).toEqual([[selection]]);
  fireEvent.click(v.getByRole('button', { name: 'Close debug panel' }));
  fireEvent.click(v.getByRole('button', { name: 'Open debug panel' }));
  v.unmount();
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(onInspect).toHaveBeenCalledOnce();
});
it('disables read controls while busy and unavailable rows', () => {
  const v = render(
    <ChatDebug
      {...base}
      activity={{ busy: true, status: 'Reading' }}
      onRefresh={() => undefined}
      onInspect={() => undefined}
    />
  );
  expect(
    (
      v.getByRole('button', {
        name: 'Refresh checkpoints',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(v.getByRole('tab', { name: 'Timeline' }));
  expect(
    (
      v.getByRole('button', {
        name: 'Inspect Checkpoint A',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(v.getByText('Reading')).toBeTruthy();
});
it('copies exactly the bounded displayed projection and reports resolved/rejected writes', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const v = render(
    <ChatDebug
      {...base}
      current={{
        contextKey: 'owner',
        status: 'ready',
        values: { big: 'x'.repeat(10000) },
      }}
    />
  );
  expect(v.getByText(/Display truncated/)).toBeTruthy();
  await act(async () =>
    fireEvent.click(
      v.getByRole('button', { name: 'Copy displayed current state' })
    )
  );
  expect(writeText).toHaveBeenCalledWith(
    v.container.querySelector('pre')!.textContent
  );
  expect(
    new TextEncoder().encode(writeText.mock.calls[0][0]).length
  ).toBeLessThanOrEqual(32768);
  expect(v.getByText('Copied displayed projection.')).toBeTruthy();
  writeText.mockRejectedValueOnce(new Error('denied'));
  await act(async () =>
    fireEvent.click(
      v.getByRole('button', { name: 'Copy displayed current state' })
    )
  );
  expect(v.getByText('Could not copy displayed projection.')).toBeTruthy();
});
it('page replacement clears historical expansion and stale clipboard feedback', async () => {
  let finish!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const v = render(<ChatDebug {...base} />);
  const detail = v.getByText('Displayed checkpoint values').closest('details')!;
  detail.open = true;
  fireEvent.click(
    v.getByRole('button', { name: 'Copy displayed checkpoint values' })
  );
  v.rerender(
    <ChatDebug
      {...base}
      checkpointPage={{ ...base.checkpointPage!, pageGeneration: 2 }}
    />
  );
  expect(v.queryByText(/"then"/)).toBeNull();
  await act(async () => finish());
  expect(v.queryByText('Copied displayed projection.')).toBeNull();
  v.rerender(<ChatDebug {...base} />);
  expect(
    v.getByText('Displayed checkpoint values').closest('details')!.open
  ).toBe(false);
});
it('links tabs and supports scoped keyboard focus and user-close restoration', () => {
  const v = render(<ChatDebug {...base} />);
  const state = v.getByRole('tab', { name: 'State' });
  state.focus();
  fireEvent.keyDown(state, { key: 'End' });
  const timeline = v.getByRole('tab', { name: 'Timeline' });
  expect(document.activeElement).toBe(timeline);
  expect(timeline.getAttribute('aria-controls')).toBe(
    v.getByRole('tabpanel').id
  );
  fireEvent.keyDown(timeline, { key: 'Home' });
  expect(document.activeElement).toBe(state);
  fireEvent.keyDown(state, { key: 'Escape' });
  expect(v.queryByRole('region', { name: 'Chat debug' })).toBeNull();
  expect(document.activeElement).toBe(
    v.getByRole('button', { name: 'Open debug panel' })
  );
});
it('outside pointer respects composed paths, independent roots and outside focus', () => {
  const v = render(
    <>
      <ChatDebug {...base} />
      <ChatDebug {...base} />
      <button>Outside</button>
    </>
  );
  const regions = v.getAllByRole('region', { name: 'Chat debug' });
  fireEvent.pointerDown(within(regions[1]).getByRole('tab', { name: 'State' }));
  expect(v.getAllByRole('region', { name: 'Chat debug' })).toHaveLength(1);
  const outside = v.getByRole('button', { name: 'Outside' });
  outside.focus();
  fireEvent.pointerDown(outside);
  expect(v.queryByRole('region', { name: 'Chat debug' })).toBeNull();
  expect(document.activeElement).toBe(outside);
  fireEvent.keyDown(outside, { key: 'Escape' });
});
it('SSR markup uses data/defaults; hydration restores prefs without overwriting them', async () => {
  const saved = JSON.stringify({ open: true, dock: 'bottom', tab: 'timeline' });
  localStorage.setItem('app-debug', saved);
  const props = { ...base, defaultOpen: false, storageKey: 'app-debug' };
  const html = renderToString(<ChatDebug {...props} />);
  expect(html).not.toContain('role="region"');
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = html;
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <ChatDebug {...props} />);
  });
  expect(container.querySelector('[data-dock="bottom"]')).toBeTruthy();
  expect(container.textContent).toContain('Checkpoint A');
  expect(localStorage.getItem('app-debug')).toBe(saved);
  await act(async () => root.unmount());
  container.remove();
});
it('survives denied localStorage property acquisition', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(() =>
    render(<ChatDebug {...base} storageKey="denied" />)
  ).not.toThrow();
});

it('restores preferences once per key despite StrictMode replay or changed defaults', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem');
  const v = render(
    <StrictMode>
      <ChatDebug {...base} storageKey="once" />
    </StrictMode>
  );
  v.rerender(
    <StrictMode>
      <ChatDebug {...base} defaultOpen={false} storageKey="once" />
    </StrictMode>
  );
  expect(get.mock.calls.filter(([key]) => key === 'once')).toHaveLength(1);
  expect(v.getByRole('region', { name: 'Chat debug' })).toBeTruthy();
  v.rerender(<ChatDebug {...base} storageKey="different" />);
  expect(get.mock.calls.filter(([key]) => key === 'different')).toHaveLength(1);
});
it('suppresses controlled historical ready values for unavailable and undisplayed rows', () => {
  const v = render(
    <ChatDebug
      {...base}
      checkpointPage={{
        ...base.checkpointPage!,
        rows: [{ ...base.checkpointPage!.rows[0], inspectable: false }],
      }}
    />
  );
  expect(v.queryByText(/"historical"/)).toBeNull();
  const rows = Array.from({ length: 10 }, (_, i) => ({
    rowKey: `other${i}`,
    label: 'Other',
    inspectable: true,
  }));
  v.rerender(
    <ChatDebug
      {...base}
      checkpointPage={{
        ...base.checkpointPage!,
        rows: [...rows, base.checkpointPage!.rows[0]],
      }}
    />
  );
  expect(v.queryByText(/"historical"/)).toBeNull();
});

it('ignores clipboard completion after unmount and reports a missing clipboard', async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const v = render(<ChatDebug {...base} />);
  fireEvent.click(
    v.getByRole('button', { name: 'Copy displayed checkpoint values' })
  );
  v.unmount();
  await act(async () => finish());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  const next = render(<ChatDebug {...base} />);
  await act(async () =>
    fireEvent.click(
      next.getByRole('button', { name: 'Copy displayed current state' })
    )
  );
  expect(next.getByText('Could not copy displayed projection.')).toBeTruthy();
});
it('refreshes unloaded pages with null generation and leaves selection controlled', () => {
  const onRefresh = vi.fn(() => undefined);
  const onInspect = vi.fn(() => undefined);
  const v = render(
    <ChatDebug
      {...base}
      checkpointPage={undefined}
      selection={undefined}
      onRefresh={onRefresh}
      onInspect={onInspect}
    />
  );
  fireEvent.click(v.getByRole('button', { name: 'Refresh checkpoints' }));
  expect(onRefresh.mock.calls).toEqual([
    [{ contextKey: 'owner', pageGeneration: null }],
  ]);
  v.rerender(
    <ChatDebug
      {...base}
      selection={undefined}
      onRefresh={onRefresh}
      onInspect={onInspect}
    />
  );
  fireEvent.click(v.getByRole('tab', { name: 'Timeline' }));
  fireEvent.click(v.getByRole('button', { name: 'Inspect Checkpoint A' }));
  fireEvent.click(v.getByRole('tab', { name: 'State' }));
  expect(
    v.queryByRole('heading', { name: 'Selected checkpoint: Checkpoint A' })
  ).toBeNull();
  expect(onInspect.mock.calls).toEqual([[selection]]);
});
it('server renders supplied values without browser effects or notifications', () => {
  const onRefresh = vi.fn(() => undefined);
  const onInspect = vi.fn(() => undefined);
  const html = renderToString(
    <ChatDebug {...base} onRefresh={onRefresh} onInspect={onInspect} />
  );
  expect(html).toContain('Current state');
  expect(html).toContain('historical');
  expect(html).toContain('Checkpoint A');
  expect(onRefresh).not.toHaveBeenCalled();
  expect(onInspect).not.toHaveBeenCalled();
});
it('uses composed pointer paths and arrow keys only within its own panel', () => {
  const v = render(<ChatDebug {...base} />);
  const root = v.container.firstElementChild!;
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'composedPath', {
    value: () => [root, document],
  });
  fireEvent(document, event);
  expect(v.getByRole('region', { name: 'Chat debug' })).toBeTruthy();
  const state = v.getByRole('tab', { name: 'State' });
  state.focus();
  fireEvent.keyDown(state, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(v.getByRole('tab', { name: 'Timeline' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(state);
});

it.each([false, true])(
  'resets equal-text projections on source replacement (StrictMode=%s)',
  async (strict) => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const value = (length: number) => {
      const panel = (
        <ChatDebug
          {...base}
          inspection={{
            status: 'ready',
            selection,
            values: 'x'.repeat(length),
          }}
        />
      );
      return strict ? <StrictMode>{panel}</StrictMode> : panel;
    };
    const view = render(value(2000));
    const disclosure = () =>
      view.getByText('Displayed checkpoint values').closest('details')!;
    const copyButton = () =>
      view.getByRole('button', {
        name: 'Copy displayed checkpoint values',
      }) as HTMLButtonElement;
    disclosure().open = true;
    const originalText = disclosure().querySelector('pre')!.textContent;
    await act(async () => fireEvent.click(copyButton()));
    expect(view.getByText('Copied displayed projection.')).toBeTruthy();
    view.rerender(value(2001));
    expect(disclosure().querySelector('pre')!.textContent).toBe(originalText);
    expect(view.getByText(/Display truncated/)).toBeTruthy();
    expect.soft(disclosure().open).toBe(false);
    expect.soft(view.queryByText('Copied displayed projection.')).toBeNull();

    // Equal projected bytes cannot transfer ownership of an earlier pending copy.
    view.rerender(value(2000));
    let finish!: () => void;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    disclosure().open = true;
    fireEvent.click(copyButton());
    expect(copyButton().disabled).toBe(true);
    view.rerender(value(2001));
    expect(disclosure().querySelector('pre')!.textContent).toBe(originalText);
    expect.soft(disclosure().open).toBe(false);
    expect.soft(copyButton().disabled).toBe(false);
    await act(async () => finish());
    expect.soft(view.queryByText('Copied displayed projection.')).toBeNull();
    expect.soft(copyButton().disabled).toBe(false);
  }
);
