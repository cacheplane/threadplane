import type { RunAgentInput } from '@ag-ui/client';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('HTTP tool milestone timeout')),
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
  send(...events: unknown[]): void;
}
async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, (exchange: Exchange) => void>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    const exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()) as RunAgentInput,
      response,
      send: (...events: unknown[]) => {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.(exchange);
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    exchanges,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/tools`,
    next: (index = 0) =>
      exchanges[index]
        ? Promise.resolve(exchanges[index])
        : bounded(
            new Promise<Exchange>((resolve) => arrivals.set(index, resolve))
          ),
    close: async () => {
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
function assistant(index: number, raw = '{"value":1}') {
  return {
    id: `a${index}`,
    role: 'assistant',
    toolCalls: [
      {
        id: `c${index}`,
        type: 'function',
        function: { name: 'f', arguments: raw },
      },
    ],
  };
}
const definition = (
  handler = vi.fn(
    async (args: { value: number }, _context: { signal: AbortSignal }) =>
      args.value + 1
  )
) => ({
  f: {
    description: 'native tool',
    parameters: { type: 'object' as const },
    handler,
  },
});

describe('native client tools over physical HTTP', () => {
  it.each(['content', 'message-id'] as const)(
    'blocks a conflicting native %s echo without substituting the local result',
    async (mode) => {
      const server = await serve();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const owner = createSession(
        { threadId: 't', url: server.url },
        definition(handler)
      );
      const done = owner.submit('one');
      try {
        const first = await server.next();
        first.send(
          lifecycle(first),
          {
            type: 'MESSAGES_SNAPSHOT',
            messages: [...first.body.messages, assistant(0)],
          },
          lifecycle(first, 'RUN_FINISHED')
        );
        const next = await server.next(1);
        const result = next.body.messages.find((m) => m.role === 'tool')!;
        const changed = next.body.messages.map((m) =>
          m.id === result.id
            ? {
                ...m,
                ...(mode === 'content'
                  ? { content: 'different' }
                  : { id: 'other-result' }),
              }
            : m
        );
        next.send(
          lifecycle(next),
          { type: 'MESSAGES_SNAPSHOT', messages: changed },
          lifecycle(next, 'RUN_FINISHED')
        );
        expect(await bounded(done)).toBe('interrupted');
        expect(handler).toHaveBeenCalledOnce();
        expect(server.exchanges).toHaveLength(2);
        expect(owner.getSnapshot().clientTools.blocker?.reason).toBe(
          'conflict'
        );
        expect(owner.getSnapshot().clientTools.calls[0].delivery).toBe(
          'sent-unconfirmed'
        );
        expect(
          owner.getSnapshot().transcript.find((m) => m.id === result.id)
        ).toEqual(result);
        expect(owner.getSnapshot().run?.outcome).toBe('success');
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );
  it.each(['result', 'removed'] as const)(
    'allows resumed baseline when backend %s resolves its orphan',
    async (mode) => {
      const server = await serve();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const owner = createSession(
        { threadId: 't', url: server.url },
        definition(handler)
      );
      const firstDone = owner.submit('one');
      try {
        const first = await server.next();
        first.send(
          lifecycle(first),
          {
            type: 'MESSAGES_SNAPSHOT',
            messages: [...first.body.messages, assistant(0)],
          },
          {
            ...lifecycle(first, 'RUN_FINISHED'),
            outcome: {
              type: 'interrupt',
              interrupts: [{ id: 'approve', reason: 'confirm' }],
            },
          }
        );
        expect(await bounded(firstDone)).toBe('paused');
        const paused = owner.getSnapshot();
        if (paused.decision?.kind !== 'native')
          throw new Error('Missing pause');
        const done = owner.resume(paused.decision.id, [
          { interruptId: 'approve', status: 'resolved', payload: true },
        ]);
        const resumed = await server.next(1);
        resumed.send(
          lifecycle(resumed),
          {
            type: 'MESSAGES_SNAPSHOT',
            messages:
              mode === 'removed'
                ? first.body.messages
                : [
                    ...resumed.body.messages,
                    {
                      id: 'backend-result',
                      role: 'tool',
                      toolCallId: 'c0',
                      content: 'resolved',
                    },
                  ],
          },
          lifecycle(resumed, 'RUN_FINISHED')
        );
        expect(await bounded(done)).toBe('success');
        expect(handler).not.toHaveBeenCalled();
        expect(owner.getSnapshot().clientTools.blocker).toBeUndefined();
      } finally {
        await owner.dispose();
        await firstDone;
        await server.close();
      }
    }
  );
  it('uses repaired full snapshot arguments, latest state, complete history and a single continuation', async () => {
    const server = await serve();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value + 1
    );
    const owner = createSession(
      { threadId: 't', url: server.url },
      definition(handler)
    );
    const done = owner.submit('one');
    try {
      const first = await server.next();
      first.send(
        lifecycle(first),
        {
          type: 'TOOL_CALL_START',
          parentMessageId: 'a0',
          toolCallId: 'c0',
          toolCallName: 'f',
        },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c0', delta: '{"value":' },
        { type: 'TOOL_CALL_END', toolCallId: 'c0' },
        { type: 'STATE_SNAPSHOT', snapshot: { latest: true } },
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.body.messages, assistant(0, ' { "value": 7 } ')],
        },
        lifecycle(first, 'RUN_FINISHED')
      );
      const next = await server.next(1);
      expect(handler.mock.calls[0][0]).toEqual({ value: 7 });
      expect(next.body).toMatchObject({
        threadId: 't',
        state: { latest: true },
        tools: first.body.tools,
        context: [],
        forwardedProps: {},
      });
      expect(next.body.runId).not.toBe(first.body.runId);
      expect(next.body.messages).toHaveLength(3);
      expect(next.body.messages[2]).toMatchObject({
        role: 'tool',
        toolCallId: 'c0',
        content: '8',
      });
      next.send(lifecycle(next), lifecycle(next, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('success');
      expect(owner.getSnapshot().clientTools.calls[0].delivery).toBe(
        'sent-unconfirmed'
      );
      expect(owner.getSnapshot().run?.id).toBe(next.body.runId);
      expect(server.exchanges).toHaveLength(2);
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
  });
  it.each(['handler', 'arguments'] as const)(
    'bounds eleven physical requests and blocks the eleventh %s group before consuming it',
    async (mode) => {
      const server = await serve();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const owner = createSession(
        { threadId: 't', url: server.url },
        definition(handler)
      );
      const done = owner.submit('one');
      try {
        for (let index = 0; index < 11; index++) {
          const exchange = await server.next(index);
          exchange.send(
            lifecycle(exchange),
            {
              type: 'MESSAGES_SNAPSHOT',
              messages: [
                ...exchange.body.messages,
                assistant(
                  index,
                  mode === 'arguments' ? '{"value":' : '{"value":1}'
                ),
              ],
            },
            lifecycle(exchange, 'RUN_FINISHED')
          );
        }
        expect(await bounded(done)).toBe('interrupted');
        expect(handler).toHaveBeenCalledTimes(mode === 'arguments' ? 0 : 10);
        expect(server.exchanges).toHaveLength(11);
        expect(owner.getSnapshot().clientTools.calls).toHaveLength(10);
        expect(owner.getSnapshot().clientTools.blocker).toMatchObject({
          reason: 'limit',
          callIds: ['c10'],
        });
        expect(owner.getSnapshot().run?.outcome).toBe('success');
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );
  it('resumes a native continuation pause with exact retained results and physical correlation', async () => {
    const server = await serve();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value
    );
    const owner = createSession(
      { threadId: 't', url: server.url },
      definition(handler)
    );
    const firstDone = owner.submit('one');
    try {
      const first = await server.next();
      first.send(
        lifecycle(first),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.body.messages, assistant(0)],
        },
        lifecycle(first, 'RUN_FINISHED')
      );
      const continuation = await server.next(1);
      continuation.send(lifecycle(continuation), {
        ...lifecycle(continuation, 'RUN_FINISHED'),
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'approve', reason: 'confirm' }],
        },
      });
      expect(await bounded(firstDone)).toBe('paused');
      const paused = owner.getSnapshot();
      if (paused.decision?.kind !== 'native')
        throw new Error('Missing native pause');
      expect(paused.run?.id).toBe(continuation.body.runId);
      const done = owner.resume(paused.decision.id, [
        { interruptId: 'approve', status: 'resolved', payload: true },
      ]);
      const resumed = await server.next(2);
      expect(resumed.body.resume).toEqual([
        { interruptId: 'approve', status: 'resolved', payload: true },
      ]);
      expect(resumed.body.messages).toEqual(continuation.body.messages);
      resumed.send(lifecycle(resumed), lifecycle(resumed, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('success');
      expect(handler).toHaveBeenCalledOnce();
      expect(owner.getSnapshot().decision).toBeUndefined();
    } finally {
      await owner.dispose();
      await firstDone;
      await server.close();
    }
  });
  it('allows correlated resume of an unresolved baseline then blocks its successful orphan', async () => {
    const server = await serve();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value
    );
    const owner = createSession(
      { threadId: 't', url: server.url },
      definition(handler)
    );
    const firstDone = owner.submit('one');
    try {
      const first = await server.next();
      first.send(
        lifecycle(first),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.body.messages, assistant(0)],
        },
        {
          ...lifecycle(first, 'RUN_FINISHED'),
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'approve', reason: 'confirm' }],
          },
        }
      );
      expect(await bounded(firstDone)).toBe('paused');
      const paused = owner.getSnapshot();
      if (paused.decision?.kind !== 'native')
        throw new Error('Missing native pause');
      const done = owner.resume(paused.decision.id, [
        { interruptId: 'approve', status: 'resolved', payload: true },
      ]);
      const resumed = await server.next(1);
      resumed.send(lifecycle(resumed), lifecycle(resumed, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('interrupted');
      expect(handler).not.toHaveBeenCalled();
      expect(owner.getSnapshot().decision).toBeUndefined();
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe(
        'unsupported'
      );
      expect(owner.getSnapshot().run?.outcome).toBe('success');
    } finally {
      await owner.dispose();
      await firstDone;
      await server.close();
    }
  });
});
