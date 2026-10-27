import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MafDemo, EXPENSE_PRESET } from './app';
import type { MafSnapshot } from './application';
import { captureApproval, captureTurn } from './approval-policy';
import { expense, paused, running } from './fixtures.spec-helper';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function store(update: Partial<MafSnapshot> = {}) {
  let state: MafSnapshot = {
    generation: 7,
    threadId: null,
    busy: false,
    canSend: true,
    canRespond: false,
    rows: [],
    draft: undefined,
    approval: undefined,
    result: null,
    status: 'ready',
    error: null,
    ...update,
  };
  const listeners = new Set<() => void>();
  const app = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit: vi.fn<(text: string, generation: number) => Promise<void>>(
      async () => undefined
    ),
    decide: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => {
      state = {
        ...state,
        status: 'disposed',
        canSend: false,
        canRespond: false,
      };
      listeners.clear();
    }),
  };
  return {
    app,
    update(next: Partial<MafSnapshot>, notify = true) {
      state = { ...state, ...next };
      if (notify) listeners.forEach((listener) => listener());
    },
  };
}
function setup(update: Partial<MafSnapshot> = {}) {
  const h = store(update);
  factory.mockReturnValue(h.app);
  const onReady = vi.fn();
  const view = render(
    <MafDemo
      connection={{
        url: 'https://secret.test/agent',
        label: 'Developer runtime',
      }}
      onReady={onReady}
    />
  );
  return { ...h, view, onReady };
}
function approval() {
  const turn = captureTurn(running(), 'thread', undefined, []);
  if (!turn) throw Error('fixture turn');
  const value = captureApproval(paused(), turn);
  if (!value) throw Error('fixture approval');
  return value;
}
it('discloses fictional source-build preview and fills an editable inert dinner preset', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'Microsoft Agent Framework expenses' })
  ).toBeTruthy();
  expect(h.view.getByText(/No real expense/)).toBeTruthy();
  expect(h.view.container.textContent).toContain(
    'Source-build preview · Developer runtime'
  );
  expect(h.view.container.textContent).not.toMatch(/Private|secret.test/);
  fireEvent.click(h.view.getByRole('button', { name: 'Team dinner for 4' }));
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  expect(input.value).toBe(EXPENSE_PRESET);
  expect(input.value).toContain('Blue Finch Bistro');
  expect(input.value).toContain('This is a fictional demo expense.');
  expect(input.value).toContain('$220.00');
  expect(input.value).toContain(
    'Team dinner for 4 attendees; receipt attached.'
  );
  fireEvent.change(input, { target: { value: 'Edited dinner' } });
  expect(input.value).toBe('Edited dinner');
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.app.newConversation).not.toHaveBeenCalled();
});
it('passes the captured Send generation and keeps a rejected draft', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Unsent' } });
  h.update({ generation: 8 }, false);
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(h.app.submit).toHaveBeenCalledWith('Unsent', 7);
  expect(input.value).toBe('Unsent');
});
it('clears admitted input and exposes Stop and New while running', () => {
  const h = setup();
  h.app.submit.mockImplementation(async () => {
    h.update({ busy: true, canSend: false, status: 'running' });
  });
  fireEvent.change(h.view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Dinner' },
  });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(
    (h.view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toBe('');
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledTimes(1);
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).toHaveBeenCalledTimes(1);
});
it('separates predictive draft from canonical approval and captures original identity and generation', () => {
  const value = approval();
  const h = setup({
    approval: value,
    canRespond: true,
    canSend: false,
    status: 'pending',
    draft: { vendor: 'Predictive vendor' },
  });
  expect(
    h.view.getByRole('region', { name: 'Predictive expense draft' }).textContent
  ).toContain('Predictive vendor');
  const card = h.view.getByRole('region', { name: 'Expense approval' });
  for (const text of [
    expense.vendor,
    expense.category,
    '$220.00',
    expense.memo,
  ])
    expect(card.textContent).toContain(text);
  expect(card.textContent).not.toContain('Predictive vendor');
  h.update({ generation: 8, approval: undefined, canRespond: false }, false);
  fireEvent.click(h.view.getByRole('button', { name: 'Approve' }));
  expect(h.app.decide).toHaveBeenCalledWith(value, 'approve', 7);
});
it('disables competing decisions when application authority changes', () => {
  const value = approval();
  const h = setup({
    approval: value,
    canRespond: true,
    canSend: false,
    status: 'pending',
  });
  h.app.decide.mockImplementation(async () =>
    h.update({ busy: true, canRespond: false, status: 'running' })
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Decline' }));
  fireEvent.click(h.view.getByRole('button', { name: 'Approve' }));
  expect(h.app.decide).toHaveBeenCalledTimes(1);
  expect(h.app.decide).toHaveBeenCalledWith(value, 'decline', 7);
  expect(
    (h.view.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
it('projects only ordinary root text and renders literal tool result separately', () => {
  const result =
    'Expense recorded: $220.00 to Blue Finch Bistro (meals) — queued for reimbursement.';
  const h = setup({
    status: 'approved',
    result,
    rows: [
      { id: 'a', role: 'assistant', content: '<b>Assistant prose</b>' },
      { id: 'tool', role: 'tool', toolCallId: 'call', content: 'hidden tool' },
      {
        id: 'child',
        role: 'assistant',
        subagentRunId: 'child',
        content: 'hidden child',
      },
    ],
  });
  const transcript = h.view.getByRole('region', { name: 'Conversation' });
  expect(transcript.textContent).toContain('<b>Assistant prose</b>');
  expect(transcript.textContent).not.toMatch(/hidden|Expense recorded/);
  expect(h.view.container.querySelector('b')).toBeNull();
  expect(
    h.view
      .getByRole('region', { name: 'Observed backend result' })
      .querySelector('pre')?.textContent
  ).toBe(result);
  expect(h.view.getByRole('status').textContent).toBe(
    'Fictional expense approved.'
  );
});
it.each(['unconfirmed', 'replacing'] as const)(
  'renders truthful %s controls without success',
  (status) => {
    const h = setup({ status, canSend: false, busy: status === 'replacing' });
    expect(h.view.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      h.view.queryByRole('region', { name: 'Observed backend result' })
    ).toBeNull();
    expect(
      (h.view.getByRole('button', { name: 'Send' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(h.view.getByRole('status').textContent).toContain(
      status === 'unconfirmed'
        ? 'Start a new conversation'
        : 'Starting new conversation'
    );
  }
);
it('requires reload and disables New, Send, preset and decisions after cleanup failure', () => {
  const h = setup({
    status: 'pending',
    canSend: false,
    canRespond: true,
    approval: approval(),
  });
  const retainedDecision = h.view.getByRole('button', { name: 'Approve' });
  act(() =>
    h.update({
      status: 'cleanup-failed',
      canRespond: false,
      approval: undefined,
      error:
        'The conversation could not close safely. Reload the preview to continue.',
    })
  );
  expect(h.view.getByRole('status').textContent).toMatch(/Reload/);
  expect(h.view.getByRole('alert').textContent).toMatch(/Reload/);
  for (const name of ['New conversation', 'Send', 'Team dinner for 4']) {
    const button = h.view.getByRole('button', {
      name,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(
    (h.view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .disabled
  ).toBe(true);
  expect(h.view.queryByRole('button', { name: 'Approve' })).toBeNull();
  fireEvent.click(retainedDecision);
  expect(h.app.decide).not.toHaveBeenCalled();
  expect(h.app.newConversation).not.toHaveBeenCalled();
  expect(h.app.submit).not.toHaveBeenCalled();
});
it('clears stale card and draft on a new generation and disposes synchronously on unmount', () => {
  const h = setup({
    approval: approval(),
    canRespond: true,
    status: 'pending',
  });
  const old = h.view.getByRole('button', { name: 'Approve' });
  act(() =>
    h.update({
      generation: 8,
      approval: undefined,
      canRespond: false,
      status: 'ready',
    })
  );
  fireEvent.click(old);
  expect(h.app.decide).not.toHaveBeenCalled();
  h.view.unmount();
  expect(h.app.getSnapshot().status).toBe('disposed');
});
it('survives actual StrictMode rehearsal without implicit commands and releases each owner', () => {
  const stores: ReturnType<typeof store>[] = [];
  factory.mockImplementation(() => {
    const value = store();
    stores.push(value);
    return value.app;
  });
  const view = render(
    <StrictMode>
      <MafDemo
        connection={{ url: 'https://example.test', label: 'Shared runtime' }}
        onReady={() => undefined}
      />
    </StrictMode>
  );
  for (const h of stores) {
    expect(h.app.submit).not.toHaveBeenCalled();
    expect(h.app.newConversation).not.toHaveBeenCalled();
  }
  fireEvent.change(view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explicit send' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Send' }));
  expect(stores.filter((h) => h.app.submit.mock.calls.length)).toHaveLength(1);
  expect(
    stores.find((h) => h.app.submit.mock.calls.length)?.app.getSnapshot().status
  ).toBe('ready');
  view.unmount();
  for (const h of stores.filter((h) => h.app.subscribe))
    expect(h.app.getSnapshot().status).toBe('disposed');
});
