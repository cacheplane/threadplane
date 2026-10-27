import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  EventType,
  type BaseEvent,
  type Message,
  type MessagesSnapshotEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { createRun, type RunHandle } from './create-run';
import { reconcileTranscript } from './reconcile-transcript';
import { applyTextMessage, type TextMessageEvent } from './text-messages';
import { ownTranscript, requestMessages, type Transcript } from './transcript';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Text HTTP milestone timed out')),
          1500
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface Exchange {
  body: RunAgentInput;
  closed: Promise<void>;
  send: (...events: unknown[]) => void;
}

async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    response.on('close', () => closed.resolve());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange: Exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()),
      closed: closed.promise,
      send: (...events) => {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.resolve(exchange);
    // Held open: completion must physically cancel the response reader.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`,
    exchanges,
    next: (index = 0) => {
      if (exchanges[index]) return Promise.resolve(exchanges[index]);
      const arrival = arrivals.get(index) ?? deferred<Exchange>();
      arrivals.set(index, arrival);
      return bounded(arrival.promise);
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await bounded(closed);
    },
  };
}

function input(runId: string, messages: Message[]): RunAgentInput {
  return {
    threadId: 'thread',
    runId,
    messages,
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function lifecycle(
  exchange: Exchange,
  type: EventType.RUN_STARTED | EventType.RUN_FINISHED
) {
  return { type, threadId: exchange.body.threadId, runId: exchange.body.runId };
}

// Only the six normalized message events belong to this helper. Snapshot
// authority and lifecycle authority remain with their existing owners.
function project(previous: Transcript, event: BaseEvent): Transcript {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_START:
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_END:
    case EventType.REASONING_MESSAGE_START:
    case EventType.REASONING_MESSAGE_CONTENT:
    case EventType.REASONING_MESSAGE_END:
      return applyTextMessage(previous, event as TextMessageEvent);
    case EventType.MESSAGES_SNAPSHOT:
      return reconcileTranscript(
        previous,
        (event as MessagesSnapshotEvent).messages
      );
    default:
      return previous;
  }
}

describe('private text accumulation over actual HTTP', () => {
  it('observes both normalized CHUNK families and metadata-only continuations, reconciles and sends full owned egress', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    const user = {
      id: 'u',
      role: 'user',
      content: 'question',
    } satisfies Message;
    const seed = ownTranscript([user]);
    let transcript = seed;
    const events: BaseEvent[] = [];
    const observations: Transcript[] = [];
    const streamed = deferred<void>();
    let second: RunHandle | undefined;
    const first = factory.start(
      input('stream', requestMessages(seed)),
      (event) => {
        events.push(event);
        transcript = project(transcript, event);
        observations.push(transcript);
        if (
          event.type === EventType.REASONING_MESSAGE_CONTENT &&
          event.delta === ''
        )
          streamed.resolve();
      }
    );
    try {
      const exchange = await server.next();
      expect(exchange.body).toStrictEqual(input('stream', [user]));
      exchange.send(
        lifecycle(exchange, EventType.RUN_STARTED),
        {
          type: EventType.TEXT_MESSAGE_CHUNK,
          messageId: 'a',
          name: 'speaker',
          delta: 'Hello ',
          metadata: { keep: 'text', phase: { start: true } },
        },
        { type: EventType.TEXT_MESSAGE_CHUNK, delta: '🌍\n' },
        {
          type: EventType.TEXT_MESSAGE_CHUNK,
          metadata: { phase: { final: true }, usage: { tokens: 2 } },
        },
        {
          type: EventType.REASONING_MESSAGE_CHUNK,
          messageId: 'r',
          delta: '考える ',
          metadata: { keep: 'reasoning', phase: { start: true } },
        },
        { type: EventType.REASONING_MESSAGE_CHUNK, delta: '🧠\t' },
        {
          type: EventType.REASONING_MESSAGE_CHUNK,
          metadata: { phase: { final: true }, usage: { tokens: 3 } },
        }
      );
      await bounded(streamed.promise);
      const streamedRecords = [
        user,
        {
          id: 'a',
          role: 'assistant',
          name: 'speaker',
          content: 'Hello 🌍\n',
          metadata: {
            keep: 'text',
            phase: { final: true },
            usage: { tokens: 2 },
          },
        },
        {
          id: 'r',
          role: 'reasoning',
          content: '考える 🧠\t',
          metadata: {
            keep: 'reasoning',
            phase: { final: true },
            usage: { tokens: 3 },
          },
        },
      ] satisfies Message[];
      expect(transcript).toStrictEqual(streamedRecords);
      expect(transcript[0]).toBe(seed[0]);
      expect(observations[1][1].content).toBe('');
      expect(observations[2][1].content).toBe('Hello ');
      expect(observations[3][1].content).toBe('Hello 🌍\n');
      expect(observations[7][2].content).toBe('考える ');
      const beforeSnapshot = transcript;
      const corrected = {
        id: 'a',
        role: 'assistant',
        name: 'corrected',
        content: 'Authoritative answer',
        encryptedValue: 'opaque',
        metadata: { snapshot: ['only'] },
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'weather', arguments: '{  "city": "Paris" }\n' },
            encryptedValue: 'opaque-call',
            metadata: { preserve: true },
          },
        ],
      } satisfies Message;
      exchange.send(
        { type: EventType.MESSAGES_SNAPSHOT, messages: [user, corrected] },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      expect(await bounded(first.done)).toEqual({
        outcome: 'success',
        fetchInvoked: true,
      });
      await bounded(exchange.closed);
      expect(events.map((event) => event.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.MESSAGES_SNAPSHOT,
        EventType.RUN_FINISHED,
      ]);
      expect(events[4]).toMatchObject({
        type: EventType.TEXT_MESSAGE_CONTENT,
        delta: '',
        metadata: { usage: { tokens: 2 } },
      });
      expect(events[9]).toMatchObject({
        type: EventType.REASONING_MESSAGE_CONTENT,
        delta: '',
        metadata: { usage: { tokens: 3 } },
      });
      const expected = [user, corrected, streamedRecords[2]];
      expect(transcript).toStrictEqual(expected);
      expect(transcript[2]).toBe(beforeSnapshot[2]);
      expect(beforeSnapshot).toStrictEqual(streamedRecords);
      expect(seed).toStrictEqual([user]);
      expect(Object.isFrozen(transcript)).toBe(true);
      const assistant = transcript[1];
      if (assistant.role !== 'assistant') throw new Error('Expected assistant');
      expect(Object.isFrozen(assistant.toolCalls?.[0].function)).toBe(true);
      expect(Object.isFrozen(transcript[2].metadata?.usage)).toBe(true);
      second = factory.start(
        input('continue', requestMessages(transcript)),
        () => undefined
      );
      const continuation = await server.next(1);
      expect(continuation.body).toStrictEqual(input('continue', expected));
      continuation.send(
        lifecycle(continuation, EventType.RUN_STARTED),
        lifecycle(continuation, EventType.RUN_FINISHED)
      );
      expect(await bounded(second.done)).toEqual({
        outcome: 'success',
        fetchInvoked: true,
      });
      await bounded(continuation.closed);
      expect(server.exchanges).toHaveLength(2);
    } finally {
      first.abort();
      second?.abort();
      await server.close();
    }
  });

  it('fails in the helper after an admitted snapshot removes an open target and physically closes without a success override', async () => {
    const server = await serve();
    const user = {
      id: 'u',
      role: 'user',
      content: 'question',
    } satisfies Message;
    const seed = ownTranscript([user]);
    let transcript = seed;
    let latestValid: Transcript | undefined;
    let streamed: Transcript | undefined;
    let failure: unknown;
    const delivered: EventType[] = [];
    const handle = createRun({ url: server.url }).start(
      input('removed', requestMessages(seed)),
      (event) => {
        delivered.push(event.type);
        try {
          transcript = project(transcript, event);
        } catch (error) {
          failure = error;
          throw error;
        }
        if (event.type === EventType.TEXT_MESSAGE_CONTENT)
          streamed = transcript;
        if (event.type === EventType.MESSAGES_SNAPSHOT)
          latestValid = transcript;
      }
    );
    try {
      const exchange = await server.next();
      exchange.send(
        lifecycle(exchange, EventType.RUN_STARTED),
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'a',
          role: 'assistant',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'a',
          delta: 'before',
        },
        { type: EventType.MESSAGES_SNAPSHOT, messages: [user] },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'a',
          delta: 'after removal',
        },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      const result = await bounded(handle.done);
      expect(failure).toBeInstanceOf(TypeError);
      expect(result).toEqual({
        outcome: 'error',
        error: failure,
        fetchInvoked: true,
      });
      if (result.outcome === 'error') expect(result.error).toBe(failure);
      await bounded(exchange.closed);
      expect(delivered).toEqual([
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.MESSAGES_SNAPSHOT,
        EventType.TEXT_MESSAGE_CONTENT,
      ]);
      expect(streamed).toStrictEqual([
        user,
        { id: 'a', role: 'assistant', content: 'before' },
      ]);
      expect(transcript).toBe(latestValid);
      expect(transcript).toStrictEqual([user]);
      expect(seed).toStrictEqual([user]);
      expect(await handle.done).toBe(result);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
