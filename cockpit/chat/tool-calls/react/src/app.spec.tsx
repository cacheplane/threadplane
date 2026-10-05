import { act } from 'react';
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createConnectedApplication } from './connection';
import type { ToolCallsSnapshot } from './application';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { ToolCallsDemo, renderMessage } from './app';
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
  let state: ToolCallsSnapshot = {
    threadId: null,
    rows: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    observations: new Map(),
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ToolCallsSnapshot>, notify = true) => {
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
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => {
      update({
        busy: true,
        canSubmit: false,
        observations: new Map(),
        activity: 'replacing',
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app);
  const view = render(
    <ToolCallsDemo
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
it('seeds a read-only demo draft without creating or submitting a conversation', () => {
  const h = composition();
  fireEvent.click(h.view.getByRole('button', { name: 'Flight UA123' }));
  expect(h.box().value).toBe("What's the status of UA123?");
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.view.getByText(/demo data/i)).toBeTruthy();
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith(
    "What's the status of UA123?"
  );
  expect(h.box().value).toBe('');
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

it('renders observed argument and result text literally on the requesting row', () => {
  const content = createMessageContent();
  const row = content.project({
    status: 'idle',
    toolCalls: [],
    messages: [
      {
        id: 'call',
        role: 'assistant',
        content: '',
        toolCallIds: ['lookup'],
        delivery: { generation: 'call', phase: 'complete', outcome: 'success' },
      },
    ],
  })[0];
  try {
    const view = render(
      renderMessage(row, [
        {
          id: 'lookup',
          name: 'lookup_flight',
          argumentsText: '{"flight_number":"<b>UA123</b>"}',
          resultText: '<button>observed</button>',
        },
      ])
    );
    expect(
      view.getByRole('region', { name: 'Observed tool result' })
    ).toBeTruthy();
    expect(view.getByText('<button>observed</button>')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'observed' })).toBeNull();
    expect(view.getAllByRole('article')).toHaveLength(1);
  } finally {
    content.dispose();
  }
});
it('labels pending observed calls without claiming execution succeeded', () => {
  const content = createMessageContent();
  const row = content.project({
    status: 'running',
    toolCalls: [],
    messages: [
      {
        id: 'call',
        role: 'assistant',
        content: '',
        toolCallIds: ['lookup'],
        delivery: { generation: 'run', phase: 'streaming' },
      },
    ],
  })[0];
  try {
    const view = render(
      renderMessage(row, [
        { id: 'lookup', name: 'lookup_flight', argumentsText: '{}' },
      ])
    );
    expect(
      view.getByRole('region', { name: 'Observed tool call' })
    ).toBeTruthy();
    expect(view.queryByText('Result')).toBeNull();
  } finally {
    content.dispose();
  }
});
