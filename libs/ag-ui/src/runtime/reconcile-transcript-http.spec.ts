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
import { reconcileTranscript } from './reconcile-transcript';
import { ownTranscript, requestMessages } from './transcript';

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
          () => reject(new Error('Reconciliation HTTP milestone timed out')),
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
    // Held open so physical cancellation, rather than server EOF, closes it.
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

const corrected = {
  id: 'assistant',
  role: 'assistant',
  name: 'assistant-name',
  encryptedValue: 'message-encrypted',
  subagentRunId: 'child',
  metadata: { nested: [{ keep: 'message', subagentRunId: null }] },
  toolCalls: [
    {
      id: 'call',
      type: 'function',
      function: { name: 'weather', arguments: '{  "city": "Paris" }\n' },
      encryptedValue: 'call-encrypted',
      metadata: { nested: ['call', null] },
    },
  ],
} satisfies Message;

const richSnapshot = [
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
  corrected,
  {
    id: 'tool',
    role: 'tool',
    toolCallId: 'call',
    content: 'result',
    error: 'provider error',
    encryptedValue: 'tool-encrypted',
    metadata: { nested: { keep: true } },
  },
] satisfies Message[];

function seed() {
  // Seeded owned state proves snapshot reconciliation, not streaming reduction.
  // Null attribution is local data; the SDK rejects it in wire snapshots.
  return ownTranscript([
    { id: 'user', role: 'user', content: 'before' },
    {
      id: 'assistant',
      role: 'assistant',
      content: 'obsolete',
      metadata: { obsolete: true },
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'weather', arguments: '{"city":' },
        },
      ],
    },
    {
      id: 'reasoning',
      role: 'reasoning',
      content: 'retained reasoning',
      subagentRunId: null,
      encryptedValue: 'reasoning-encrypted',
      metadata: { subagentRunId: null },
    },
    {
      id: 'activity',
      role: 'activity',
      activityType: 'progress',
      content: { steps: [{ label: 'working' }] },
      metadata: { keep: 'activity' },
    },
  ] as unknown as Message[]);
}

describe('private snapshot reconciliation over actual HTTP', () => {
  it('corrects seeded tool data, retains omitted event-only records and sends exact reconciled egress in a second run', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    const previous = seed();
    let transcript = previous;
    const observed: Message[][] = [];
    let second: RunHandle | undefined;
    const first = factory.start(input('snapshot'), (event) => {
      if (event.type !== EventType.MESSAGES_SNAPSHOT) return;
      const messages = (event as MessagesSnapshotEvent).messages;
      observed.push(messages);
      transcript = reconcileTranscript(transcript, messages);
    });
    try {
      const initial = await server.next();
      // Snapshot order differs from retained order; repeat with reversed input
      // to prove the existing transcript's positions survive another snapshot.
      initial.send(
        lifecycle(initial, EventType.RUN_STARTED),
        { type: EventType.MESSAGES_SNAPSHOT, messages: richSnapshot },
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [...richSnapshot].reverse(),
        },
        lifecycle(initial, EventType.RUN_FINISHED)
      );
      expect(await bounded(first.done)).toEqual({ outcome: 'success' });
      await bounded(initial.closed);
      expect(observed).toStrictEqual([
        richSnapshot,
        [...richSnapshot].reverse(),
      ]);
      const expected = [
        richSnapshot[2],
        corrected,
        previous[2],
        previous[3],
        richSnapshot[0],
        richSnapshot[1],
        richSnapshot[4],
      ];
      expect(transcript).toStrictEqual(expected);
      expect(transcript[2]).toBe(previous[2]);
      expect(transcript[3]).toBe(previous[3]);
      expect(transcript[1]).not.toBe(observed[1][1]);
      expect(transcript[1]).not.toHaveProperty('content');
      expect(transcript[1].metadata).not.toHaveProperty('obsolete');
      expect(previous).toStrictEqual(seed());
      expect(Object.isFrozen(transcript)).toBe(true);
      const outgoing = [
        richSnapshot[2],
        corrected,
        {
          id: 'reasoning',
          role: 'reasoning',
          content: 'retained reasoning',
          encryptedValue: 'reasoning-encrypted',
          metadata: { subagentRunId: null },
        },
        richSnapshot[0],
        richSnapshot[1],
        richSnapshot[4],
      ] satisfies Message[];
      second = factory.start(
        input('continue', requestMessages(transcript)),
        () => undefined
      );
      const continuation = await server.next(1);
      expect(continuation.body).toStrictEqual(input('continue', outgoing));
      expect(continuation.body.messages.map((message) => message.role)).toEqual(
        ['user', 'assistant', 'reasoning', 'system', 'developer', 'tool']
      );
      expect(
        continuation.body.messages.find(
          (message) => message.role === 'assistant'
        )?.toolCalls?.[0].function.arguments
      ).toBe('{  "city": "Paris" }\n');
      expect(transcript).toStrictEqual(expected);
      continuation.send(
        lifecycle(continuation, EventType.RUN_STARTED),
        lifecycle(continuation, EventType.RUN_FINISHED)
      );
      expect(await bounded(second.done)).toEqual({ outcome: 'success' });
      await bounded(continuation.closed);
      expect(server.exchanges).toHaveLength(2);
    } finally {
      first.abort();
      second?.abort();
      await server.close();
    }
  });

  it('turns a duplicate snapshot callback failure into an error and closes HTTP without changing prior state or starting a follow-up', async () => {
    const previous = seed();
    let transcript = previous;
    let failure: unknown;
    const delivered: string[] = [];
    const server = await serve();
    const handle = createRun({ url: server.url }).start(
      input('duplicate'),
      (event) => {
        delivered.push(event.type);
        if (event.type !== EventType.MESSAGES_SNAPSHOT) return;
        try {
          transcript = reconcileTranscript(
            transcript,
            (event as MessagesSnapshotEvent).messages
          );
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
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            corrected,
            { id: corrected.id, role: 'user', content: 'duplicate' },
          ],
        },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      const result = await bounded(handle.done);
      expect(failure).toBeInstanceOf(TypeError);
      expect(result).toEqual({ outcome: 'error', error: failure });
      if (result.outcome === 'error') expect(result.error).toBe(failure);
      await bounded(exchange.closed);
      expect(await handle.done).toBe(result);
      expect(delivered).toEqual([
        EventType.RUN_STARTED,
        EventType.MESSAGES_SNAPSHOT,
      ]);
      expect(transcript).toBe(previous);
      expect(previous).toStrictEqual(seed());
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
