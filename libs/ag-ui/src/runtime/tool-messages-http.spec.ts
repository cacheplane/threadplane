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
import { applyToolMessage, type ToolMessageEvent } from './tool-messages';
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
          () => reject(new Error('Tool HTTP milestone timed out')),
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

// SDK normalization and lifecycle remain createRun responsibilities; transcript
// authority is composed here only to exercise the private observation helpers.
function project(previous: Transcript, event: BaseEvent): Transcript {
  switch (event.type) {
    case EventType.TOOL_CALL_START:
    case EventType.TOOL_CALL_ARGS:
    case EventType.TOOL_CALL_END:
    case EventType.TOOL_CALL_RESULT:
      return applyToolMessage(previous, event as ToolMessageEvent);
    case EventType.TEXT_MESSAGE_START:
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_END:
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

describe('private tool observation over actual held HTTP', () => {
  it('normalizes raw tool chunks, orders results, reconciles snapshots and sends full request history', async () => {
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
          event.type === EventType.TOOL_CALL_RESULT &&
          event.messageId === 'r2'
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
          type: EventType.TOOL_CALL_CHUNK,
          toolCallId: 'c1',
          toolCallName: 'weather',
          parentMessageId: 'owner',
          delta: '{  "city":',
          metadata: { keep: true, phase: { start: true } },
        },
        { type: EventType.TOOL_CALL_CHUNK, delta: ' "Paris" }' },
        {
          type: EventType.TOOL_CALL_CHUNK,
          metadata: { phase: { final: true } },
        },
        {
          type: EventType.TOOL_CALL_CHUNK,
          toolCallId: 'c2',
          toolCallName: 'time',
          parentMessageId: 'owner',
          delta: 'not-json',
        },
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'text',
          role: 'assistant',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'text',
          delta: 'trailing text',
        },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text' },
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: 'r1',
          toolCallId: 'c1',
          content: 'raw result 1',
        },
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: 'r2',
          toolCallId: 'c2',
          content: 'raw result 2',
          metadata: { result: true },
        }
      );
      await bounded(streamed.promise);
      const owner = {
        id: 'owner',
        role: 'assistant',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'weather', arguments: '{  "city": "Paris" }' },
            metadata: { keep: true, phase: { final: true } },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'time', arguments: 'not-json' },
          },
        ],
      } satisfies Message;
      const streamedRecords = [
        user,
        owner,
        { id: 'r1', role: 'tool', toolCallId: 'c1', content: 'raw result 1' },
        {
          id: 'r2',
          role: 'tool',
          toolCallId: 'c2',
          content: 'raw result 2',
          metadata: { result: true },
        },
        { id: 'text', role: 'assistant', content: 'trailing text' },
      ] satisfies Message[];
      expect(transcript).toStrictEqual(streamedRecords);
      expect(observations[1][1]).toMatchObject({
        toolCalls: [{ function: { arguments: '' } }],
      });
      expect(observations[2][1]).toMatchObject({
        toolCalls: [{ function: { arguments: '{  "city":' } }],
      });
      expect(observations[4][1]).toMatchObject({
        toolCalls: [{ metadata: { keep: true, phase: { final: true } } }],
      });
      expect(events[4]).toMatchObject({
        type: EventType.TOOL_CALL_ARGS,
        delta: '',
        metadata: { phase: { final: true } },
      });
      const beforeSnapshot = transcript;
      const corrected = {
        ...owner,
        content: 'authoritative',
        encryptedValue: 'opaque',
        metadata: { snapshot: true },
        toolCalls: [
          {
            ...owner.toolCalls[0],
            function: { name: 'weather', arguments: 'corrected raw data' },
            encryptedValue: 'opaque-call',
          },
          owner.toolCalls[1],
        ],
      } satisfies Message;
      exchange.send(
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [user, corrected, ...streamedRecords.slice(2)],
        },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      expect(await bounded(first.done)).toEqual({ outcome: 'success' });
      await bounded(exchange.closed);
      expect(events.map((event) => event.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.TOOL_CALL_RESULT,
        EventType.TOOL_CALL_RESULT,
        EventType.MESSAGES_SNAPSHOT,
        EventType.RUN_FINISHED,
      ]);
      const expected = [user, corrected, ...streamedRecords.slice(2)];
      expect(transcript).toStrictEqual(expected);
      expect(beforeSnapshot).toStrictEqual(streamedRecords);
      expect(seed).toStrictEqual([user]);
      expect(Object.isFrozen(transcript[1])).toBe(true);
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
      expect(await bounded(second.done)).toEqual({ outcome: 'success' });
      await bounded(continuation.closed);
    } finally {
      first.abort();
      second?.abort();
      await server.close();
    }
  });

  it('replays START, END and RESULT into owned history in a fresh run without losing arguments or duplicating IDs', async () => {
    const server = await serve();
    const seed = ownTranscript([
      {
        id: 'owner',
        role: 'assistant',
        toolCalls: [
          {
            id: 'c',
            type: 'function',
            function: { name: 'weather', arguments: 'retained partial {' },
          },
        ],
      },
      { id: 'r', role: 'tool', toolCallId: 'c', content: 'retained result' },
    ]);
    let transcript = seed;
    const handle = createRun({ url: server.url }).start(
      input('replay', requestMessages(seed)),
      (event) => {
        transcript = project(transcript, event);
      }
    );
    try {
      const exchange = await server.next();
      exchange.send(
        lifecycle(exchange, EventType.RUN_STARTED),
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'c',
          toolCallName: 'weather',
          parentMessageId: 'owner',
        },
        { type: EventType.TOOL_CALL_END, toolCallId: 'c' },
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: 'r',
          toolCallId: 'c',
          content: 'retained result',
        },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      expect(await bounded(handle.done)).toEqual({ outcome: 'success' });
      await bounded(exchange.closed);
      expect(transcript).toBe(seed);
      expect(transcript.map((message) => message.id)).toEqual(['owner', 'r']);
    } finally {
      handle.abort();
      await server.close();
    }
  });

  it.each(['nonassistant parent', 'changed name'])(
    'preserves callback failure and physically closes for an admitted %s START',
    async (failureCase) => {
      const server = await serve();
      const seed = ownTranscript(
        failureCase === 'nonassistant parent'
          ? [{ id: 'owner', role: 'user', content: 'keep' }]
          : [
              {
                id: 'owner',
                role: 'assistant',
                toolCalls: [
                  {
                    id: 'c',
                    type: 'function',
                    function: { name: 'original', arguments: 'keep' },
                  },
                ],
              },
            ]
      );
      let transcript = seed;
      let failure: unknown;
      const delivered: EventType[] = [];
      const handle = createRun({ url: server.url }).start(
        input('failure', requestMessages(seed)),
        (event) => {
          delivered.push(event.type);
          try {
            transcript = project(transcript, event);
          } catch (error) {
            failure = error;
            throw error;
          }
        }
      );
      try {
        const exchange = await server.next();
        exchange.send(
          lifecycle(exchange, EventType.RUN_STARTED),
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: 'c',
            toolCallName: 'changed',
            parentMessageId: 'owner',
          },
          { type: EventType.TOOL_CALL_END, toolCallId: 'c' },
          lifecycle(exchange, EventType.RUN_FINISHED)
        );
        const outcome = await bounded(handle.done);
        expect(failure).toBeInstanceOf(TypeError);
        expect(outcome).toEqual({ outcome: 'error', error: failure });
        if (outcome.outcome === 'error') expect(outcome.error).toBe(failure);
        await bounded(exchange.closed);
        expect(delivered).toEqual([
          EventType.RUN_STARTED,
          EventType.TOOL_CALL_START,
        ]);
        expect(transcript).toBe(seed);
        expect(await handle.done).toBe(outcome);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );
});
