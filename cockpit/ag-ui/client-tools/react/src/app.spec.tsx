import { createSession } from '@threadplane/ag-ui';
import type { RunAgentInput } from '@ag-ui/client';
import { createClientToolsApplication } from './application';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientToolsDemo } from './app';
import type { ClientToolsApplicationSnapshot } from './application';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./connection', () => ({ createConnectedApplication: mocks.create }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture(update: Partial<ClientToolsApplicationSnapshot> = {}) {
  let snapshot: ClientToolsApplicationSnapshot = Object.freeze({
    threadId: null,
    native: undefined,
    views: [],
    bookings: [],
    busy: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  });
  const listeners = new Set<() => void>();
  const app = {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit: vi.fn(),
    stop: vi.fn(),
    newConversation: vi.fn(),
    respond: vi.fn(),
    dispose: vi.fn(),
  };
  mocks.create.mockReturnValue(app);
  const ready = vi.fn();
  const result = render(
    <ClientToolsDemo
      connection={{ url: 'PRIVATE_ENDPOINT', label: 'Shared runtime' }}
      onReady={ready}
    />
  );
  return {
    app,
    ready,
    result,
    update(value: Partial<ClientToolsApplicationSnapshot>) {
      act(() => {
        snapshot = Object.freeze({ ...snapshot, ...value });
        for (const notify of listeners) notify();
      });
    },
  };
}
it('mount and readiness are inert and five presets only fill the draft', () => {
  const f = fixture();
  expect(f.ready).toHaveBeenCalledOnce();
  expect(f.app.submit).not.toHaveBeenCalled();
  expect(screen.queryByText('PRIVATE_ENDPOINT')).toBeNull();
  const presets = screen.getByRole('group', { name: 'Example prompts' });
  expect(presets.querySelectorAll('button')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Terminal snapshot' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toContain('snapshot');
  expect(f.app.submit).not.toHaveBeenCalled();
});
it('New clears draft and unmount revokes application lifetime', () => {
  const f = fixture();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'draft' },
  });
  f.update({ viewGeneration: 1 });
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toBe('');
  f.result.unmount();
  expect(f.app.dispose).toHaveBeenCalledOnce();
});
it('renders native text and observation literally and separate local evidence safely', () => {
  const text = '<img src=x onerror=alert(1)> **literal**';
  fixture({
    views: [
      {
        id: 'a',
        text: { id: 'a', role: 'assistant', content: text },
        tools: [
          {
            id: 'c',
            name: 'weather_snapshot',
            argumentsText: text,
            sourceRunId: 'r',
            weather: {
              location: text,
              conditions: text,
              temperatureF: 68,
              humidity: 55,
              windMph: 8,
            },
            local: {
              name: 'weather_snapshot',
              callId: 'c',
              assistantMessageId: 'a',
              sourceRunId: 'r',
              rawArguments: text,
              status: 'complete',
              delivery: 'unsent',
              provenance: 'local',
            },
          },
        ],
      },
    ],
  });
  expect(document.querySelector('img')).toBeNull();
  expect(
    document.querySelector('[data-native-call="c"]')?.textContent
  ).toContain('Local execution: complete');
  expect(screen.getByText('Delivery: unsent')).toBeTruthy();
  expect(screen.getByText('Simulated weather')).toBeTruthy();
});
it('pending fictional booking dispatches exact token only, resolved and aborted controls are frozen', () => {
  const booking = {
    ownerGeneration: 1,
    callId: 'c',
    assistantMessageId: 'a',
    sourceRunId: 'r',
    summary: 'Fictional table',
    token: 'owned',
    status: 'pending' as const,
  };
  const f = fixture({
    busy: true,
    canSubmit: false,
    bookings: [booking],
    views: [
      {
        id: 'a',
        tools: [
          {
            id: 'c',
            name: 'confirm_booking',
            argumentsText: '{"summary":"Fictional table"}',
            sourceRunId: 'r',
            local: {
              name: 'confirm_booking',
              callId: 'c',
              assistantMessageId: 'a',
              sourceRunId: 'r',
              rawArguments: '{}',
              status: 'running',
              delivery: 'unsent',
              provenance: 'local',
            },
          },
        ],
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(f.app.respond).toHaveBeenCalledWith('owned', true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
  expect(f.app.respond).toHaveBeenCalledWith('owned', false);
  f.update({ bookings: [{ ...booking, status: 'aborted' }] });
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(screen.getByText('Booking decision cancelled.')).toBeTruthy();
  f.update({
    bookings: [{ ...booking, status: 'resolved', confirmed: false }],
  });
  expect(
    screen.getByText('You cancelled this fictional booking.')
  ).toBeTruthy();
});
it('busy input exposes Stop and prevents New, while blocked idle asks for explicit New', () => {
  const f = fixture({ busy: true, canSubmit: false });
  expect(
    (
      screen.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.app.stop).toHaveBeenCalledOnce();
  f.update({
    busy: false,
    error: 'Start a new conversation.',
    outcome: 'interrupted',
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'Start a new conversation.'
  );
});

it('actual owned pending booking loses all authority on React unmount without native continuation (synthetic SDK seam)', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let body: RunAgentInput | undefined;
  const fetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as RunAgentInput;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            stream = value;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }
  );
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      return createSession(
        { threadId, url: 'http://synthetic.invalid/unmount', fetch },
        tools
      );
    },
  });
  mocks.create.mockReturnValue(app);
  const rendered = render(
    <ClientToolsDemo
      connection={{ url: 'PRIVATE_ENDPOINT', label: 'Developer runtime' }}
      onReady={() => undefined}
    />
  );
  expect(fetch).not.toHaveBeenCalled();
  let done = Promise.resolve();
  act(() => {
    done = app.submit('Fictional booking');
  });
  await waitFor(() => expect(body).toBeDefined());
  if (!body) throw new Error('Missing synthetic request');
  for (const event of [
    { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
    {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        ...body.messages,
        {
          id: 'unmount-assistant',
          role: 'assistant',
          toolCalls: [
            {
              id: 'unmount-call',
              type: 'function',
              function: {
                name: 'confirm_booking',
                arguments: '{"summary":"Fictional only"}',
              },
            },
          ],
        },
      ],
    },
    { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
  ])
    stream.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
    );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
  );
  const token = app.getSnapshot().bookings[0].token;
  rendered.unmount();
  await done;
  expect(app.respond(token, true)).toBe(false);
  expect(fetch).toHaveBeenCalledOnce();
});
