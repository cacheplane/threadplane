import { ok } from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  EventType,
  type Message,
  type MessagesSnapshotEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { createRun, type RunHandle } from './create-run';
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
          () => reject(new Error('Transcript HTTP milestone timed out')),
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
    // Deliberately hold the stream open. The run owner must physically close it.
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

function input(runId: string, messages: Message[] = []): RunAgentInput {
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

const snapshotMessages = [
  {
    id: 'system',
    role: 'system',
    content: 'policy',
    name: 'system-name',
    metadata: { keep: ['system'] },
  },
  {
    id: 'developer',
    role: 'developer',
    content: 'developer policy',
    subagentRunId: '',
    encryptedValue: 'developer-encrypted',
  },
  {
    id: 'user',
    role: 'user',
    content: [
      { type: 'text', text: 'inspect' },
      {
        type: 'image',
        source: { type: 'data', value: 'aW1hZ2U=', mimeType: 'image/png' },
        metadata: { nested: [{ label: 'image', nullable: null }] },
      },
      {
        type: 'audio',
        source: {
          type: 'url',
          value: 'https://example.test/audio',
          mimeType: 'audio/wav',
        },
      },
      {
        type: 'video',
        source: { type: 'data', value: 'dmlkZW8=', mimeType: 'video/mp4' },
      },
      {
        type: 'document',
        source: { type: 'url', value: 'https://example.test/document' },
      },
      {
        type: 'binary',
        mimeType: 'application/octet-stream',
        data: 'YmluYXJ5',
        id: 'binary',
        filename: 'legacy.bin',
      },
    ],
  },
  {
    id: 'assistant',
    role: 'assistant',
    name: 'assistant-name',
    encryptedValue: 'message-encrypted',
    subagentRunId: 'child',
    metadata: { nested: [{ keep: 'message', nullable: null }] },
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'weather', arguments: '{  "city": "Paris" }' },
        encryptedValue: 'call-encrypted',
        metadata: { nested: ['call', null] },
      },
    ],
  },
  {
    id: 'tool',
    role: 'tool',
    toolCallId: 'call',
    content: 'result',
    error: 'provider error',
    encryptedValue: 'tool-encrypted',
    metadata: { nested: { keep: true } },
  },
  {
    id: 'reasoning',
    role: 'reasoning',
    content: 'private reasoning',
    encryptedValue: 'reasoning-encrypted',
    metadata: { nested: ['reasoning'] },
  },
  {
    id: 'activity',
    role: 'activity',
    activityType: 'progress',
    content: { steps: [{ label: 'working' }] },
    metadata: { keep: 'activity' },
  },
] satisfies Message[];

describe('private transcript actual HTTP egress', () => {
  it('captures a normalized rich snapshot and sends its complete allowed data in a second operation', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    let observed: Message[] | undefined;
    let captured: Transcript | undefined;
    let second: RunHandle | undefined;
    const first = factory.start(input('capture'), (event) => {
      if (event.type !== EventType.MESSAGES_SNAPSHOT) return;
      observed = (event as MessagesSnapshotEvent).messages;
      captured = ownTranscript(observed);
    });
    const firstDone = first.done;
    try {
      const initial = await server.next();
      // Top-level message extensions are stripped by the SDK event parser;
      // record metadata remains observed protocol data. Do not invent lost fields.
      const wire = snapshotMessages.map((message) => ({
        ...message,
        strippedBySdk: 'not observed',
      }));
      initial.send(
        lifecycle(initial, EventType.RUN_STARTED),
        { type: EventType.MESSAGES_SNAPSHOT, messages: wire },
        lifecycle(initial, EventType.RUN_FINISHED)
      );
      expect(await bounded(firstDone)).toEqual({
        outcome: 'success',
        fetchInvoked: true,
      });
      await bounded(initial.closed);
      ok(observed);
      ok(captured);
      expect(observed).toStrictEqual(snapshotMessages);
      expect(captured).toStrictEqual(observed);
      const expected = structuredClone(
        observed.filter((message) => message.role !== 'activity')
      );
      second = factory.start(
        input('continue', requestMessages(captured)),
        () => undefined
      );
      const secondDone = second.done;
      const continuation = await server.next(1);
      expect(continuation.body.messages).toStrictEqual(expected);
      expect(continuation.body.messages.map((message) => message.role)).toEqual(
        ['system', 'developer', 'user', 'assistant', 'tool', 'reasoning']
      );
      const assistant = continuation.body.messages.find(
        (message) => message.role === 'assistant'
      );
      expect(assistant?.toolCalls?.[0].function.arguments).toBe(
        '{  "city": "Paris" }'
      );
      expect(captured).toStrictEqual(snapshotMessages);
      continuation.send(
        lifecycle(continuation, EventType.RUN_STARTED),
        lifecycle(continuation, EventType.RUN_FINISHED)
      );
      expect(await bounded(secondDone)).toEqual({
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

  it.each([false, true])(
    'normalizes local null tags and activity-only=%s on the actual request body',
    async (activityOnly) => {
      const activity = {
        id: 'activity',
        role: 'activity',
        activityType: 'progress',
        content: { nested: [null] },
      } satisfies Message;
      const local = activityOnly
        ? [activity]
        : ([
            {
              id: 'null',
              role: 'assistant',
              subagentRunId: null,
              metadata: { subagentRunId: null },
            },
            {
              id: 'empty',
              role: 'developer',
              subagentRunId: '',
              content: 'keep',
            },
            { id: 'absent', role: 'reasoning', content: 'keep' },
            activity,
          ] as unknown as Message[]); // Local null is intentionally outside SDK event schemas.
      const captured = ownTranscript(local);
      const server = await serve();
      const handle = createRun({ url: server.url }).start(
        input('local', requestMessages(captured)),
        () => undefined
      );
      const done = handle.done;
      try {
        const exchange = await server.next();
        expect(exchange.body.messages).toStrictEqual(
          activityOnly
            ? []
            : [
                {
                  id: 'null',
                  role: 'assistant',
                  metadata: { subagentRunId: null },
                },
                local[1],
                local[2],
              ]
        );
        expect(captured).toStrictEqual(local);
        exchange.send(
          lifecycle(exchange, EventType.RUN_STARTED),
          lifecycle(exchange, EventType.RUN_FINISHED)
        );
        expect(await bounded(done)).toEqual({
          outcome: 'success',
          fetchInvoked: true,
        });
        await bounded(exchange.closed);
        expect(server.exchanges).toHaveLength(1);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );

  it('propagates local ownership failure through the existing callback contract and closes HTTP', async () => {
    const retained = ownTranscript(snapshotMessages);
    let captured = retained;
    let failure: unknown;
    const server = await serve();
    const handle = createRun({ url: server.url }).start(
      input('failure'),
      (event) => {
        if (event.type !== EventType.MESSAGES_SNAPSHOT) return;
        const local = [
          {
            id: 'user',
            role: 'user',
            content: '',
            metadata: { unsupported: new Date() },
          } satisfies Message,
        ];
        try {
          captured = ownTranscript(local);
        } catch (error) {
          failure = error;
          throw error;
        }
      }
    );
    const done = handle.done;
    try {
      const exchange = await server.next();
      exchange.send(
        lifecycle(exchange, EventType.RUN_STARTED),
        { type: EventType.MESSAGES_SNAPSHOT, messages: [] },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      const result = await bounded(done);
      expect(failure).toBeInstanceOf(TypeError);
      expect(result).toEqual({
        outcome: 'error',
        error: failure,
        fetchInvoked: true,
      });
      if (result.outcome === 'error') expect(result.error).toBe(failure);
      expect(captured).toBe(retained);
      await bounded(exchange.closed);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
