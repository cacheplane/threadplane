// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessageContent } from '@threadplane/content/messages';
import type { GenerativeUiSnapshot } from './application';
import { createConnectedApplication } from './connection';
import { dashboardSpec } from './dashboard-spec';
import { message, layout } from './evidence.testing';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { GenerativeUiDemo } from './app';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function harness() {
  let snapshot: GenerativeUiSnapshot = {
    threadId: null,
    rows: [],
    messages: [],
    toolCalls: [],
    dashboard: {},
    surfaces: [],
    notices: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<GenerativeUiSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };
  const app = {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    submit: vi.fn((text: string) => {
      if (!text.trim()) return Promise.resolve(false);
      update({ busy: true, activity: 'running' });
      return new Promise<boolean>(() => undefined);
    }),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => {
      update({
        busy: false,
        viewGeneration: snapshot.viewGeneration + 1,
        rows: [],
        surfaces: [],
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app);
  const onReady = vi.fn();
  const view = render(
    <GenerativeUiDemo
      connection={{ apiUrl: 'https://authored.invalid', headers: {} }}
      onReady={onReady}
    />
  );
  return { app, update, view, onReady };
}
it('mounts inert, seeds without submitting, clears on admission and permits New during pending work', () => {
  const h = harness();
  expect(h.onReady).toHaveBeenCalledOnce();
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.click(h.view.getByRole('button', { name: 'Show dashboard' }));
  const box = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  expect(box.value).toBe('Show me a dashboard of airline operations.');
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledOnce();
  expect(box.value).toBe('');
  expect(
    h.view
      .getByRole('button', { name: 'New conversation' })
      .hasAttribute('disabled')
  ).toBe(false);
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledOnce();
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).toHaveBeenCalledOnce();
  h.view.unmount();
  expect(h.app.dispose).toHaveBeenCalledOnce();
});
it('owns each layout inline and refreshes all retained surfaces from the same confirmed dashboard during loading', () => {
  const h = harness(),
    content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    messages: [
      message('one', 'assistant', ''),
      message('two', 'assistant', ''),
    ],
    toolCalls: [],
  });
  act(() =>
    h.update({
      rows,
      surfaces: [
        { messageId: 'one', spec: required(dashboardSpec(layout)) },
        { messageId: 'two', spec: required(dashboardSpec(layout)) },
      ],
      dashboard: { on_time: { value: '84%', delta: null } },
    })
  );
  expect(h.view.getAllByText('84%')).toHaveLength(2);
  expect(
    h.view.container.querySelectorAll('article [data-dashboard-view]')
  ).toHaveLength(2);
  act(() => h.update({ busy: true, activity: 'confirming' }));
  expect(h.view.getAllByText('84%')).toHaveLength(2);
  act(() =>
    h.update({
      dashboard: { on_time: { value: '91%', delta: null } },
      busy: false,
    })
  );
  expect(h.view.getAllByText('91%')).toHaveLength(2);
  expect(h.view.queryByText('84%')).toBeNull();
  act(() =>
    h.update({
      notices: [{ messageId: 'one', text: 'Unsupported dashboard layout.' }],
    })
  );
  expect(h.view.getByText('Unsupported dashboard layout.')).toBeTruthy();
  h.view.unmount();
  content.dispose();
});
it('replaces and disposes the owner only when connection values change', () => {
  const h = harness();
  fireEvent.change(h.view.getByRole('textbox'), {
    target: { value: 'Private old draft' },
  });
  h.view.rerender(
    <GenerativeUiDemo
      connection={{ apiUrl: 'https://authored.invalid', headers: {} }}
      onReady={h.onReady}
    />
  );
  expect(createConnectedApplication).toHaveBeenCalledTimes(1);
  expect((h.view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    'Private old draft'
  );
  const next = { ...h.app, dispose: vi.fn(async () => undefined) };
  vi.mocked(createConnectedApplication).mockReturnValue(next);
  h.view.rerender(
    <GenerativeUiDemo
      connection={{
        apiUrl: 'https://authored.invalid',
        headers: { 'x-api-key': 'changed-secret' },
      }}
      onReady={h.onReady}
    />
  );
  expect(createConnectedApplication).toHaveBeenCalledTimes(2);
  expect(h.app.dispose).toHaveBeenCalledOnce();
  expect((h.view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  expect(h.view.container.innerHTML).not.toContain('changed-secret');
  h.view.unmount();
  expect(next.dispose).toHaveBeenCalledOnce();
});
it('keeps a rejected draft, handles keyboard composition, and clears the draft on New', () => {
  const h = harness();
  const box = h.view.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(box, {
    target: { value: 'Draft with <script>literal</script>' },
  });
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
  expect(h.app.submit).not.toHaveBeenCalled();
  h.app.submit.mockImplementationOnce(() => Promise.resolve(false));
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(box.value).toBe('Draft with <script>literal</script>');
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect((h.view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledTimes(1);
});
it('renders unavailable view fallback and literal tool evidence without interpreting markup', () => {
  const h = harness(),
    content = createMessageContent();
  const tools = [
    {
      id: 'tool',
      name: 'render_spec',
      status: 'complete' as const,
      args: { text: '<img src=x onerror=alert(1)>' },
      result: '<script>literal</script>',
    },
  ];
  const rows = content.project({
    status: 'idle',
    messages: [
      message('parent', 'assistant', '<script>source</script>', {
        toolCallIds: ['tool'],
      }),
    ],
    toolCalls: tools,
  });
  act(() =>
    h.update({
      rows,
      toolCalls: tools,
      surfaces: [
        {
          messageId: 'parent',
          spec: {
            root: 'unsupported',
            elements: { unsupported: { type: 'unsupported', props: {} } },
          },
        },
      ],
    })
  );
  expect(h.view.getByRole('alert').textContent).toBe(
    'This dashboard view is unavailable.'
  );
  const inspection = h.view
    .getByRole('region', { name: 'Observed tool: complete', hidden: true })
    .closest('details');
  expect(inspection).not.toBeNull();
  expect(inspection?.open).toBe(false);
  expect(h.view.container.querySelector('script')).toBeNull();
  expect(h.view.container.querySelector('img')).toBeNull();
  expect(h.view.container.textContent).toContain('<script>literal</script>');
  h.view.unmount();
  content.dispose();
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error('Required fixture');
  return value;
}
