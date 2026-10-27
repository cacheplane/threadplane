import { afterEach, expect, it, vi } from 'vitest';
import { createElement, StrictMode } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createConnectedApplication } from './connection';
import { MafDemo } from './app';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('synchronously aborts actual native work on unmount and detached Send cannot retain authority', async () => {
  let signal: AbortSignal | null | undefined;
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    signal = init?.signal;
    const body = JSON.parse(String(init?.body));
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: 'RUN_STARTED',
                threadId: body.threadId,
                runId: body.runId,
              })}\n\n`
            )
          );
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(
    createElement(MafDemo, {
      connection: {
        url: 'https://stubbed.test/agent',
        label: 'Developer runtime',
      },
      onReady: () => undefined,
    })
  );
  fireEvent.change(view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explicit send' },
  });
  const send = view.getByRole('button', { name: 'Send' });
  fireEvent.click(send);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  fireEvent.click(send);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps the real native Session lazy through StrictMode rehearsal, preset editing and New, then allows explicit Send', async () => {
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(
    createElement(
      StrictMode,
      null,
      createElement(MafDemo, {
        connection: {
          url: 'https://stubbed.test/agent',
          label: 'Developer runtime',
        },
        onReady: () => undefined,
      })
    )
  );
  fireEvent.click(view.getByRole('button', { name: 'Team dinner for 4' }));
  fireEvent.change(view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Edited' },
  });
  fireEvent.click(view.getByRole('button', { name: 'New conversation' }));
  await waitFor(() =>
    expect(view.getByRole('status').textContent).toBe('Ready.')
  );
  expect(uuid).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explicit send' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(view.getByRole('status').textContent).toContain('unconfirmed')
  );
  view.unmount();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('executes the actual native Session with stubbed fetch and requires New after a non-approval terminal', async () => {
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        { type: 'TEXT_MESSAGE_START', messageId: 'answer', role: 'assistant' },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'answer',
          delta: 'This is assistant prose.',
        },
        { type: 'TEXT_MESSAGE_END', messageId: 'answer' },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  });
  vi.stubGlobal('fetch', fetch);
  const app = createConnectedApplication({
    url: 'https://stubbed.test/agent',
    label: 'Developer runtime',
  });
  expect(fetch).not.toHaveBeenCalled();
  await app.submit('File the fictional expense');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot()).toMatchObject({
    status: 'unconfirmed',
    canSend: false,
    canRespond: false,
    result: null,
  });
  expect(
    app
      .getSnapshot()
      .rows.some((row) => row.content === 'This is assistant prose.')
  ).toBe(true);
  await app.submit('Do not retry');
  expect(fetch).toHaveBeenCalledTimes(1);
  await app.newConversation();
  expect(app.getSnapshot()).toMatchObject({ status: 'ready', threadId: null });
  expect(fetch).toHaveBeenCalledTimes(1);
  await app.dispose();
});
