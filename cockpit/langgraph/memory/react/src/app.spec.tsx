import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import { createMemoryApplication, type MemorySession } from './application';
import { MemoryDemo } from './app';

const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
beforeEach(() => factory.mockReset());
function setup() {
  let finish!: (outcome: CompleteOutcome) => void;
  const result = new Promise<CompleteOutcome>((resolve) => {
    finish = resolve;
  });
  let state: ReturnType<MemorySession['getSnapshot']> = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
  };
  const observers = new Set<() => void>();
  const session: MemorySession = {
    getSnapshot: () => state,
    subscribe: (notify) => {
      observers.add(notify);
      return () => {
        observers.delete(notify);
      };
    },
    submit: vi.fn(() => result),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockImplementation(() =>
    createMemoryApplication({
      createThread: async () => 'confirmed',
      sessionFactory: () => session,
    })
  );
  const ready = vi.fn();
  const view = render(
    <MemoryDemo
      connection={{ apiUrl: 'https://example.test', headers: {} }}
      onReady={ready}
    />
  );
  async function send() {
    fireEvent.change(
      view.getByRole('textbox', { name: 'Message', exact: true }),
      { target: { value: 'Remember Mira' } }
    );
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(session.submit).toHaveBeenCalledTimes(1));
  }
  async function replace(update: Partial<typeof state>) {
    await act(async () => {
      state = { ...state, ...update };
      for (const notify of observers) notify();
    });
  }
  async function complete(outcome: CompleteOutcome = 'success') {
    await act(async () => finish(outcome));
  }
  return { view, session, ready, send, replace, complete };
}

it('presents native chat and an initially empty thread-scoped facts panel', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'LangGraph memory' })
  ).toBeTruthy();
  expect(
    h.view.getByRole('region', { name: 'Learned facts' }).textContent
  ).toMatch(/No facts yet/);
  expect(
    h.view.getByRole('textbox', { name: 'Message', exact: true })
  ).toBeTruthy();
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(h.ready).toHaveBeenCalledTimes(1);
});

it('shows the reply while extraction is pending, then literal facts without HTML injection', async () => {
  const h = setup();
  await h.send();
  await h.replace({
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        content: 'Hello Mira',
        delivery: { generation: 'run', phase: 'streaming' },
      },
    ],
  });
  expect(h.view.getByText('Hello Mira')).toBeTruthy();
  expect(h.view.getByText('No facts yet.')).toBeTruthy();
  await h.replace({
    values: {
      memory: JSON.parse(
        '{"__proto__":"literal","a.b":"<script>tea</script>"}'
      ),
    },
  });
  expect(h.view.getByText('__proto__')).toBeTruthy();
  expect(h.view.getByText('a.b')).toBeTruthy();
  expect(h.view.getByText('<script>tea</script>')).toBeTruthy();
  expect(h.view.container.querySelector('script')).toBeNull();
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await h.complete();
  expect(h.view.getByRole('status').textContent).toBe('Response complete.');
});

it('Stop prevents another message and offers a new conversation', async () => {
  const h = setup();
  await h.send();
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  expect(h.session.stop).toHaveBeenCalledTimes(1);
  expect(h.view.getByRole('status').textContent).toMatch(
    /Stopped.*new conversation/i
  );
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
});

it.each(['error', 'paused'] as const)(
  'requires replacement after %s',
  async (outcome) => {
    const h = setup();
    await h.send();
    await h.complete(outcome);
    expect(h.view.getByRole('status').textContent).toMatch(/new conversation/i);
    expect(
      (
        h.view.getByRole('textbox', {
          name: 'Message',
          exact: true,
        }) as HTMLTextAreaElement
      ).disabled
    ).toBe(true);
    if (outcome === 'error')
      expect(h.view.getByRole('alert').textContent).toMatch(/failed/);
  }
);

it('reset releases the old owner and clears both transcript and facts', async () => {
  const h = setup();
  await h.send();
  await h.replace({
    values: { memory: { name: 'Mira' } },
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        content: 'Hello Mira',
        delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
      },
    ],
  });
  await h.complete();
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.view.queryByText('Hello Mira')).toBeNull();
  expect(h.view.getByText('No facts yet.')).toBeTruthy();
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
});

it('does not construct a replacement after unmount during reset', async () => {
  const h = setup();
  await h.send();
  await h.complete();
  let release!: () => void;
  vi.mocked(h.session.dispose).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  await act(async () => undefined);
  h.view.unmount();
  await act(async () => release());
  expect(factory).toHaveBeenCalledTimes(1);
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});
