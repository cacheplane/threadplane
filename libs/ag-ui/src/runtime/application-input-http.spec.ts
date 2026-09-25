import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunAgentInput } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { createSession, type Session } from './create-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
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
          () => reject(new Error('Application HTTP milestone timed out')),
          2000
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
  send(...events: unknown[]): void;
}
async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    response.once('close', () => closed.resolve());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange: Exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()),
      response,
      closed: closed.promise,
      send(...events) {
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
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/input`,
    exchanges,
    next(index = 0) {
      if (exchanges[index]) return Promise.resolve(exchanges[index]);
      const arrival = arrivals.get(index) ?? deferred<Exchange>();
      arrivals.set(index, arrival);
      return bounded(arrival.promise);
    },
    async close() {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await bounded(closed);
    },
  };
}
function started(exchange: Exchange) {
  return {
    type: 'RUN_STARTED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
  };
}
function until(owner: Session, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return bounded(
    new Promise<void>((resolve) => {
      const release = owner.subscribe(() => {
        if (predicate()) {
          release();
          resolve();
        }
      });
    })
  );
}

describe('application input over physical HTTP', () => {
  it('sends independent complete envelopes, applies a delta to submitted state, replaces snapshots and isolates owners', async () => {
    const server = await serve();
    const a = createSession({
      threadId: 'a',
      url: server.url,
      state: { keep: { stable: true }, settings: { old: true } },
    });
    const b = createSession({ threadId: 'b', url: server.url });
    try {
      const first = a.submit({
        message: 'First',
        state: {
          settings: { effort: 'low' },
          messages: ['payload'],
          constructor: 'payload',
        },
      });
      const one = await server.next();
      const userId = a.getSnapshot().transcript[0].id;
      expect(one.body).toStrictEqual({
        threadId: 'a',
        runId: a.getSnapshot().run?.id,
        messages: [{ id: userId, role: 'user', content: 'First' }],
        state: {
          keep: { stable: true },
          settings: { effort: 'low' },
          messages: ['payload'],
          constructor: 'payload',
        },
        tools: [],
        context: [],
        forwardedProps: {},
      });
      one.send(
        started(one),
        {
          type: 'STATE_DELTA',
          delta: [{ op: 'replace', path: '/settings/effort', value: 'high' }],
        },
        { type: 'SUBAGENT_STARTED', subagentRunId: 'child', name: 'Worker' },
        {
          type: 'TOOL_CALL_START',
          toolCallId: 'call',
          toolCallName: 'weather',
          parentMessageId: 'answer',
          subagentRunId: 'child',
        },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'call', delta: '{"city":' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'call', delta: '"Paris"}' },
        { type: 'TOOL_CALL_END', toolCallId: 'call' },
        {
          type: 'TOOL_CALL_RESULT',
          messageId: 'result',
          toolCallId: 'call',
          content: '{"temperature":20}',
          subagentRunId: 'child',
        }
      );
      await until(a, () => a.getSnapshot().transcript.length === 3);
      expect(a.getSnapshot().state).toEqual({
        keep: { stable: true },
        settings: { effort: 'high' },
        messages: ['payload'],
        constructor: 'payload',
      });
      const priorState = a.getSnapshot().state;
      const second = a.submit({ message: 'Second', state: { model: 'next' } });
      const two = await server.next(1);
      expect(await bounded(first)).toBe('aborted');
      await bounded(one.closed);
      expect(two.body).toStrictEqual({
        threadId: 'a',
        runId: a.getSnapshot().run?.id,
        messages: [
          { id: userId, role: 'user', content: 'First' },
          {
            id: 'answer',
            role: 'assistant',
            subagentRunId: 'child',
            toolCalls: [
              {
                id: 'call',
                type: 'function',
                function: { name: 'weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          {
            id: 'result',
            role: 'tool',
            toolCallId: 'call',
            content: '{"temperature":20}',
            subagentRunId: 'child',
          },
          {
            id: a.getSnapshot().transcript.at(-1)?.id,
            role: 'user',
            content: 'Second',
          },
        ],
        state: {
          keep: { stable: true },
          settings: { effort: 'high' },
          messages: ['payload'],
          constructor: 'payload',
          model: 'next',
        },
        tools: [],
        context: [],
        forwardedProps: {},
      });
      expect(priorState).not.toHaveProperty('model');
      two.send(started(two), {
        type: 'STATE_SNAPSHOT',
        snapshot: ['authoritative'],
      });
      await until(a, () => Array.isArray(a.getSnapshot().state));
      const before = a.getSnapshot();
      expect(await a.submit({ message: 'rejected', state: {} })).toBe('error');
      expect(a.getSnapshot()).toBe(before);
      expect(server.exchanges).toHaveLength(2);
      const other = b.submit({
        message: 'Other',
        state: { model: 'independent' },
      });
      const three = await server.next(2);
      expect(three.body).toStrictEqual({
        threadId: 'b',
        runId: b.getSnapshot().run?.id,
        messages: [
          {
            id: b.getSnapshot().transcript[0].id,
            role: 'user',
            content: 'Other',
          },
        ],
        state: { model: 'independent' },
        tools: [],
        context: [],
        forwardedProps: {},
      });
      three.send(started(three));
      await a.stop();
      expect(await bounded(second)).toBe('aborted');
      await bounded(two.closed);
      expect(a.getSnapshot().state).toBe(before.state);
      expect(b.getSnapshot().status).toBe('running');
      const final = a.submit('Literal');
      const four = await server.next(3);
      expect(four.body.state).toEqual(['authoritative']);
      expect(four.body.messages).toEqual([
        ...two.body.messages,
        {
          id: a.getSnapshot().transcript.at(-1)?.id,
          role: 'user',
          content: 'Literal',
        },
      ]);
      await a.dispose();
      expect(await bounded(final)).toBe('aborted');
      await bounded(four.closed);
      expect(b.getSnapshot().status).toBe('running');
      await b.dispose();
      expect(await bounded(other)).toBe('aborted');
      await bounded(three.closed);
      expect(await a.submit({ message: 'disposed', state: {} })).toBe(
        'aborted'
      );
      expect(server.exchanges).toHaveLength(4);
    } finally {
      await Promise.all([a.dispose(), b.dispose()]);
      await server.close();
    }
  });

  it.each(['error', 'eof'] as const)(
    'retains admitted and observed state after %s without rollback',
    async (terminal) => {
      const server = await serve();
      const owner = createSession({ threadId: 'retained', url: server.url });
      try {
        const done = owner.submit({
          message: 'first',
          state: { settings: { effort: 'low' } },
        });
        const exchange = await server.next();
        exchange.send(started(exchange), {
          type: 'STATE_DELTA',
          delta: [{ op: 'replace', path: '/settings/effort', value: 'high' }],
        });
        await until(
          owner,
          () =>
            JSON.stringify(owner.getSnapshot().state) ===
            '{"settings":{"effort":"high"}}'
        );
        const observed = owner.getSnapshot();
        if (terminal === 'error')
          exchange.send({ type: 'RUN_ERROR', message: 'fixture failure' });
        else exchange.response.end();
        expect(await bounded(done)).toBe(
          terminal === 'error' ? 'error' : 'interrupted'
        );
        await bounded(exchange.closed);
        expect(owner.getSnapshot().state).toBe(observed.state);
        expect(owner.getSnapshot().transcript).toBe(observed.transcript);
        const next = owner.submit({ message: 'next', state: {} });
        const second = await server.next(1);
        expect(second.body.state).toEqual({ settings: { effort: 'high' } });
        await owner.stop();
        expect(await bounded(next)).toBe('aborted');
        await bounded(second.closed);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );
});
