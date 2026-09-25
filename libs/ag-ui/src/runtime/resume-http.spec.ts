import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunAgentInput } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { createSession, type Session } from './create-session';
import type { PauseId } from './decision';

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
          () => reject(new Error('Resume HTTP milestone timed out')),
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
  isClosed: boolean;
  send(...events: unknown[]): void;
}
async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange: Exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()),
      response,
      closed: closed.promise,
      isClosed: false,
      send(...events) {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    response.once('close', () => {
      exchange.isClosed = true;
      closed.resolve();
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.resolve(exchange);
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/interrupt`,
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

function lifecycle(exchange: Exchange, type = 'RUN_STARTED') {
  return { type, threadId: exchange.body.threadId, runId: exchange.body.runId };
}
function token(owner: Session): PauseId {
  const decision = owner.getSnapshot().decision;
  if (decision?.kind !== 'native') throw new Error('Missing native decision');
  return decision.id;
}
async function paused(
  owner: Session,
  server: Awaited<ReturnType<typeof serve>>,
  interrupts: unknown[] = [{ id: 'approval', reason: 'Approve' }]
) {
  const done = owner.submit({ message: 'First', state: { setting: 'owned' } });
  const exchange = await server.next();
  exchange.send(lifecycle(exchange), {
    ...lifecycle(exchange, 'RUN_FINISHED'),
    outcome: { type: 'interrupt', interrupts },
  });
  expect(await bounded(done)).toBe('paused');
  await bounded(exchange.closed);
  return exchange;
}

describe('correlated native resume over held HTTP', () => {
  it('sends a complete independent envelope, reinterrupts with reused backend IDs, and explicitly cancels the new generation', async () => {
    const server = await serve();
    const owner = createSession({ threadId: 'thread', url: server.url });
    try {
      const first = await paused(owner, server);
      const original = owner.getSnapshot();
      const firstToken = token(owner);
      const responses = [
        {
          interruptId: 'approval',
          status: 'resolved' as const,
          payload: null,
          metadata: { origin: 'review' },
        },
      ];
      const done = owner.resume(firstToken, responses);
      const second = await server.next(1);
      expect(second.body).toStrictEqual({
        threadId: 'thread',
        runId: owner.getSnapshot().run?.id,
        messages: [
          { id: first.body.messages[0].id, role: 'user', content: 'First' },
        ],
        state: { setting: 'owned' },
        resume: responses,
        tools: [],
        context: [],
        forwardedProps: {},
      });
      expect(second.body.runId).not.toBe(first.body.runId);
      expect(owner.getSnapshot().transcript).toBe(original.transcript);
      expect(owner.getSnapshot().state).toBe(original.state);
      second.send(lifecycle(second), {
        ...lifecycle(second, 'RUN_FINISHED'),
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'approval', reason: 'Approve again' }],
        },
      });
      expect(await bounded(done)).toBe('paused');
      await bounded(second.closed);
      const next = owner.getSnapshot();
      const nextToken = token(owner);
      expect(nextToken).not.toBe(firstToken);
      expect(next.decision).toMatchObject({
        kind: 'native',
        sourceRunId: second.body.runId,
      });
      expect(
        next.decision?.kind === 'native' && next.decision.attempt
      ).toBeUndefined();
      expect(await owner.resume(firstToken, responses)).toBe('error');
      expect(server.exchanges).toHaveLength(2);
      const cancelled = owner.resume(nextToken, [
        { interruptId: 'approval', status: 'cancelled' },
      ]);
      const third = await server.next(2);
      expect(third.body).toStrictEqual({
        threadId: 'thread',
        runId: owner.getSnapshot().run?.id,
        messages: [
          { id: first.body.messages[0].id, role: 'user', content: 'First' },
        ],
        state: { setting: 'owned' },
        resume: [{ interruptId: 'approval', status: 'cancelled' }],
        tools: [],
        context: [],
        forwardedProps: {},
      });
      third.send(lifecycle(third), {
        ...lifecycle(third, 'RUN_FINISHED'),
        outcome: { type: 'success' },
      });
      expect(await bounded(cancelled)).toBe('success');
      await bounded(third.closed);
      expect(owner.getSnapshot().decision).toBeUndefined();
      expect(original.decision?.kind).toBe('native');
      expect(server.exchanges.every((exchange) => exchange.isClosed)).toBe(
        true
      );
    } finally {
      await owner.dispose();
      await server.close();
    }
  });

  it.each(['abort', 'eof', 'error', 'empty-batch'] as const)(
    'retains an invoked claim after %s and refuses replay or ordinary bypass',
    async (ending) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      try {
        await paused(owner, server);
        const pause = token(owner);
        const done = owner.resume(pause, [
          { interruptId: 'approval', status: 'resolved', payload: true },
        ]);
        const exchange = await server.next(1);
        const claimed = owner.getSnapshot().decision;
        exchange.send(lifecycle(exchange));
        if (ending === 'abort') await owner.stop();
        else if (ending === 'eof') exchange.response.end();
        else if (ending === 'error')
          exchange.send({
            type: 'RUN_ERROR',
            message: 'Rejected after dispatch',
          });
        else
          exchange.send({
            ...lifecycle(exchange, 'RUN_FINISHED'),
            outcome: { type: 'interrupt', interrupts: [] },
          });
        expect(await bounded(done)).toBe(
          ending === 'abort'
            ? 'aborted'
            : ending === 'eof'
            ? 'interrupted'
            : 'error'
        );
        await bounded(exchange.closed);
        const final = owner.getSnapshot();
        expect(final.decision).toBe(claimed);
        expect(final.run?.terminal?.type).toBe(
          ending === 'error' ? 'RUN_ERROR' : undefined
        );
        expect(
          await owner.resume(pause, [
            { interruptId: 'approval', status: 'resolved' },
          ])
        ).toBe('error');
        expect(await owner.submit('bypass')).toBe('error');
        await owner.stop();
        expect(owner.getSnapshot()).toBe(final);
        expect(server.exchanges).toHaveLength(2);
        expect(server.exchanges.every((item) => item.isClosed)).toBe(true);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );

  it('clears conclusive success at local settlement even when a terminal listener stops', async () => {
    const server = await serve();
    const owner = createSession({ threadId: 'thread', url: server.url });
    try {
      await paused(owner, server);
      const pause = token(owner);
      let stopped = false;
      owner.subscribe(() => {
        const snapshot = owner.getSnapshot();
        if (
          !stopped &&
          snapshot.decision?.kind === 'native' &&
          snapshot.decision.attempt &&
          snapshot.run?.terminal?.type === 'RUN_FINISHED'
        ) {
          stopped = true;
          void owner.stop();
        }
      });
      const done = owner.resume(pause, [
        { interruptId: 'approval', status: 'resolved' },
      ]);
      const exchange = await server.next(1);
      exchange.send(lifecycle(exchange), lifecycle(exchange, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('aborted');
      await bounded(exchange.closed);
      expect(stopped).toBe(true);
      expect(owner.getSnapshot().decision).toBeUndefined();
      expect(owner.getSnapshot().run?.terminal?.type).toBe('RUN_FINISHED');
    } finally {
      await owner.dispose();
      await server.close();
    }
  });

  it.each(['2000-01-01T00:00:00Z', 'invalid'])(
    'makes no resume POST for expired or invalid expiry %s',
    async (expiresAt) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      try {
        await paused(owner, server, [
          { id: 'approval', reason: 'Approve', expiresAt },
        ]);
        const before = owner.getSnapshot();
        expect(
          await owner.resume(token(owner), [
            { interruptId: 'approval', status: 'resolved' },
          ])
        ).toBe('error');
        expect(owner.getSnapshot()).toBe(before);
        expect(server.exchanges).toHaveLength(1);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );

  it.each(['native', 'legacy-observation'] as const)(
    'blocks a %s notice without inventing native responses',
    async (interruptMode) => {
      const server = await serve();
      const owner = createSession({
        threadId: 'thread',
        url: server.url,
        interruptMode,
      });
      try {
        const done = owner.submit('First');
        const exchange = await server.next();
        exchange.send(lifecycle(exchange), {
          type: 'CUSTOM',
          name: 'on_interrupt',
          value: 'Approve',
        });
        if (interruptMode === 'native') exchange.response.end();
        expect(await bounded(done)).toBe(
          interruptMode === 'native' ? 'interrupted' : 'paused'
        );
        await bounded(exchange.closed);
        expect(owner.getSnapshot().decision).toEqual({
          kind: 'unsupported',
          sourceRunId: exchange.body.runId,
        });
        expect(
          await owner.resume('guessed' as PauseId, [
            { interruptId: 'approval', status: 'resolved' },
          ])
        ).toBe('error');
        expect(await owner.submit('bypass')).toBe('error');
        expect(server.exchanges).toHaveLength(1);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );

  it('retains unsupported evidence for a delivered duplicate-ID batch', async () => {
    const server = await serve();
    const owner = createSession({ threadId: 'thread', url: server.url });
    try {
      const exchange = await paused(owner, server, [
        { id: 'same', reason: 'One' },
        { id: 'same', reason: 'Two' },
      ]);
      expect(owner.getSnapshot().decision).toEqual({
        kind: 'unsupported',
        sourceRunId: exchange.body.runId,
      });
      expect(await owner.submit('bypass')).toBe('error');
      expect(server.exchanges).toHaveLength(1);
    } finally {
      await owner.dispose();
      await server.close();
    }
  });

  it('uses the captured Strands native response wire shape with full observed history; completion is synthetic', async () => {
    const captured = JSON.parse(
      readFileSync(
        new URL(
          '../../fixtures/runtime-transcripts/strands-resume.request.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as RunAgentInput;
    const trace = readFileSync(
      new URL(
        '../../fixtures/runtime-transcripts/strands-interrupt.sse',
        import.meta.url
      ),
      'utf8'
    );
    const server = await serve();
    const owner = createSession({ threadId: 'th-int-555800', url: server.url });
    try {
      const first = owner.submit('Observe captured pause');
      const exchange = await server.next();
      exchange.response.write(trace.replaceAll('run-1', exchange.body.runId));
      expect(await bounded(first)).toBe('paused');
      await bounded(exchange.closed);
      const responses = [
        {
          interruptId:
            'v1:tool_call:call_A9ckGX1LrvO82OhqZinzDsom:340a4daa-b874-5aad-8309-a63b92d507dd',
          status: 'resolved' as const,
          payload: { chosen_label: 'Tuesday 10:00' },
        },
      ];
      expect(responses).toStrictEqual(captured.resume);
      const done = owner.resume(token(owner), responses);
      const resumed = await server.next(1);
      expect(resumed.body).toStrictEqual({
        threadId: 'th-int-555800',
        runId: owner.getSnapshot().run?.id,
        messages: [
          {
            id: 'u-b176b0c0',
            role: 'user',
            content: 'Schedule a meeting with Dana about the Q3 roadmap.',
          },
          {
            id: '65ee30a7-e1c0-43c7-9cff-680c2f43fec8',
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_A9ckGX1LrvO82OhqZinzDsom',
                type: 'function',
                function: {
                  name: 'schedule_meeting',
                  arguments: '{"topic": "Q3 roadmap", "attendee": "Dana"}',
                },
              },
            ],
          },
        ],
        state: {},
        resume: responses,
        tools: [],
        context: [],
        forwardedProps: {},
      });
      resumed.send(lifecycle(resumed), lifecycle(resumed, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('success');
      await bounded(resumed.closed);
      expect(server.exchanges.every((item) => item.isClosed)).toBe(true);
    } finally {
      await owner.dispose();
      await server.close();
    }
  });
});
