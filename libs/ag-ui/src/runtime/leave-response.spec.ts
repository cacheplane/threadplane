import type { RunAgentInput } from '@ag-ui/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_MS } from './create-http-request';
import { createSession } from './create-session';

interface Exchange {
  readonly input: RunAgentInput;
  readonly signal: AbortSignal;
  /** How the response body ended: by the server, or cancelled by the client. */
  readonly body: { ended: boolean; cancelled: boolean };
  send(...events: unknown[]): void;
  end(): void;
}
/** A fetch whose responses stay open until the test ends them. */
function wire() {
  const exchanges: Exchange[] = [];
  const waiting = new Map<number, (exchange: Exchange) => void>();
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as RunAgentInput;
    const body = { ended: false, cancelled: false };
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        body.cancelled = true;
      },
    });
    const exchange: Exchange = {
      input,
      signal: init?.signal as AbortSignal,
      body,
      send: (...events) => {
        for (const event of events)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
          );
      },
      end: () => {
        body.ended = true;
        controller.close();
      },
    };
    exchanges.push(exchange);
    waiting.get(exchanges.length - 1)?.(exchange);
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    exchanges,
    next: (index: number) =>
      exchanges[index]
        ? Promise.resolve(exchanges[index])
        : new Promise<Exchange>((resolve) => waiting.set(index, resolve)),
  };
}
function owner(tools: boolean) {
  const transport = wire();
  const options = {
    threadId: 'thread',
    url: 'https://leave.invalid/run',
    fetch: transport.fetch,
  };
  const session = tools
    ? createSession(options, {
        noop: { description: 'Nothing', handler: () => ({ done: true }) },
      })
    : createSession(options);
  return { transport, session };
}
const started = (input: RunAgentInput) => ({
  type: 'RUN_STARTED',
  threadId: input.threadId,
  runId: input.runId,
});
const finished = (input: RunAgentInput) => ({
  type: 'RUN_FINISHED',
  threadId: input.threadId,
  runId: input.runId,
});
const text = (id: string, delta: string) => [
  { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta },
  { type: 'TEXT_MESSAGE_END', messageId: id },
];
/** Lets the reader and the session take what the stream holds. */
const drained = async () => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['without a handler map', false],
  ['with a handler map', true],
])('the response of a run that reached its terminal event, %s', (_l, tools) => {
  it('is never aborted when it ends by itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { transport, session } = owner(tools);
    try {
      const run = session.submit('Go');
      const exchange = await transport.next(0);
      exchange.send(started(exchange.input), ...text('a', 'Done'));
      exchange.send(finished(exchange.input));
      // The result does not wait for the response to end.
      expect(await run).toBe('success');
      expect(session.getSnapshot().status).toBe('idle');
      expect(exchange.signal.aborted).toBe(false);
      expect(exchange.body.cancelled).toBe(false);
      // The server ends the response, as servers do after their last event.
      exchange.end();
      await drained();
      vi.advanceTimersByTime(LEAVE_MS * 4);
      await drained();
      expect(exchange.signal.aborted).toBe(false);
      expect(exchange.body.cancelled).toBe(false);
      await session.dispose();
      expect(exchange.signal.aborted).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('settles at once and is closed after the bound when the server holds it open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { transport, session } = owner(tools);
    try {
      const run = session.submit('Go');
      const exchange = await transport.next(0);
      exchange.send(started(exchange.input), finished(exchange.input));
      expect(await run).toBe('success');
      expect(exchange.signal.aborted).toBe(false);
      // The held response does not hold the session: the next run starts.
      const again = session.submit('Again');
      const second = await transport.next(1);
      expect(exchange.signal.aborted).toBe(false);
      vi.advanceTimersByTime(LEAVE_MS - 1);
      expect(exchange.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(exchange.signal.aborted).toBe(true);
      // Closing the first response leaves the second run alone.
      expect(second.signal.aborted).toBe(false);
      second.send(started(second.input), finished(second.input));
      second.end();
      expect(await again).toBe('success');
    } finally {
      await session.dispose();
    }
  });

  it('delivers nothing that arrives after the terminal event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { transport, session } = owner(tools);
    const raw: string[] = [];
    session.onRawEvent?.((event) => raw.push(event.type));
    try {
      const run = session.submit('Go');
      const exchange = await transport.next(0);
      exchange.send(started(exchange.input), ...text('a', 'Done'));
      exchange.send(finished(exchange.input));
      expect(await run).toBe('success');
      const settled = session.getSnapshot();
      const seen = raw.length;
      exchange.send(
        ...text('late', 'Late'),
        { type: 'STATE_SNAPSHOT', snapshot: { late: true } },
        { type: 'RUN_ERROR', message: 'Late failure' }
      );
      await drained();
      vi.advanceTimersByTime(LEAVE_MS);
      await drained();
      expect(session.getSnapshot()).toBe(settled);
      expect(raw).toHaveLength(seen);
      expect(settled.messages.map((message) => message.content)).toEqual([
        'Go',
        'Done',
      ]);
    } finally {
      await session.dispose();
    }
  });

  it.each(['stop', 'dispose'] as const)(
    'is closed at once by %s',
    async (command) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { transport, session } = owner(tools);
      try {
        const run = session.submit('Go');
        const exchange = await transport.next(0);
        exchange.send(started(exchange.input), finished(exchange.input));
        expect(await run).toBe('success');
        expect(exchange.signal.aborted).toBe(false);
        await session[command]();
        expect(exchange.signal.aborted).toBe(true);
        // Nothing is left pending: the bound was cancelled with the response.
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        await session.dispose();
      }
    }
  );

  it('still aborts a run that is going, at once', async () => {
    const { transport, session } = owner(tools);
    try {
      const run = session.submit('Go');
      const exchange = await transport.next(0);
      exchange.send(started(exchange.input));
      await drained();
      await session.stop();
      expect(await run).toBe('aborted');
      expect(exchange.signal.aborted).toBe(true);
    } finally {
      await session.dispose();
    }
  });
});
