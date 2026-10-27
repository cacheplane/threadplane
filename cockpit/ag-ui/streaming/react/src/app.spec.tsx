import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { StreamingSnapshot } from './application';
import { StreamingDemo } from './app';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);

it('renders actual native text rows literally without interpreting markup or manufacturing message history', () => {
  const text = '<img src=x onerror=alert(1)> **literal**';
  const h = setup({
    rows: [{ id: 'answer', role: 'assistant', content: text }],
  });
  expect(h.view.getByText(text)).toBeTruthy();
  expect(
    h.view.getByRole('region', { name: 'Conversation' }).querySelectorAll('li')
  ).toHaveLength(1);
  expect(h.view.container.querySelector('img')).toBeNull();
  expect(h.application.submit).not.toHaveBeenCalled();
});
function setup(
  update: Partial<StreamingSnapshot> = {},
  label: 'Shared runtime' | 'Developer runtime' = 'Shared runtime'
) {
  let state: StreamingSnapshot = {
    threadId: null,
    native: undefined,
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
    <StreamingDemo
      connection={{
        url: 'https://example.test/private-agent',
        label,
      }}
      onReady={onReady}
    />
  );
  return {
    view,
    application,
    onReady,
    update(next: Partial<StreamingSnapshot>) {
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
      h.view.getByRole('heading', { name: 'AG-UI streaming' })
    ).toBeTruthy();
    expect(
      h.view.getByRole('region', { name: 'Runtime connection' }).textContent
    ).toContain(label);
    expect(
      h.view.getByRole('region', { name: 'Conversation' }).querySelector('ol')
    ).toBeTruthy();
    expect(h.view.container.textContent).not.toContain(
      'fictional-secret-never-render'
    );
    expect(h.view.container.textContent).not.toContain('https://example.test');

    expect(h.application.submit).not.toHaveBeenCalled();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.view.getByRole('status').textContent).toBe('Ready.');
  }
);
it('uses the visible draft, declines a rejected admission, and preserves that draft', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  fireEvent.change(input, {
    target: { value: 'Fictional streaming question' },
  });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(h.application.submit).toHaveBeenCalledWith(
    'Fictional streaming question'
  );
  expect(input.value).toBe('Fictional streaming question');
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
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.application.stop).toHaveBeenCalledTimes(1);
  expect(h.application.submit).not.toHaveBeenCalled();
});
it('clears an admitted draft and resets a later draft when New changes the view generation', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  h.application.submit.mockImplementation(async () => {
    h.update({ busy: true, canSubmit: false, activity: 'running' });
  });
  fireEvent.change(input, { target: { value: 'Accepted fictional question' } });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
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
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledTimes(1);
  h.view.unmount();
  expect(h.application.dispose).toHaveBeenCalledTimes(1);
});
