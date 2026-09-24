import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  EventType,
  type BaseEvent,
  type RunAgentInput,
  type StateDeltaEvent,
  type StateSnapshotEvent,
} from '@ag-ui/client';
import type { PlainValue } from '@threadplane/core';
import { createRun } from './create-run';
import { applyState, ownState, requestState } from './state';

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
          () => reject(new Error('State HTTP milestone timed out')),
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
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/state`,
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

function input(state: unknown, runId = 'run'): RunAgentInput {
  return {
    threadId: 'thread',
    runId,
    state,
    messages: [{ id: 'user', role: 'user', content: 'hello' }],
    tools: [],
    context: [],
    forwardedProps: { mode: 'state' },
  };
}
const started = {
  type: EventType.RUN_STARTED,
  threadId: 'thread',
  runId: 'run',
};
const finished = {
  type: EventType.RUN_FINISHED,
  threadId: 'thread',
  runId: 'run',
};

function stateEvent(
  event: BaseEvent
): event is StateSnapshotEvent | StateDeltaEvent {
  return (
    event.type === EventType.STATE_SNAPSHOT ||
    event.type === EventType.STATE_DELTA
  );
}

describe('private owned state over actual HTTP', () => {
  it('observes incremental owned state, closes held SSE, and sends exact final JSON-compatible state in a new request', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    const events: BaseEvent[] = [];
    const observations: PlainValue[] = [];
    const snapshotSeen = deferred<void>();
    const deltaSeen = deferred<void>();
    let latest = ownState({ initial: true });
    let settled = false;
    const handle = factory.start(input(requestState(latest)), (event) => {
      events.push(event);
      if (stateEvent(event)) {
        latest = applyState(latest, event);
        observations.push(latest);
        if (event.type === EventType.STATE_SNAPSHOT) snapshotSeen.resolve();
        else deltaSeen.resolve();
      }
    });
    const done = handle.done.then((result) => {
      settled = true;
      return result;
    });
    let second: ReturnType<typeof factory.start> | undefined;
    try {
      const exchange = await server.next();
      const snapshot = {
        count: 1,
        items: [{ value: 'first' }],
        nullable: null,
      };
      exchange.send(started, { type: EventType.STATE_SNAPSHOT, snapshot });
      await bounded(snapshotSeen.promise);
      expect(latest).toStrictEqual(snapshot);
      expect(Object.isFrozen(latest)).toBe(true);
      expect(Object.isFrozen((latest as typeof snapshot).items[0])).toBe(true);
      expect(settled).toBe(false);
      exchange.send({
        type: EventType.STATE_DELTA,
        delta: [
          { op: 'replace', path: '/count', value: 2 },
          { op: 'add', path: '/items/-', value: { value: 'second' } },
        ],
      });
      await bounded(deltaSeen.promise);
      const expected = {
        count: 2,
        items: [{ value: 'first' }, { value: 'second' }],
        nullable: null,
      };
      expect(latest).toStrictEqual(expected);
      expect(observations[0]).toStrictEqual(snapshot);
      expect(Object.isFrozen((latest as typeof expected).items[1])).toBe(true);
      expect(settled).toBe(false);
      exchange.send(finished);
      expect(await bounded(done)).toEqual({ outcome: 'success' });
      await bounded(exchange.closed);
      expect(exchange.response.destroyed).toBe(true);
      expect(events.map((event) => event.type)).toEqual([
        'RUN_STARTED',
        'STATE_SNAPSHOT',
        'STATE_DELTA',
        'RUN_FINISHED',
      ]);
      const outgoing = input(requestState(latest), 'second');
      const expectedBody = input(expected, 'second');
      second = factory.start(outgoing, () => undefined);
      const secondDone = second.done.then((result) => result);
      (outgoing.state as typeof expected).items[0].value = 'caller changed';
      const next = await server.next(1);
      expect(next.body).toStrictEqual(expectedBody);
      expect(latest).toStrictEqual(expected);
      expect(observations[0]).toStrictEqual(snapshot);
      next.send(
        { ...started, runId: 'second' },
        { ...finished, runId: 'second' }
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

  it.each(['replace', 'copy'] as const)(
    'failed %s batch keeps the last valid state and callback error wins over later finish',
    async (op) => {
      const server = await serve();
      const events: BaseEvent[] = [];
      let latest = ownState({ initial: true });
      let lastValid = latest;
      let callbackError: unknown;
      const handle = createRun({ url: server.url }).start(
        input(requestState(latest)),
        (event) => {
          events.push(event);
          if (stateEvent(event)) {
            try {
              latest = applyState(latest, event);
              lastValid = latest;
            } catch (error) {
              callbackError = error;
              throw error;
            }
          }
        }
      );
      const done = handle.done.then((result) => result);
      try {
        const exchange = await server.next();
        const snapshot = { count: 1, items: [{ value: 'before' }] };
        exchange.send(
          started,
          { type: EventType.STATE_SNAPSHOT, snapshot },
          {
            type: EventType.STATE_DELTA,
            delta: [
              { op: 'replace', path: '/items/0/value', value: 'partial' },
              op === 'replace'
                ? { op, path: '/missing', value: 9 }
                : { op, from: '/missing', path: '/copied' },
            ],
          },
          finished
        );
        const result = await bounded(done);
        expect(result.outcome).toBe('error');
        if (result.outcome === 'error')
          expect(result.error).toBe(callbackError);
        expect(callbackError).toBeInstanceOf(Error);
        expect(latest).toBe(lastValid);
        expect(latest).toStrictEqual(snapshot);
        expect(Object.isFrozen((latest as typeof snapshot).items[0])).toBe(
          true
        );
        expect(events.map((event) => event.type)).toEqual([
          'RUN_STARTED',
          'STATE_SNAPSHOT',
          'STATE_DELTA',
        ]);
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
        expect(await handle.done).toBe(result);
        expect(server.exchanges).toHaveLength(1);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );
});
