/* eslint-disable @typescript-eslint/no-non-null-assertion -- Canonical fixtures are asserted by the tests. */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrandsDemo, MEETING_PRESET } from './app';
import type { StrandsSnapshot } from './application';
import { captureApproval, captureTurn } from './approval-policy';
import { paused, running, literal } from './fixtures.spec-helper';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function store() {
  let snapshot: StrandsSnapshot = {
    generation: 4,
    threadId: null,
    busy: false,
    canSend: true,
    canRespond: false,
    rows: [],
    schedule: undefined,
    approval: undefined,
    result: null,
    status: 'ready',
    error: null,
  };
  const listeners = new Set<() => void>();
  const app = {
    getSnapshot: () => snapshot,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    submit: vi.fn<(text: string, generation: number) => Promise<void>>(
      async () => undefined
    ),
    decide: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => {
      snapshot = {
        ...snapshot,
        status: 'disposed',
        canSend: false,
        canRespond: false,
      };
      listeners.clear();
    }),
  };
  return {
    app,
    update: (s: Partial<StrandsSnapshot>) => {
      snapshot = { ...snapshot, ...s };
      listeners.forEach((f) => f());
    },
  };
}
function setup() {
  const h = store();
  factory.mockReturnValue(h.app);
  const view = render(
    <StrandsDemo
      connection={{ url: 'https://secret.test', label: 'Developer runtime' }}
      onReady={() => undefined}
    />
  );
  return { ...h, view };
}
it('offers an editable inert Q3 preset and captures Send generation', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'AWS Strands meetings' })
  ).toBeTruthy();
  expect(h.view.container.textContent).toContain('Experimental');
  expect(h.view.container.textContent).toContain('No real meeting');
  expect(h.view.container.textContent).not.toContain('secret.test');
  fireEvent.click(h.view.getByRole('button', { name: 'Q3 roadmap review' }));
  const input = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  expect(input.value).toBe(MEETING_PRESET);
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'Edited fictional meeting' } });
  fireEvent.click(h.view.getByRole('button', { name: 'Send' }));
  expect(h.app.submit).toHaveBeenCalledWith('Edited fictional meeting', 4);
  expect(input.value).toBe('Edited fictional meeting');
});
it('separates observed snapshot, canonical approval and decoded backend result', () => {
  const h = setup(),
    a = captureApproval(
      paused(),
      captureTurn(running(), 'thread', undefined, [])!
    )!;
  act(() =>
    h.update({
      status: 'pending',
      canSend: false,
      canRespond: true,
      approval: a,
      schedule: {
        booking: {
          topic: 'Different observed topic',
          slot: 'Friday',
          status: 'pending',
        },
      },
    })
  );
  expect(
    h.view.getByRole('region', { name: 'Last observed schedule' }).textContent
  ).toContain('Different observed topic');
  expect(
    h.view.getByRole('region', { name: 'Meeting approval' }).textContent
  ).toContain('Q3 roadmap review');
  expect(
    h.view.getByRole('region', { name: 'Meeting approval' }).textContent
  ).not.toContain('Different observed topic');
  fireEvent.click(h.view.getByRole('button', { name: 'Decline' }));
  expect(h.app.decide).toHaveBeenCalledWith(a, 'decline', 4);
  act(() =>
    h.update({
      status: 'approved',
      canSend: true,
      canRespond: false,
      approval: undefined,
      result: literal(true),
    })
  );
  expect(
    h.view
      .getByRole('region', { name: 'Observed backend result' })
      .querySelector('pre')?.textContent
  ).toBe(literal(true));
  expect(
    h.view.getByRole('region', { name: 'Last observed schedule' }).textContent
  ).toContain('pending');
  expect(h.view.queryByRole('button', { name: 'Approve' })).toBeNull();
});
it('clears old controls on New and disposes on unmount', () => {
  const h = setup();
  act(() => h.update({ busy: true, status: 'running', canSend: false }));
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledTimes(1);
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).toHaveBeenCalledTimes(1);
  h.view.unmount();
  expect(h.app.getSnapshot().status).toBe('disposed');
});
it('survives StrictMode rehearsal lazily and releases every owner', () => {
  const stores: ReturnType<typeof store>[] = [];
  factory.mockImplementation(() => {
    const h = store();
    stores.push(h);
    return h.app;
  });
  const view = render(
    <StrictMode>
      <StrandsDemo
        connection={{ url: 'https://example.test', label: 'Shared runtime' }}
        onReady={() => undefined}
      />
    </StrictMode>
  );
  for (const h of stores) expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explicit Send' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Send' }));
  expect(stores.filter((h) => h.app.submit.mock.calls.length)).toHaveLength(1);
  view.unmount();
  for (const h of stores) expect(h.app.getSnapshot().status).toBe('disposed');
});

it('cleanup failure requires reload and leaves Send, New and decision controls revoked', () => {
  const h = setup();
  act(() =>
    h.update({
      status: 'cleanup-failed',
      canSend: false,
      canRespond: false,
      error: 'Reload the preview to continue.',
    })
  );
  expect(h.view.getByRole('status').textContent).toMatch(/reload/i);
  expect(
    (h.view.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled
  ).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(h.view.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(h.view.queryByRole('button', { name: 'Decline' })).toBeNull();
  h.view.unmount();
  expect(h.app.dispose).toHaveBeenCalledTimes(1);
});
