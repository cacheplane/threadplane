import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TimeTravelSnapshot } from './application';
import { TimeTravelDemo } from './app';
import { captureHistoryPage } from './checkpoint-history';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
const source = {
  thread_id: 'thread-A',
  checkpoint_ns: '' as const,
  checkpoint_id: '<literal checkpoint>',
};
const page = captureHistoryPage(
  [
    {
      checkpoint: source,
      parent_checkpoint: null,
      created_at: '<literal date>',
      next: [],
    },
  ],
  'thread-A'
)!;
function setup(update: Partial<TimeTravelSnapshot> = {}) {
  let state: TimeTravelSnapshot = {
    threadId: null,
    rows: [],
    historyPage: undefined,
    historyError: null,
    selectedSource: null,
    busy: false,
    canSubmit: true,
    canRefresh: false,
    canFork: false,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const listeners = new Set<() => void>();
  const replace = (change: Partial<TimeTravelSnapshot>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const application = {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn(async (_text: string) => {
      replace({
        busy: true,
        canSubmit: false,
        canFork: false,
        activity: 'running',
      });
    }),
    forkSelected: vi.fn(async (_text: string) => {
      replace({
        busy: true,
        canSubmit: false,
        canFork: false,
        activity: 'running',
      });
    }),
    selectCheckpoint: vi.fn((index: number) => {
      replace({
        selectedSource: state.historyPage?.[index]?.source ?? null,
        canFork: true,
      });
    }),
    refreshHistory: vi.fn(async () => {
      replace({
        busy: true,
        canSubmit: false,
        canRefresh: false,
        activity: 'reading',
      });
    }),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => {
      replace({ viewGeneration: state.viewGeneration + 1 });
    }),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockReturnValue(application);
  const onReady = vi.fn(),
    view = render(
      <TimeTravelDemo
        connection={{ apiUrl: 'https://example.test', headers: {} }}
        onReady={onReady}
      />
    );
  return { application, view, onReady };
}
it('uses native chat and honestly labels the last explicitly loaded checkpoint page', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'LangGraph time travel' })
  ).toBeTruthy();
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(
    h.view.getByRole('region', { name: 'Last loaded checkpoint page' })
      .textContent
  ).toContain('No checkpoint page loaded.');
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  expect(h.application.refreshHistory).not.toHaveBeenCalled();
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(h.onReady).toHaveBeenCalledOnce();
});
it('selection is a distinct inert control and retains the visible draft', () => {
  const h = setup({
    threadId: 'thread-A',
    historyPage: page,
    canRefresh: true,
  });
  const input = h.view.getByRole('textbox', {
    name: 'Message',
    exact: true,
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Visible fork draft' } });
  fireEvent.click(
    h.view.getByRole('button', { name: 'Select checkpoint 1', exact: true })
  );
  expect(h.application.selectCheckpoint).toHaveBeenCalledWith(0);
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(h.application.forkSelected).not.toHaveBeenCalled();
  expect(input.value).toBe('Visible fork draft');
  fireEvent.click(
    h.view.getByRole('button', {
      name: 'Fork selected checkpoint',
      exact: true,
    })
  );
  expect(h.application.forkSelected).toHaveBeenCalledWith('Visible fork draft');
  expect(input.value).toBe('');
});
it('ordinary Send continues the primary even when a past source is selected', () => {
  const h = setup({ selectedSource: source, canFork: true, historyPage: page });
  fireEvent.change(
    h.view.getByRole('textbox', { name: 'Message', exact: true }),
    { target: { value: 'Continue primary' } }
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Send', exact: true }));
  expect(h.application.submit).toHaveBeenCalledWith('Continue primary');
  expect(h.application.forkSelected).not.toHaveBeenCalled();
});
it('empty draft cannot fork and New clears a controlled draft', () => {
  const h = setup({ selectedSource: source, canFork: true });
  expect(
    (
      h.view.getByRole('button', {
        name: 'Fork selected checkpoint',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  const input = h.view.getByRole('textbox', {
    name: 'Message',
    exact: true,
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Discard me' } });
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledOnce();
  expect(input.value).toBe('');
});
it('renders unavailable checkpoints and reference text literally without commands', () => {
  const unavailable = captureHistoryPage(
    [
      {
        checkpoint: { ...source, checkpoint_ns: '<script>child</script>' },
        next: ['generate'],
      },
    ],
    'thread-A'
  )!;
  const h = setup({ historyPage: unavailable });
  const panel = h.view.getByRole('region', {
    name: 'Last loaded checkpoint page',
  });
  expect(panel.textContent).toContain('<literal checkpoint>');
  expect(panel.textContent).toContain('<script>child</script>');
  expect(
    h.view.queryByRole('button', { name: 'Select checkpoint 1' })
  ).toBeNull();
  expect(h.view.container.querySelector('script, literal')).toBeNull();
});
it('Refresh stays a separate command and an active read offers Stop while gating New and Fork', () => {
  const h = setup({
    busy: true,
    canSubmit: false,
    canRefresh: false,
    canFork: false,
    activity: 'reading',
  });
  expect(h.view.getByRole('status').textContent).toBe(
    'Reading saved checkpoints…'
  );
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  expect(h.application.stop).toHaveBeenCalledOnce();
});
it('shows an observed empty page separately from protected read failure', () => {
  const h = setup({
    historyPage: [],
    historyError: 'The checkpoint page was not refreshed.',
  });
  expect(
    h.view.getByRole('region', { name: 'Last loaded checkpoint page' })
      .textContent
  ).toContain('The last loaded page was empty.');
  expect(h.view.getByRole('alert').textContent).toBe(
    'The checkpoint page was not refreshed.'
  );
});
it('unmount disposes the application during a fork', () => {
  const h = setup({ busy: true, canSubmit: false, activity: 'running' });
  h.view.unmount();
  expect(h.application.dispose).toHaveBeenCalledOnce();
});
