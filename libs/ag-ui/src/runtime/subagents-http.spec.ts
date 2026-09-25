import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  EventType,
  type BaseEvent,
  type RunAgentInput,
  type SubagentStartedEvent,
  type SubagentFinishedEvent,
  type SubagentErrorEvent,
  type StateSnapshotEvent,
  type StateDeltaEvent,
} from '@ag-ui/client';
import { createRun, type RunHandle } from './create-run';
import { applySubagent, type Subagents } from './subagents';
import { applyState, ownState, requestState } from './state';
import { ownTranscript, requestMessages } from './transcript';
import { applyTextMessage, type TextMessageEvent } from './text-messages';

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
          () => reject(new Error('Child HTTP milestone timed out')),
          1500
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface Exchange {
  body: unknown;
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
    // The fixture owns a held response until run cleanup or explicit EOF.
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/children`,
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

const rootStart = {
  type: EventType.RUN_STARTED,
  threadId: 'thread',
  runId: 'run',
};
const rootFinish = {
  type: EventType.RUN_FINISHED,
  threadId: 'thread',
  runId: 'run',
};
const childStart = (subagentRunId = 'child'): SubagentStartedEvent => ({
  type: EventType.SUBAGENT_STARTED,
  subagentRunId,
  name: 'Worker',
});
const childFinish = (subagentRunId = 'child'): SubagentFinishedEvent => ({
  type: EventType.SUBAGENT_FINISHED,
  subagentRunId,
});
const childError = (subagentRunId = 'child'): SubagentErrorEvent => ({
  type: EventType.SUBAGENT_ERROR,
  subagentRunId,
  message: 'failed',
  code: 'E_CHILD',
});
function childEvent(
  event: BaseEvent
): event is SubagentStartedEvent | SubagentFinishedEvent | SubagentErrorEvent {
  return (
    event.type === EventType.SUBAGENT_STARTED ||
    event.type === EventType.SUBAGENT_FINISHED ||
    event.type === EventType.SUBAGENT_ERROR
  );
}
function input(
  state: unknown = {},
  messages = requestMessages(
    ownTranscript([{ id: 'user', role: 'user', content: 'hello' }])
  ),
  runId = 'run'
): RunAgentInput {
  return {
    threadId: 'thread',
    runId,
    state,
    messages,
    tools: [],
    context: [],
    forwardedProps: { mode: 'children' },
  };
}

describe('private native child observations over actual held HTTP', () => {
  it('keeps native child terminals separate from root pause, global content and shared state, then sends a complete next request', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    let children: Subagents = Object.freeze([]);
    let transcript = ownTranscript([
      { id: 'user', role: 'user', content: 'hello' },
    ]);
    let state = ownState({ count: 0 });
    const observations: Subagents[] = [];
    const terminalsSeen = deferred<void>();
    const textSeen = deferred<void>();
    const stateSeen = deferred<void>();
    const events: BaseEvent[] = [];
    let settled = false;
    const handle = factory.start(
      input(requestState(state), requestMessages(transcript)),
      (event) => {
        events.push(event);
        if (childEvent(event)) {
          children = applySubagent(children, event);
          observations.push(children);
          if (event.type === EventType.SUBAGENT_FINISHED)
            terminalsSeen.resolve();
        } else if (
          [
            EventType.TEXT_MESSAGE_START,
            EventType.TEXT_MESSAGE_CONTENT,
            EventType.TEXT_MESSAGE_END,
          ].includes(event.type as EventType)
        ) {
          transcript = applyTextMessage(transcript, event as TextMessageEvent);
          if (event.type === EventType.TEXT_MESSAGE_END) textSeen.resolve();
        } else if (
          event.type === EventType.STATE_SNAPSHOT ||
          event.type === EventType.STATE_DELTA
        ) {
          state = applyState(
            state,
            event as StateSnapshotEvent | StateDeltaEvent
          );
          if (event.type === EventType.STATE_DELTA) stateSeen.resolve();
        }
      }
    );
    const done = handle.done.then((result) => {
      settled = true;
      return result;
    });
    let second: RunHandle | undefined;
    try {
      const exchange = await server.next();
      const parent: SubagentStartedEvent = {
        ...childStart('parent'),
        description: 'Delegate',
        parentToolCallId: 'call',
        parentMessageId: 'assistant',
        timestamp: 1,
        metadata: { origin: { attempt: 1 } },
      };
      const nested: SubagentStartedEvent = {
        ...childStart('nested'),
        name: 'Nested',
        description: 'Inspect',
        parentSubagentRunId: 'parent',
        parentToolCallId: 'nested-call',
        parentMessageId: 'nested-message',
        timestamp: 2,
        metadata: { nested: true },
      };
      const error = {
        ...childError('nested'),
        timestamp: 3,
        metadata: { diagnostic: ['failed'] },
      };
      const suspended: SubagentFinishedEvent = {
        ...childFinish('parent'),
        result: { partial: [1] },
        outcome: { type: 'suspended', interruptIds: ['approval'] },
        timestamp: 4,
        metadata: { finish: true },
      };
      exchange.send(rootStart, parent, nested, error, suspended);
      await bounded(terminalsSeen.promise);
      expect(children).toStrictEqual([
        { started: parent, terminal: suspended },
        { started: nested, terminal: error },
      ]);
      expect(children[0].started).toBe(observations[0][0].started);
      expect(children[1].started).toBe(observations[1][1].started);
      expect(observations[0][0]).not.toHaveProperty('terminal');
      expect(observations[1][1]).not.toHaveProperty('terminal');
      expect(settled).toBe(false);
      const terminalChildren = children;
      exchange.send(
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'answer',
          role: 'assistant',
          subagentRunId: 'nested',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'answer',
          delta: 'After ',
          subagentRunId: 'nested',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'answer',
          delta: 'terminal',
        },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'answer' }
      );
      await bounded(textSeen.promise);
      expect(transcript).toStrictEqual([
        { id: 'user', role: 'user', content: 'hello' },
        {
          id: 'answer',
          role: 'assistant',
          content: 'After terminal',
          subagentRunId: 'nested',
        },
      ]);
      expect(children).toBe(terminalChildren);
      expect(settled).toBe(false);
      exchange.send(
        {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { count: 1 },
          subagentRunId: 'parent',
        },
        {
          type: EventType.STATE_DELTA,
          delta: [{ op: 'replace', path: '/count', value: 2 }],
          subagentRunId: 'nested',
        }
      );
      await bounded(stateSeen.promise);
      expect(state).toEqual({ count: 2 });
      expect(children).toBe(terminalChildren);
      expect(settled).toBe(false);
      exchange.send({
        ...rootFinish,
        outcome: {
          type: 'interrupt',
          interrupts: [
            { id: 'approval', reason: 'approve', subagentRunId: 'parent' },
          ],
        },
      });
      expect(await bounded(done)).toEqual({ outcome: 'paused' });
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
      expect(children).toBe(terminalChildren);
      expect(events.map((event) => event.type)).toEqual([
        'RUN_STARTED',
        'SUBAGENT_STARTED',
        'SUBAGENT_STARTED',
        'SUBAGENT_ERROR',
        'SUBAGENT_FINISHED',
        'TEXT_MESSAGE_START',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_END',
        'STATE_SNAPSHOT',
        'STATE_DELTA',
        'RUN_FINISHED',
      ]);
      const outgoing = input(
        requestState(state),
        requestMessages(transcript),
        'next'
      );
      second = factory.start(outgoing, () => undefined);
      const secondDone = second.done.then((result) => result);
      const next = await server.next(1);
      expect(next.body).toStrictEqual({
        threadId: 'thread',
        runId: 'next',
        state: { count: 2 },
        messages: [
          { id: 'user', role: 'user', content: 'hello' },
          {
            id: 'answer',
            role: 'assistant',
            content: 'After terminal',
            subagentRunId: 'nested',
          },
        ],
        tools: [],
        context: [],
        forwardedProps: { mode: 'children' },
      });
      expect(next.body).not.toHaveProperty('subagents');
      next.send(
        { ...rootStart, runId: 'next' },
        { ...rootFinish, runId: 'next' }
      );
      expect(await bounded(secondDone)).toEqual({ outcome: 'success' });
      await bounded(next.closed);
      expect(server.exchanges).toHaveLength(2);
    } finally {
      handle.abort();
      second?.abort();
      await server.close();
    }
  });

  it('admits a new descendant of a closed parent and keeps omitted child outcome and child error separate from root success', async () => {
    const server = await serve();
    let children: Subagents = [];
    const handle = createRun({ url: server.url }).start(input(), (event) => {
      if (childEvent(event)) children = applySubagent(children, event);
    });
    const done = handle.done.then((result) => result);
    try {
      const exchange = await server.next();
      const nested = { ...childStart('nested'), parentSubagentRunId: 'child' };
      exchange.send(
        rootStart,
        childStart(),
        childFinish(),
        nested,
        childError('nested'),
        rootFinish
      );
      expect(await bounded(done)).toEqual({ outcome: 'success' });
      expect(children).toStrictEqual([
        { started: childStart(), terminal: childFinish() },
        { started: nested, terminal: childError('nested') },
      ]);
      expect(children[0].terminal).not.toHaveProperty('outcome');
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
    } finally {
      handle.abort();
      await server.close();
    }
  });

  it.each([
    ['abort', 'aborted'],
    ['EOF', 'interrupted'],
    ['RUN_ERROR', 'error'],
    ['rejected RUN_FINISHED', 'error'],
  ] as const)(
    'preserves an open child without inventing terminal evidence after %s',
    async (ending, outcome) => {
      const server = await serve();
      let children: Subagents = [];
      const seen = deferred<void>();
      const events: string[] = [];
      const handle = createRun({ url: server.url }).start(input(), (event) => {
        events.push(event.type);
        if (childEvent(event)) {
          children = applySubagent(children, event);
          seen.resolve();
        }
      });
      const done = handle.done.then((result) => result);
      try {
        const exchange = await server.next();
        exchange.send(rootStart, childStart());
        await bounded(seen.promise);
        const previous = children;
        const startEvidence = children[0].started;
        if (ending === 'abort') handle.abort();
        else if (ending === 'EOF') exchange.response.end();
        else if (ending === 'RUN_ERROR')
          exchange.send({ type: EventType.RUN_ERROR, message: 'root failed' });
        else exchange.send(rootFinish);
        const result = await bounded(done);
        expect(result.outcome).toBe(outcome);
        expect(children).toBe(previous);
        expect(children[0].started).toBe(startEvidence);
        expect(children).toStrictEqual([{ started: childStart() }]);
        expect(Object.isFrozen(startEvidence)).toBe(true);
        if (ending === 'rejected RUN_FINISHED') {
          expect(events).toEqual(['RUN_STARTED', 'SUBAGENT_STARTED']);
          if (result.outcome === 'error')
            expect(String(result.error)).toContain(
              'subagents are still active'
            );
        }
        if (ending === 'RUN_ERROR') {
          expect(events).toEqual([
            'RUN_STARTED',
            'SUBAGENT_STARTED',
            'RUN_ERROR',
          ]);
          if (result.outcome === 'error')
            expect(String(result.error)).toContain('root failed');
        }
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
        expect(await handle.done).toBe(result);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );

  it.each(['start', 'terminal'] as const)(
    'SDK rejects repeated child %s after terminal before the observer can mint new evidence',
    async (repeat) => {
      const server = await serve();
      let children: Subagents = [];
      let closedChildren: Subagents | undefined;
      const events: string[] = [];
      const handle = createRun({ url: server.url }).start(input(), (event) => {
        events.push(event.type);
        if (childEvent(event)) {
          children = applySubagent(children, event);
          if (event.type === EventType.SUBAGENT_FINISHED)
            closedChildren = children;
        }
      });
      const done = handle.done.then((result) => result);
      try {
        const exchange = await server.next();
        exchange.send(
          rootStart,
          childStart(),
          childFinish(),
          repeat === 'start' ? childStart() : childError(),
          rootFinish
        );
        const result = await bounded(done);
        expect(result.outcome).toBe('error');
        if (result.outcome === 'error')
          expect(String(result.error)).toContain(
            repeat === 'start'
              ? 'already finished in this run'
              : 'no active subagent'
          );
        expect(events).toEqual([
          'RUN_STARTED',
          'SUBAGENT_STARTED',
          'SUBAGENT_FINISHED',
        ]);
        expect(children).toBe(closedChildren);
        expect(children).toStrictEqual([
          { started: childStart(), terminal: childFinish() },
        ]);
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );

  it('local callback injection after SDK admission fails ownership atomically and closes held HTTP before later root terminal', async () => {
    const server = await serve();
    let children: Subagents = [];
    let prior: Subagents = [];
    let callbackError: unknown;
    const events: string[] = [];
    const handle = createRun({ url: server.url }).start(input(), (event) => {
      events.push(event.type);
      if (!childEvent(event)) return;
      // Deliberate LOCAL CALLBACK INJECTION after valid JSON/SDK admission.
      // A function cannot arrive on JSON wire; this tests the ownership boundary.
      if (event.type === EventType.SUBAGENT_FINISHED)
        event.result = { unsupported: () => undefined };
      try {
        children = applySubagent(children, event);
        prior = children;
      } catch (error) {
        callbackError = error;
        throw error;
      }
    });
    const done = handle.done.then((result) => result);
    try {
      const exchange = await server.next();
      exchange.send(
        rootStart,
        childStart(),
        { ...childFinish(), result: { portable: true } },
        rootFinish
      );
      const result = await bounded(done);
      expect(result.outcome).toBe('error');
      if (result.outcome === 'error') expect(result.error).toBe(callbackError);
      expect(callbackError).toBeInstanceOf(TypeError);
      expect(events).toEqual([
        'RUN_STARTED',
        'SUBAGENT_STARTED',
        'SUBAGENT_FINISHED',
      ]);
      expect(children).toBe(prior);
      expect(children).toStrictEqual([{ started: childStart() }]);
      expect(Object.isFrozen(children[0].started)).toBe(true);
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
      expect(await handle.done).toBe(result);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
