import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeploymentSnapshot } from './application';
import { DeploymentDemo } from './app';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
function setup(
  update: Partial<DeploymentSnapshot> = {},
  label: 'Shared runtime' | 'Developer runtime' = 'Shared runtime'
) {
  let state: DeploymentSnapshot = {
    threadId: null,
    rows: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const listeners = new Set<() => void>();
  const application = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockReturnValue(application);
  const onReady = vi.fn();
  const view = render(
    <DeploymentDemo
      connection={{
        apiUrl: 'https://example.test',
        headers: { 'x-api-key': 'fictional-secret-never-render' },
        label,
      }}
      onReady={onReady}
    />
  );
  return {
    view,
    application,
    onReady,
    update(next: Partial<DeploymentSnapshot>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
  };
}
it.each(['Shared runtime', 'Developer runtime'] as const)(
  'shows the %s label and native conversation without executing or exposing credentials',
  (label) => {
    const h = setup({}, label);
    expect(
      h.view.getByRole('heading', { name: 'LangGraph deployment runtime' })
    ).toBeTruthy();
    expect(
      h.view.getByRole('region', { name: 'Runtime connection' }).textContent
    ).toContain(label);
    expect(h.view.container.textContent).toContain('deployment-runtime');
    expect(h.view.container.textContent).not.toContain(
      'fictional-secret-never-render'
    );
    expect(h.view.container.textContent).not.toContain('https://example.test');
    expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
    expect(h.application.submit).not.toHaveBeenCalled();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.view.getByRole('status').textContent).toBe('Ready.');
  }
);
it('uses the visible draft, declines a rejected admission, and preserves that draft', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
    exact: true,
  }) as HTMLTextAreaElement;
  fireEvent.change(input, {
    target: { value: 'Fictional deployment question' },
  });
  fireEvent.click(h.view.getByRole('button', { name: 'Send', exact: true }));
  expect(h.application.submit).toHaveBeenCalledWith(
    'Fictional deployment question'
  );
  expect(input.value).toBe('Fictional deployment question');
});
it('blocks competing controls during execution and leaves Stop available', () => {
  const h = setup({ busy: true, activity: 'running', canSubmit: false });
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(h.view.getByRole('status').textContent).toBe('Receiving response…');
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  expect(h.application.stop).toHaveBeenCalledTimes(1);
  expect(h.application.submit).not.toHaveBeenCalled();
});
it('clears an admitted draft and resets a later draft when New changes the view generation', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
    exact: true,
  }) as HTMLTextAreaElement;
  h.application.submit.mockImplementation(async () => {
    h.update({ busy: true, canSubmit: false, activity: 'running' });
  });
  fireEvent.change(input, { target: { value: 'Accepted fictional question' } });
  fireEvent.click(h.view.getByRole('button', { name: 'Send', exact: true }));
  expect(input.value).toBe('');
  act(() =>
    h.update({
      busy: false,
      canSubmit: true,
      activity: 'idle',
      outcome: 'success',
    })
  );
  fireEvent.change(input, { target: { value: 'Unsent next draft' } });
  act(() => h.update({ viewGeneration: 1 }));
  expect(input.value).toBe('');
});
it('requires a new conversation after an uncertain outcome and releases the owner on unmount', () => {
  const h = setup({
    canSubmit: false,
    outcome: 'interrupted',
    error: 'The request outcome is uncertain.',
  });
  expect(h.view.getByRole('alert').textContent).toBe(
    'The request outcome is uncertain.'
  );
  expect(h.view.getByRole('status').textContent).toBe(
    'Start a new conversation to continue.'
  );
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledTimes(1);
  h.view.unmount();
  expect(h.application.dispose).toHaveBeenCalledTimes(1);
});
