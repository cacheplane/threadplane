import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import {
  createPersistenceApplication,
  type PersistenceSession,
} from './application';
import { PersistenceDemo } from './app';

const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
beforeEach(() => factory.mockReset());
function setup() {
  let thread = 0;
  const sessions: ReturnType<typeof createFake>[] = [];
  function createFake(id: string) {
    let state: ReturnType<PersistenceSession['getSnapshot']> = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    };
    const observers = new Set<() => void>();
    let finish!: (outcome: CompleteOutcome) => void, loaded!: () => void;
    const run = new Promise<CompleteOutcome>((resolve) => {
      finish = resolve;
    });
    const history = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const session: PersistenceSession = {
      getSnapshot: () => state,
      subscribe: (notify) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
        };
      },
      submit: vi.fn(() => run),
      load: vi.fn(() => history),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function text(content: string) {
      state = {
        ...state,
        messages: [
          {
            id: 'reply-' + id,
            role: 'assistant',
            content,
            delivery: {
              generation: 'run',
              phase: 'complete',
              outcome: 'success',
            },
          },
        ],
      };
      for (const observer of observers) observer();
    }
    return { id, session, finish, loaded, text };
  }
  factory.mockImplementation(() =>
    createPersistenceApplication({
      createThread: async () => 'thread-' + ++thread,
      sessionFactory: (id) => {
        const current = createFake(id);
        sessions.push(current);
        return current.session;
      },
    })
  );
  const ready = vi.fn();
  const view = render(
    <PersistenceDemo
      connection={{ apiUrl: 'https://example.test', headers: {} }}
      onReady={ready}
    />
  );
  async function send(content: string) {
    fireEvent.change(
      view.getByRole('textbox', { name: 'Message', exact: true }),
      { target: { value: content } }
    );
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() =>
      expect(sessions.at(-1)?.session.submit).toHaveBeenCalledTimes(1)
    );
    return sessions.at(-1)!;
  }
  async function complete(
    content: string,
    outcome: CompleteOutcome = 'success'
  ) {
    const current = sessions.at(-1)!;
    await act(async () => {
      current.text(content);
      current.finish(outcome);
    });
  }
  async function two() {
    await send('Avery');
    await complete('Avery likes teal');
    fireEvent.click(view.getByRole('button', { name: 'New conversation' }));
    await waitFor(() =>
      expect(view.getByRole('status').textContent).toBe('Ready.')
    );
    await send('Blair');
    await complete('Blair likes violet');
  }
  return { view, ready, sessions, send, complete, two };
}

it('presents a page-local picker and native chat without creating a conversation', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'LangGraph persistence' })
  ).toBeTruthy();
  expect(
    h.view.getByRole('region', { name: 'Saved conversations' }).textContent
  ).toContain('No saved conversations yet.');
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  expect(h.sessions).toHaveLength(0);
  expect(h.ready).toHaveBeenCalledTimes(1);
});
it('clears cached rows and blocks all controls until authoritative history finishes', async () => {
  const h = setup();
  await h.two();
  fireEvent.click(
    h.view.getByRole('button', { name: 'Conversation 1', exact: true })
  );
  await waitFor(() => expect(h.sessions).toHaveLength(3));
  expect(h.view.queryByText('Avery likes teal')).toBeNull();
  expect(h.view.queryByText('Blair likes violet')).toBeNull();
  expect(h.view.getByRole('status').textContent).toBe(
    'Loading saved conversation…'
  );
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'Conversation 2',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => {
    h.sessions[2].text('New server transcript');
    h.sessions[2].loaded();
  });
  expect(h.view.getByText('New server transcript')).toBeTruthy();
  expect(
    h.view
      .getByRole('button', { name: 'Conversation 1', exact: true })
      .getAttribute('aria-pressed')
  ).toBe('true');
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  expect(h.sessions[2].session.submit).not.toHaveBeenCalled();
});
it('new conversation retains the picker and clears the transcript and composer', async () => {
  const h = setup();
  await h.send('Avery');
  await h.complete('Avery likes teal');
  fireEvent.change(
    h.view.getByRole('textbox', { name: 'Message', exact: true }),
    { target: { value: 'Draft text' } }
  );
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  await waitFor(() =>
    expect(h.view.getByRole('status').textContent).toBe('Ready.')
  );
  expect(h.view.queryByText('Avery likes teal')).toBeNull();
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).value
  ).toBe('');
  expect(
    h.view.getByRole('button', { name: 'Conversation 1', exact: true })
  ).toBeTruthy();
  expect(h.sessions).toHaveLength(1);
});
it('Stop quarantines a saved conversation and a fulfilled late read cannot restore the UI', async () => {
  const h = setup();
  await h.two();
  fireEvent.click(
    h.view.getByRole('button', { name: 'Conversation 1', exact: true })
  );
  await waitFor(() => expect(h.sessions).toHaveLength(3));
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  await act(async () => {
    h.sessions[2].text('Late history');
    h.sessions[2].loaded();
  });
  expect(h.view.queryByText('Late history')).toBeNull();
  expect(h.view.getByRole('status').textContent).toMatch(
    /Stopped.*new conversation/
  );
  expect(
    (
      h.view.getByRole('button', {
        name: 'Conversation 1 — unavailable',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'Conversation 2',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
});
it('shows protected failures and requires a new conversation', async () => {
  const h = setup();
  await h.send('Avery');
  await h.complete('Failed', 'error');
  expect(h.view.getByRole('alert').textContent).toBe(
    'The LangGraph request failed.'
  );
  expect(h.view.getByRole('status').textContent).toMatch(/new conversation/);
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
});
it('unmount during a pending read releases the owner and never creates another session', async () => {
  const h = setup();
  await h.two();
  fireEvent.click(
    h.view.getByRole('button', { name: 'Conversation 1', exact: true })
  );
  await waitFor(() => expect(h.sessions).toHaveLength(3));
  h.view.unmount();
  await act(async () => h.sessions[2].loaded());
  expect(h.sessions[2].session.dispose).toHaveBeenCalledTimes(1);
  expect(h.sessions).toHaveLength(3);
});
