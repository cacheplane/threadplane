import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DurableSnapshot } from './application';
import { DurableDemo } from './app';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
function setup(update: Partial<DurableSnapshot> = {}) {
  const state: DurableSnapshot = {
    threadId: null,
    rows: [],
    latestCheckpoint: null,
    checkpoints: [
      { id: 'analyze', label: 'Analyze', status: 'pending' },
      { id: 'plan', label: 'Plan', status: 'pending' },
      { id: 'generate', label: 'Generate', status: 'pending' },
    ],
    busy: false,
    canSubmit: true,
    canCheck: false,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const application = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(async () => undefined),
    checkStatus: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockReturnValue(application);
  const onReady = vi.fn();
  const view = render(
    <DurableDemo
      connection={{ apiUrl: 'https://example.test', headers: {} }}
      onReady={onReady}
    />
  );
  return { view, application, onReady };
}
it('starts without execution and presents literal pending checkpoints with native chat', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'LangGraph durable execution' })
  ).toBeTruthy();
  const panel = h.view.getByRole('region', {
    name: 'Saved pipeline checkpoints',
  });
  expect(panel.textContent).toContain('Analyze — pending');
  expect(panel.textContent).toContain('Generate — pending');
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(h.onReady).toHaveBeenCalledTimes(1);
  expect(h.view.queryByRole('button', { name: 'Check status' })).toBeNull();
});
it('offers an explicit read only when the owner permits reconciliation', () => {
  const h = setup({ canSubmit: false, canCheck: true, outcome: 'interrupted' });
  fireEvent.click(
    h.view.getByRole('button', { name: 'Check status', exact: true })
  );
  expect(h.application.checkStatus).toHaveBeenCalledTimes(1);
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
});
it('blocks competing controls while checking and keeps Stop available', () => {
  const h = setup({ busy: true, activity: 'checking', canSubmit: false });
  expect(h.view.getByRole('status').textContent).toBe(
    'Checking saved outcome…'
  );
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(h.view.queryByRole('button', { name: 'Check status' })).toBeNull();
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  expect(h.application.stop).toHaveBeenCalledTimes(1);
});
it('distinguishes a saved node from final request completion', () => {
  const h = setup({
    busy: true,
    activity: 'running',
    canSubmit: false,
    latestCheckpoint: 'analyze',
    checkpoints: [
      { id: 'analyze', label: 'Analyze', status: 'complete' },
      { id: 'plan', label: 'Plan', status: 'pending' },
      { id: 'generate', label: 'Generate', status: 'pending' },
    ],
  });
  expect(
    h.view.getByRole('region', { name: 'Saved pipeline checkpoints' })
      .textContent
  ).toContain('Latest checkpoint: Analyze');
  expect(h.view.getByRole('status').textContent).toBe('Receiving response…');
});
it('shows protected errors and requires New when reconciliation is unavailable', () => {
  const h = setup({
    canSubmit: false,
    outcome: 'error',
    error: 'The LangGraph request failed.',
  });
  expect(h.view.getByRole('alert').textContent).toBe(
    'The LangGraph request failed.'
  );
  expect(h.view.getByRole('status').textContent).toBe(
    'Start a new conversation to continue.'
  );
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledTimes(1);
});
it('unmount releases the application during a pending status read', () => {
  const h = setup({ busy: true, activity: 'checking', canSubmit: false });
  h.view.unmount();
  expect(h.application.dispose).toHaveBeenCalledTimes(1);
});
