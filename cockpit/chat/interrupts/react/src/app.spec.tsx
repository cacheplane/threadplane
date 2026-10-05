import { act } from 'react';
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createConnectedApplication } from './connection';
import type { InterruptsSnapshot } from './application';
import type { PauseAuthority } from './authority';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { InterruptsDemo, renderMessage } from './app';
import { createMessageContent } from '@threadplane/content/messages';
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousActEnvironment: boolean | undefined;
beforeAll(() => {
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
const decision: PauseAuthority = {
  threadId: 'thread',
  checkpoint: 'checkpoint',
  signature: 'signature',
  batch: [],
  messages: [],
  tools: [],
  approval: {
    summary: '<button>untrusted</button>',
    flight: {
      flight_number: 'UA123',
      airline: 'UA',
      from: 'LAX',
      to: 'JFK',
      depart_local: '08:00',
      aircraft: 'Boeing 787',
    },
  },
};
it('renders text and Markdown without empty tool-call labels or raw tool results', () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    toolCalls: [],
    messages: [
      { id: 'u', role: 'user' as const, content: 'Book UA123.' },
      {
        id: 'calling',
        role: 'assistant' as const,
        content: '',
        toolCallIds: ['booking'],
      },
      {
        id: 'result',
        role: 'tool' as const,
        content: 'Private tool result',
        toolCallId: 'booking',
      },
      {
        id: 'answer',
        role: 'assistant' as const,
        content: '```text\nBooked\n```',
      },
    ].map((message) => ({
      ...message,
      delivery: {
        generation: message.id,
        phase: 'complete',
        outcome: 'success',
      },
    })),
  });
  try {
    const view = render(
      <>
        {rows.map((row) => (
          <div key={row.id}>{renderMessage(row)}</div>
        ))}
      </>
    );
    expect(view.getAllByRole('article')).toHaveLength(2);
    expect(view.container.querySelector('pre code')?.textContent).toBe(
      'Booked'
    );
    expect(view.queryByText('Private tool result')).toBeNull();
  } finally {
    content.dispose();
  }
});
function composition() {
  let state: InterruptsSnapshot = {
    threadId: null,
    rows: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    decision: null,
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InterruptsSnapshot>, notify = true) => {
    state = { ...state, ...patch };
    if (notify) for (const listener of listeners) listener();
  };
  const app = {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit: vi.fn<(text: string) => Promise<void>>(async () => {
      update({ busy: true, canSubmit: false, activity: 'running' });
    }),
    decide: vi.fn<
      (decision: PauseAuthority, value: 'confirm' | 'cancel') => Promise<void>
    >(async () => {
      update({
        busy: true,
        canSubmit: false,
        decision: null,
        activity: 'running',
      });
    }),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => {
      update({
        busy: true,
        canSubmit: false,
        decision: null,
        activity: 'replacing',
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app);
  const view = render(
    <InterruptsDemo
      connection={{ apiUrl: 'http://authored.invalid', headers: {} }}
      onReady={() => undefined}
    />
  );
  const box = () =>
    view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { app, update, view, box };
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('seeds a demo booking draft without creating or submitting a conversation', () => {
  const h = composition();
  fireEvent.click(h.view.getByRole('button', { name: 'Book UA123' }));
  expect(h.box().value).toBe('Book flight UA123.');
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.view.getByText(/demo data/i)).toBeTruthy();
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith('Book flight UA123.');
  expect(h.box().value).toBe('');
});
it.each(['Confirm', 'Cancel'] as const)(
  'renders literal approval details and captures only the fixed %s decision',
  (label) => {
    const h = composition();
    act(() => h.update({ canSubmit: false, outcome: 'paused', decision }));
    expect(h.view.getByText('<button>untrusted</button>')).toBeTruthy();
    expect(h.view.queryByRole('button', { name: 'untrusted' })).toBeNull();
    expect(h.view.getByText('Boeing 787')).toBeTruthy();
    expect(h.box().disabled).toBe(true);
    fireEvent.click(h.view.getByRole('button', { name: label }));
    expect(h.app.decide).toHaveBeenCalledExactlyOnceWith(
      decision,
      label.toLowerCase()
    );
    expect(h.view.queryByRole('button', { name: label })).toBeNull();
    expect(h.app.submit).not.toHaveBeenCalled();
  }
);
it('guards captured approval callbacks against a newer owner snapshot before React renders it', () => {
  const h = composition();
  act(() => h.update({ canSubmit: false, decision }));
  h.update({ decision: { ...decision, checkpoint: 'new-checkpoint' } }, false);
  fireEvent.click(h.view.getByRole('button', { name: 'Confirm' }));
  expect(h.app.decide).not.toHaveBeenCalled();
});
it('preserves the draft when the owner rejects submit and keeps Stop available during confirmation', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Keep me' } });
  h.update({ canSubmit: false }, false);
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.box().value).toBe('Keep me');
  expect(h.app.submit).not.toHaveBeenCalled();
  act(() => h.update({ busy: true, activity: 'confirming' }));
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledOnce();
});
it('clears the old draft on New and preserves newer typing through local cleanup', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Old draft' } });
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.box().value).toBe('');
  fireEvent.change(h.box(), { target: { value: 'Newer draft' } });
  act(() =>
    h.update({
      busy: false,
      canSubmit: true,
      activity: 'idle',
      viewGeneration: 1,
    })
  );
  expect(h.box().value).toBe('Newer draft');
  expect(h.app.newConversation).toHaveBeenCalledOnce();
});
