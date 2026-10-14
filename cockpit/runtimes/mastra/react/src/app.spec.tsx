import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MastraSnapshot } from './application';
import type { ReservationApproval } from './approval-policy';
import { MastraDemo } from './app';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const approval: ReservationApproval = {
  threadId: 'thread',
  sourceRunId: 'source',
  pause: 'opaque' as ReservationApproval['pause'],
  interruptId: 'interrupt',
  toolCallId: 'call',
  site: '<b>North Pines</b>',
  nights: 2,
  total: 90,
  transcript: [],
};
// Presentation units use a store double. C1 separately verifies real admission and ownership.
function setup(update: Partial<MastraSnapshot> = {}) {
  let state: MastraSnapshot = {
    threadId: null,
    native: undefined,
    rows: [],
    activity: 'idle',
    busy: false,
    approval: undefined,
    canRespond: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 7,
    requiresNew: false,
    reservation: 'none',
    result: null,
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
    decide: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockReturnValue(application);
  const onReady = vi.fn();
  const view = render(
    <MastraDemo
      connection={{
        url: 'https://private.test/secret-agent',
        label: 'Developer runtime',
      }}
      onReady={onReady}
    />
  );
  return {
    view,
    application,
    onReady,
    replaceWithoutNotification(next: Partial<MastraSnapshot>) {
      state = { ...state, ...next };
    },
    update(next: Partial<MastraSnapshot>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
  };
}
it('starts empty, discloses fictional private preview, and keeps the reservation preset inert', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'Mastra reservations' })
  ).toBeTruthy();
  expect(h.view.getByText(/No real reservation/)).toBeTruthy();
  expect(h.view.container.textContent).toContain(
    'Private source-build preview'
  );
  expect(h.view.container.textContent).not.toContain('https://private.test');
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  fireEvent.click(h.view.getByRole('button', { name: 'Reserve the campsite' }));
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  expect(input.value).toBe(
    'Please reserve the North Pines campsite for 2 nights.'
  );
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(h.application.newConversation).not.toHaveBeenCalled();
  expect(h.onReady).toHaveBeenCalledTimes(1);
});
it('renders only actual ordinary text rows literally', () => {
  const h = setup({
    rows: [{ id: 'a', role: 'assistant', content: '<img> **literal**' }],
  });
  expect(h.view.getByText('<img> **literal**')).toBeTruthy();
  expect(h.view.container.querySelector('img')).toBeNull();
  expect(
    h.view.getByRole('region', { name: 'Conversation' }).querySelectorAll('li')
  ).toHaveLength(1);
});
it('passes the rendered generation with Send and retains an unadmitted draft', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Reserve fictional campsite' } });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(h.application.submit).toHaveBeenCalledWith(
    'Reserve fictional campsite',
    7
  );
  expect(input.value).toBe('Reserve fictional campsite');
});
it('clears an admitted draft and lets New revoke active work while Stop remains available', () => {
  const h = setup();
  h.application.submit.mockImplementation(async () => {
    h.update({ busy: true, canSubmit: false, activity: 'running' });
  });
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Reserve' } });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(input.value).toBe('');
  expect(h.view.getByRole('status').textContent).toBe(
    'Working on the reservation…'
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.application.stop).toHaveBeenCalledTimes(1);
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledTimes(1);
  act(() => h.update({ viewGeneration: 8, activity: 'replacing' }));
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});
it('shows exact native details with explicit Approve and Decline and captures identity plus generation', () => {
  const h = setup({
    approval,
    reservation: 'pending',
    canRespond: true,
    canSubmit: false,
  });
  expect(
    h.view.getByRole('region', { name: 'Reservation approval' })
  ).toBeTruthy();
  expect(h.view.getByText(approval.site)).toBeTruthy();
  expect(h.view.getByText('2')).toBeTruthy();
  expect(h.view.getByText('$90.00')).toBeTruthy();
  expect(h.view.container.querySelector('b')).toBeNull();
  expect(h.view.queryByRole('button', { name: /cancel/i })).toBeNull();
  expect(h.view.getByRole('status').textContent).toBe(
    'Awaiting your decision.'
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Decline' }));
  expect(h.application.decide).toHaveBeenCalledWith(approval, 'decline', 7);
});
it('lets application admission win synchronously and disables competing decisions on publication', () => {
  const h = setup({
    approval,
    canRespond: true,
    canSubmit: false,
    reservation: 'pending',
  });
  h.application.decide.mockImplementation(async () => {
    h.update({ busy: true, canRespond: false, activity: 'running' });
  });
  fireEvent.click(h.view.getByRole('button', { name: 'Approve' }));
  fireEvent.click(h.view.getByRole('button', { name: 'Decline' }));
  expect(h.application.decide).toHaveBeenCalledTimes(1);
  expect(h.application.decide).toHaveBeenCalledWith(approval, 'approve', 7);
  expect(
    (h.view.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'Reserve the campsite',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});
it('revokes old card nodes and clears the draft on a new generation', () => {
  const h = setup({ approval, canRespond: true, canSubmit: false });
  const old = h.view.getByRole('button', { name: 'Approve' });
  act(() =>
    h.update({
      approval: undefined,
      canRespond: false,
      canSubmit: true,
      viewGeneration: 8,
    })
  );
  fireEvent.click(old);
  expect(h.application.decide).not.toHaveBeenCalled();
  expect(
    h.view.queryByRole('region', { name: 'Reservation approval' })
  ).toBeNull();
});
it.each(['approved', 'declined'] as const)(
  'shows confirmed %s separately from literal observed backend result',
  (reservation) => {
    const result = JSON.stringify('Exact backend <result>');
    const h = setup({ reservation, result, outcome: 'success' });
    expect(
      h.view.getByRole('region', { name: 'Observed backend result' })
        .textContent
    ).toContain(result);
    expect(h.view.getByRole('status').textContent).toBe(
      reservation === 'approved'
        ? 'Fictional reservation approved.'
        : 'Reservation declined. Nothing was booked.'
    );
    expect(
      h.view
        .getByRole('region', { name: 'Conversation' })
        .querySelectorAll('li')
    ).toHaveLength(0);
  }
);
it.each([
  null,
  'The reservation outcome could not be confirmed. Start a new conversation.',
])(
  'requires New for an uncertain or malformed pause without inventing controls: %s',
  (error) => {
    const h = setup({
      canSubmit: false,
      requiresNew: true,
      reservation: 'unconfirmed',
      outcome: 'error',
      error,
    });
    expect(h.view.getByRole('status').textContent).toBe(
      'Reservation unconfirmed. Start a new conversation.'
    );
    expect(h.view.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      h.view.queryByRole('region', { name: 'Observed backend result' })
    ).toBeNull();
    if (error) expect(h.view.getByRole('alert').textContent).toBe(error);
    expect(
      (h.view.getByRole('button', { name: 'Send' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  }
);
it('owns a stable store and handles asynchronous unmount cleanup rejection', async () => {
  const h = setup();
  act(() => h.update({ outcome: 'success' }));
  expect(factory).toHaveBeenCalledTimes(1);
  h.application.dispose.mockRejectedValue(new Error('cleanup failed'));
  h.view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(h.application.dispose).toHaveBeenCalledTimes(1);
});

it('passes the old render generation when the store changes before a Send callback runs', () => {
  const h = setup();
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Unsent draft' } });
  h.replaceWithoutNotification({ viewGeneration: 8 });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(h.application.submit).toHaveBeenCalledWith('Unsent draft', 7);
  expect(input.value).toBe('Unsent draft');
});
it('captures the rendered approval identity and generation even before a replacement is rendered', () => {
  const h = setup({ approval, canRespond: true, canSubmit: false });
  h.replaceWithoutNotification({
    approval: undefined,
    canRespond: false,
    viewGeneration: 8,
  });
  fireEvent.click(h.view.getByRole('button', { name: 'Approve' }));
  expect(h.application.decide).toHaveBeenCalledWith(approval, 'approve', 7);
  // C1 rejects this stale captured generation; this unit checks the authored callback binding.
});
it('describes a completed transport without claiming a reservation was approved', () => {
  const h = setup({ outcome: 'success', reservation: 'none' });
  expect(h.view.getByRole('status').textContent).toBe('Request complete.');
  expect(
    h.view.queryByRole('region', { name: 'Observed backend result' })
  ).toBeNull();
});
