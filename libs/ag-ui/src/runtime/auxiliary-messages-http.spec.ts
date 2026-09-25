import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  EventType,
  type BaseEvent,
  type Message,
  type MessagesSnapshotEvent,
  type ReasoningEncryptedValueEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import {
  applyActivityMessage,
  type ActivityMessageEvent,
} from './activity-messages';
import { applyEncryptedValue } from './encrypted-messages';
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
          () => reject(new Error('Auxiliary HTTP milestone timed out')),
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
  response: ServerResponse;
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
      response,
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
    // Intentionally held open; terminal delivery must close the reader.
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/auxiliary`,
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
    forwardedProps: { observation: 'auxiliary' },
  };
}
function lifecycle(
  exchange: Exchange,
  type: EventType.RUN_STARTED | EventType.RUN_FINISHED
) {
  return { type, threadId: exchange.body.threadId, runId: exchange.body.runId };
}
// Test composition only: the caller retains lifecycle, routing and authority.
function project(previous: Transcript, event: BaseEvent): Transcript {
  switch (event.type) {
    case EventType.ACTIVITY_SNAPSHOT:
    case EventType.ACTIVITY_DELTA:
      return applyActivityMessage(previous, event as ActivityMessageEvent);
    case EventType.REASONING_ENCRYPTED_VALUE:
      return applyEncryptedValue(
        previous,
        event as ReasoningEncryptedValueEvent
      );
    case EventType.TEXT_MESSAGE_START:
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_END:
      return applyTextMessage(previous, event as TextMessageEvent);
    case EventType.TOOL_CALL_START:
    case EventType.TOOL_CALL_ARGS:
    case EventType.TOOL_CALL_END:
      return applyToolMessage(previous, event as ToolMessageEvent);
    case EventType.MESSAGES_SNAPSHOT:
      return reconcileTranscript(
        previous,
        (event as MessagesSnapshotEvent).messages
      );
    default:
      return previous;
  }
}

describe('private auxiliary observation over actual held HTTP', () => {
  it('retains activity after ignored patch and authoritative snapshot, closes SSE and sends exact encrypted request data', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    const user = {
      id: 'u',
      role: 'user',
      content: 'question',
    } satisfies Message;
    const seed = ownTranscript([user]);
    let latest = seed;
    const events: BaseEvent[] = [];
    const observations: Transcript[] = [];
    const snapshotSeen = deferred<void>();
    const goodSeen = deferred<void>();
    const badSeen = deferred<void>();
    const encryptedSeen = deferred<void>();
    let deltaCount = 0;
    let settled = false;
    const first = factory.start(
      input('stream', requestMessages(seed)),
      (event) => {
        events.push(event);
        latest = project(latest, event);
        observations.push(latest);
        if (event.type === EventType.ACTIVITY_SNAPSHOT) snapshotSeen.resolve();
        if (event.type === EventType.ACTIVITY_DELTA) {
          deltaCount++;
          if (deltaCount === 1) goodSeen.resolve();
          else badSeen.resolve();
        }
        if (
          event.type === EventType.REASONING_ENCRYPTED_VALUE &&
          event.subtype === 'tool-call'
        )
          encryptedSeen.resolve();
      }
    );
    const done = first.done.then((result) => {
      settled = true;
      return result;
    });
    const milestone = (promise: Promise<void>) =>
      bounded(
        Promise.race([
          promise,
          done.then((result) => {
            if (result.outcome === 'error') throw result.error;
            throw new Error('Run ended before auxiliary milestone');
          }),
        ])
      );
    let second: RunHandle | undefined;
    try {
      const exchange = await server.next();
      expect(exchange.body).toStrictEqual(input('stream', [user]));
      const activity = {
        id: 'activity',
        role: 'activity',
        activityType: 'progress',
        content: { steps: ['first'], count: 1 },
        metadata: { retained: true },
        subagentRunId: 'child',
      } satisfies Message;
      exchange.send(lifecycle(exchange, EventType.RUN_STARTED), {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'activity',
        activityType: 'progress',
        content: activity.content,
        metadata: activity.metadata,
        subagentRunId: 'child',
      });
      await milestone(snapshotSeen.promise);
      expect(latest).toStrictEqual([user, activity]);
      expect(events[1]).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        replace: true,
      });
      expect(Object.isFrozen(latest[1].content)).toBe(true);
      expect(settled).toBe(false);
      const firstActivity = latest[1];
      exchange.send({
        type: EventType.ACTIVITY_DELTA,
        messageId: 'activity',
        activityType: 'updated',
        patch: [
          { op: 'add', path: '/steps/-', value: 'second' },
          { op: 'replace', path: '/count', value: 2 },
        ],
      });
      await milestone(goodSeen.promise);
      const updated = {
        ...activity,
        activityType: 'updated',
        content: { steps: ['first', 'second'], count: 2 },
      };
      expect(latest).toStrictEqual([user, updated]);
      expect(firstActivity).toStrictEqual(activity);
      const goodActivity = latest[1];
      exchange.send({
        type: EventType.ACTIVITY_DELTA,
        messageId: 'activity',
        activityType: 'must-not-apply',
        patch: [
          { op: 'replace', path: '/count', value: 99 },
          { op: 'replace', path: '/missing', value: 3 },
        ],
        metadata: { ignoredPatch: { received: true } },
      });
      await milestone(badSeen.promise);
      const ignoredPatch = {
        ...updated,
        metadata: { retained: true, ignoredPatch: { received: true } },
      };
      expect(latest).toStrictEqual([user, ignoredPatch]);
      expect(latest[1].content).toBe(goodActivity.content);
      expect(latest[1].metadata).not.toBe(goodActivity.metadata);
      expect(settled).toBe(false);
      exchange.send(
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'a',
          role: 'assistant',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'a',
          delta: 'continued',
        },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'a' },
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'c',
          toolCallName: 'raw',
          parentMessageId: 'a',
        },
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: 'c',
          delta: '{ incomplete ',
        },
        { type: EventType.TOOL_CALL_END, toolCallId: 'c' },
        {
          type: EventType.REASONING_ENCRYPTED_VALUE,
          subtype: 'message',
          entityId: 'a',
          encryptedValue: '雪\u0000opaque-message',
          metadata: { ignored: true },
        },
        {
          type: EventType.REASONING_ENCRYPTED_VALUE,
          subtype: 'tool-call',
          entityId: 'c',
          encryptedValue: 'opaque-call\n+/=',
        }
      );
      await milestone(encryptedSeen.promise);
      const assistant = {
        id: 'a',
        role: 'assistant',
        content: 'continued',
        encryptedValue: '雪\u0000opaque-message',
        toolCalls: [
          {
            id: 'c',
            type: 'function',
            function: { name: 'raw', arguments: '{ incomplete ' },
            encryptedValue: 'opaque-call\n+/=',
          },
        ],
      } satisfies Message;
      expect(latest).toStrictEqual([user, ignoredPatch, assistant]);
      expect(latest[2]).not.toHaveProperty('metadata');
      expect(latest[2]).not.toHaveProperty('subagentRunId');
      expect(settled).toBe(false);
      const beforeSnapshot = latest;
      exchange.send(
        { type: EventType.MESSAGES_SNAPSHOT, messages: [user, assistant] },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      expect(await bounded(done)).toEqual({
        outcome: 'success',
        fetchInvoked: true,
      });
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
      expect(latest).toStrictEqual([user, ignoredPatch, assistant]);
      expect(latest[1]).toBe(beforeSnapshot[1]);
      expect(observations[1]).toStrictEqual([user, activity]);
      expect(observations[2]).toStrictEqual([user, updated]);
      expect(observations[3]).toStrictEqual([user, ignoredPatch]);
      expect(events.map((event) => event.type)).toEqual([
        'RUN_STARTED',
        'ACTIVITY_SNAPSHOT',
        'ACTIVITY_DELTA',
        'ACTIVITY_DELTA',
        'TEXT_MESSAGE_START',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_END',
        'TOOL_CALL_START',
        'TOOL_CALL_ARGS',
        'TOOL_CALL_END',
        'REASONING_ENCRYPTED_VALUE',
        'REASONING_ENCRYPTED_VALUE',
        'MESSAGES_SNAPSHOT',
        'RUN_FINISHED',
      ]);
      const outgoing = input('continue', requestMessages(latest));
      second = factory.start(outgoing, () => undefined);
      const secondDone = second.done.then((result) => result);
      outgoing.messages[1].content = 'caller mutated';
      const continuation = await server.next(1);
      expect(continuation.body).toStrictEqual(
        input('continue', [user, assistant])
      );
      expect(latest).toStrictEqual([user, ignoredPatch, assistant]);
      continuation.send(
        lifecycle(continuation, EventType.RUN_STARTED),
        lifecycle(continuation, EventType.RUN_FINISHED)
      );
      expect(await bounded(secondDone)).toEqual({
        outcome: 'success',
        fetchInvoked: true,
      });
      await bounded(continuation.closed);
      expect(continuation.response.destroyed).toBe(true);
      expect(server.exchanges).toHaveLength(2);
    } finally {
      first.abort();
      second?.abort();
      await server.close();
    }
  });

  it('fails an SDK-admitted event against locally ambiguous history, preserves latest and closes before later finish', async () => {
    const server = await serve();
    // This local ambiguity is caller-owned history; JSON does not carry getters
    // or class instances and this test makes no ownership-capture wire claim.
    const previous = ownTranscript([
      {
        id: 'duplicate',
        role: 'activity',
        activityType: 'old',
        content: { count: 1 },
      },
      { id: 'duplicate', role: 'user', content: 'ambiguous' },
    ]);
    let latest = previous;
    let callbackError: unknown;
    const events: BaseEvent[] = [];
    const handle = createRun({ url: server.url }).start(
      input('ambiguous', []),
      (event) => {
        events.push(event);
        try {
          latest = project(latest, event);
        } catch (error) {
          callbackError = error;
          throw error;
        }
      }
    );
    const done = handle.done.then((result) => result);
    try {
      const exchange = await server.next();
      exchange.send(
        lifecycle(exchange, EventType.RUN_STARTED),
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: 'duplicate',
          activityType: 'new',
          content: { count: 2 },
          replace: false,
        },
        lifecycle(exchange, EventType.RUN_FINISHED)
      );
      const result = await bounded(done);
      expect(result.outcome).toBe('error');
      if (result.outcome === 'error') expect(result.error).toBe(callbackError);
      expect(callbackError).toBeInstanceOf(TypeError);
      expect(latest).toBe(previous);
      expect(latest[0].content).toEqual({ count: 1 });
      expect(events.map((event) => event.type)).toEqual([
        'RUN_STARTED',
        'ACTIVITY_SNAPSHOT',
      ]);
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
      expect(await handle.done).toBe(result);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
