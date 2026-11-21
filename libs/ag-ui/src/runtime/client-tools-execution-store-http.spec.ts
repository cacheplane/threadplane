import type { RunAgentInput } from '@ag-ui/client';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { canonicalInvocation } from './tool-provenance';

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('HTTP execution store milestone timeout')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settleTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
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
const assistant = {
  id: 'a0',
  role: 'assistant',
  toolCalls: [
    {
      id: 'c0',
      type: 'function',
      function: { name: 'f', arguments: '{"value":1}' },
    },
  ],
};
/** Answers the first request with one client tool call. */
async function callTool(server: Awaited<ReturnType<typeof serve>>) {
  const first = await server.next();
  first.send(
    lifecycle(first),
    {
      type: 'MESSAGES_SNAPSHOT',
      messages: [...first.body.messages, assistant],
    },
    lifecycle(first, 'RUN_FINISHED')
  );
}
/** Ends a follow-up request with no further tool calls. */
async function answer(server: Awaited<ReturnType<typeof serve>>, index = 1) {
  const next = await server.next(index);
  next.send(lifecycle(next), lifecycle(next, 'RUN_FINISHED'));
  return next;
}
const key = { threadId: 't', toolCallId: 'c0' };
const invocation = canonicalInvocation('f', { value: 1 });
const cancelled = JSON.stringify({
  ok: false,
  error: 'Client tool execution cancelled before completion: c0',
});
function tools(
  handler = vi.fn(
    async (args: { value: number }, _context: { signal: AbortSignal }) =>
      args.value + 1
  ),
  idempotent = false
) {
  return {
    f: {
      description: 'native tool',
      parameters: { type: 'object' as const },
      ...(idempotent && { idempotent: true }),
      handler,
    },
  };
}
const toolResult = (body: RunAgentInput) =>
  body.messages.find((message) => message.role === 'tool');

describe('client tool execution store over physical HTTP', () => {
  it('claims before handling and records before the result is published or sent', async () => {
    const server = await serve();
    const order: string[] = [];
    const recording = deferred<void>();
    const recorded = deferred<void>();
    const executionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(async () => {
        order.push('acquire');
        return { status: 'acquired', token: 'owner' };
      }),
      settle: vi.fn<ToolExecutionStore['settle']>(async () => {
        order.push('settle');
        recording.resolve();
        await recorded.promise;
        return 'accepted';
      }),
    };
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) => {
        order.push('handler');
        return args.value + 1;
      }
    );
    const owner = createSession(
      { threadId: 't', url: server.url, executionStore },
      tools(handler)
    );
    const done = owner.submit('one');
    try {
      await callTool(server);
      await bounded(recording.promise);
      expect(order).toEqual(['acquire', 'handler', 'settle']);
      expect(executionStore.acquire).toHaveBeenCalledWith(key, invocation);
      expect(executionStore.settle).toHaveBeenCalledWith(key, {
        invocation,
        token: 'owner',
        result: JSON.stringify({ ok: true, value: 2 }),
      });
      await settleTurn();
      expect(owner.getSnapshot().clientTools.calls[0].status).toBe('running');
      expect(
        owner.getSnapshot().transcript.some((m) => m.role === 'tool')
      ).toBe(false);
      expect(server.exchanges).toHaveLength(1);
      recorded.resolve();
      const next = await answer(server);
      expect(toolResult(next.body)).toMatchObject({
        toolCallId: 'c0',
        content: '2',
      });
      expect(await bounded(done)).toBe('success');
      expect(owner.getSnapshot().clientTools.calls[0]).toMatchObject({
        status: 'complete',
        result: 2,
      });
    } finally {
      recorded.resolve();
      await owner.dispose();
      await done;
      await server.close();
    }
  });

  it('skips the store for idempotent tools', async () => {
    const server = await serve();
    const executionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(),
      settle: vi.fn<ToolExecutionStore['settle']>(),
    };
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value + 1
    );
    const owner = createSession(
      { threadId: 't', url: server.url, executionStore },
      tools(handler, true)
    );
    const done = owner.submit('one');
    try {
      await callTool(server);
      await answer(server);
      expect(await bounded(done)).toBe('success');
      expect(handler).toHaveBeenCalledOnce();
      expect(executionStore.acquire).not.toHaveBeenCalled();
      expect(executionStore.settle).not.toHaveBeenCalled();
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
  });

  it.each([
    ['success', JSON.stringify({ ok: true, value: 'Saved' }), 'Saved'],
    ['failure', JSON.stringify({ ok: false, error: 'Bad' }), 'Error: Bad'],
  ] as const)(
    'reuses a stored %s and never runs the handler',
    async (kind, result, content) => {
      const server = await serve();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const executionStore = {
        acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
          status: 'complete',
          result,
        })),
        settle: vi.fn<ToolExecutionStore['settle']>(),
      };
      const owner = createSession(
        { threadId: 't', url: server.url, executionStore },
        tools(handler)
      );
      const done = owner.submit('one');
      try {
        await callTool(server);
        const next = await answer(server);
        expect(await bounded(done)).toBe('success');
        expect(handler).not.toHaveBeenCalled();
        expect(executionStore.settle).not.toHaveBeenCalled();
        expect(toolResult(next.body)).toMatchObject({
          toolCallId: 'c0',
          content,
        });
        expect(owner.getSnapshot().clientTools.calls[0]).toMatchObject(
          kind === 'success'
            ? { status: 'complete', result: 'Saved' }
            : { status: 'error', error: 'Bad' }
        );
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );

  it('fails closed on a conflicting invocation', async () => {
    const server = await serve();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value
    );
    const executionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
        status: 'conflict',
      })),
      settle: vi.fn<ToolExecutionStore['settle']>(),
    };
    const owner = createSession(
      { threadId: 't', url: server.url, executionStore },
      tools(handler)
    );
    const done = owner.submit('one');
    try {
      await callTool(server);
      expect(await bounded(done)).toBe('interrupted');
      expect(handler).not.toHaveBeenCalled();
      expect(executionStore.settle).not.toHaveBeenCalled();
      expect(owner.getSnapshot().clientTools.blocker).toMatchObject({
        reason: 'conflict',
        callIds: ['c0'],
      });
      await settleTurn();
      expect(server.exchanges).toHaveLength(1);
      expect(await owner.submit('again')).toBe('error');
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
  });

  it.each(['unavailable', 'executing', 'malformed', 'reject'] as const)(
    'never runs the handler when the claim is %s',
    async (mode) => {
      const server = await serve();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const executionStore = {
        acquire: vi.fn<ToolExecutionStore['acquire']>(async () => {
          if (mode === 'reject') throw new Error('offline');
          if (mode === 'malformed')
            return { status: 'complete', result: '{"ok":true}' };
          return { status: mode } as never;
        }),
        settle: vi.fn<ToolExecutionStore['settle']>(),
      };
      const owner = createSession(
        { threadId: 't', url: server.url, executionStore },
        tools(handler)
      );
      const done = owner.submit('one');
      try {
        await callTool(server);
        expect(await bounded(done)).toBe('interrupted');
        expect(handler).not.toHaveBeenCalled();
        expect(executionStore.settle).not.toHaveBeenCalled();
        expect(owner.getSnapshot().clientTools.blocker).toMatchObject({
          reason: 'uncertain',
          callIds: ['c0'],
        });
        expect(owner.getSnapshot().clientTools.calls[0].status).toBe('pending');
        await settleTurn();
        expect(server.exchanges).toHaveLength(1);
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );

  it.each(['reject', 'rejected'] as const)(
    'leaves the call unsettled and unsent when settle answers %s',
    async (mode) => {
      const server = await serve();
      const executionStore = {
        acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
          status: 'acquired',
          token: 'owner',
        })),
        settle: vi.fn<ToolExecutionStore['settle']>(async () => {
          if (mode === 'reject') throw new Error('write failed');
          return 'rejected';
        }),
      };
      const owner = createSession(
        { threadId: 't', url: server.url, executionStore },
        tools()
      );
      const done = owner.submit('one');
      try {
        await callTool(server);
        expect(await bounded(done)).toBe('interrupted');
        expect(executionStore.settle).toHaveBeenCalledOnce();
        const snapshot = owner.getSnapshot();
        expect(snapshot.clientTools.blocker).toMatchObject({
          reason: 'uncertain',
          callIds: ['c0'],
        });
        expect(snapshot.clientTools.calls[0].status).toBe('running');
        expect(snapshot.clientTools.calls[0].result).toBeUndefined();
        expect(snapshot.transcript.some((m) => m.role === 'tool')).toBe(false);
        await settleTurn();
        expect(server.exchanges).toHaveLength(1);
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );

  it('captures the store methods once and rejects a store without them', async () => {
    const server = await serve();
    const acquire = vi.fn<ToolExecutionStore['acquire']>(async () => ({
      status: 'acquired',
      token: 'owner',
    }));
    const settle = vi.fn<ToolExecutionStore['settle']>(async () => {
      throw new Error('write failed');
    });
    const executionStore = { acquire, settle };
    const owner = createSession(
      { threadId: 't', url: server.url, executionStore },
      tools()
    );
    executionStore.acquire = vi.fn(async () => ({
      status: 'complete' as const,
      result: JSON.stringify({ ok: true, value: 'other' }),
    }));
    executionStore.settle = vi.fn(async () => 'accepted' as const);
    const done = owner.submit('one');
    try {
      await callTool(server);
      expect(await bounded(done)).toBe('interrupted');
      expect(acquire).toHaveBeenCalledOnce();
      expect(settle).toHaveBeenCalledOnce();
      expect(executionStore.acquire).not.toHaveBeenCalled();
      expect(executionStore.settle).not.toHaveBeenCalled();
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
    for (const store of [
      { settle },
      { acquire },
      { acquire: 'no', settle },
    ] as never[])
      expect(() =>
        createSession(
          { threadId: 't', url: server.url, executionStore: store },
          tools()
        )
      ).toThrow(TypeError);
    expect(() =>
      createSession({
        threadId: 't',
        url: server.url,
        executionStore: { acquire } as never,
      })
    ).toThrow(TypeError);
  });

  it.each([
    ['stop', 'acquired'],
    ['stop', 'complete'],
    ['stop', 'reject'],
    ['dispose', 'acquired'],
    ['dispose', 'complete'],
  ] as const)(
    'settles %s at once while acquire is pending; a late %s never runs the handler',
    async (ending, late) => {
      const server = await serve();
      const claiming = deferred<void>();
      const claim =
        deferred<Awaited<ReturnType<ToolExecutionStore['acquire']>>>();
      const settled = deferred<void>();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const executionStore = {
        acquire: vi.fn<ToolExecutionStore['acquire']>(() => {
          claiming.resolve();
          return claim.promise;
        }),
        settle: vi.fn<ToolExecutionStore['settle']>(async () => {
          settled.resolve();
          return 'accepted';
        }),
      };
      const owner = createSession(
        { threadId: 't', url: server.url, executionStore },
        tools(handler)
      );
      const done = owner.submit('one');
      try {
        await callTool(server);
        await bounded(claiming.promise);
        await bounded(ending === 'stop' ? owner.stop() : owner.dispose());
        expect(await bounded(done)).toBe('aborted');
        const snapshot = owner.getSnapshot();
        if (late === 'acquired')
          claim.resolve({ status: 'acquired', token: 'owner' });
        else if (late === 'complete')
          claim.resolve({
            status: 'complete',
            result: JSON.stringify({ ok: true, value: 'Kept' }),
          });
        else claim.reject(new Error('late'));
        if (late === 'acquired') await bounded(settled.promise);
        await settleTurn();
        expect(handler).not.toHaveBeenCalled();
        expect(server.exchanges).toHaveLength(1);
        expect(owner.getSnapshot()).toBe(snapshot);
        if (late === 'acquired')
          expect(executionStore.settle.mock.calls).toEqual([
            [key, { invocation, token: 'owner', result: cancelled }],
          ]);
        else expect(executionStore.settle).not.toHaveBeenCalled();
        if (ending === 'stop')
          expect(await owner.submit('again')).toBe('error');
      } finally {
        claim.resolve({ status: 'unavailable' });
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );

  it('records cancellation when stop interrupts a claimed handler', async () => {
    const server = await serve();
    const running = deferred<void>();
    const settled = deferred<void>();
    const handler = vi.fn(
      (_args: { value: number }, _context: { signal: AbortSignal }) => {
        running.resolve();
        return new Promise<number>(() => undefined);
      }
    );
    const executionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
        status: 'acquired',
        token: 'owner',
      })),
      settle: vi.fn<ToolExecutionStore['settle']>(async () => {
        settled.resolve();
        return 'accepted';
      }),
    };
    const owner = createSession(
      { threadId: 't', url: server.url, executionStore },
      tools(handler)
    );
    const done = owner.submit('one');
    try {
      await callTool(server);
      await bounded(running.promise);
      await bounded(owner.stop());
      expect(await bounded(done)).toBe('aborted');
      await bounded(settled.promise);
      expect(executionStore.settle.mock.calls).toEqual([
        [key, { invocation, token: 'owner', result: cancelled }],
      ]);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
  });

  it.each(['accepted', 'reject'] as const)(
    'keeps the durable fact when stop races a pending settle that ends %s',
    async (ending) => {
      const server = await serve();
      const recording = deferred<void>();
      const recorded = deferred<'accepted'>();
      const executionStore = {
        acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
          status: 'acquired',
          token: 'owner',
        })),
        settle: vi.fn<ToolExecutionStore['settle']>(() => {
          recording.resolve();
          return recorded.promise;
        }),
      };
      const owner = createSession(
        { threadId: 't', url: server.url, executionStore },
        tools()
      );
      const done = owner.submit('one');
      try {
        await callTool(server);
        await bounded(recording.promise);
        await bounded(owner.stop());
        expect(await bounded(done)).toBe('aborted');
        const snapshot = owner.getSnapshot();
        if (ending === 'accepted') recorded.resolve('accepted');
        else recorded.reject(new Error('durability failed'));
        await settleTurn();
        expect(executionStore.settle.mock.calls).toEqual([
          [
            key,
            {
              invocation,
              token: 'owner',
              result: JSON.stringify({ ok: true, value: 2 }),
            },
          ],
        ]);
        expect(server.exchanges).toHaveLength(1);
        expect(owner.getSnapshot()).toBe(snapshot);
      } finally {
        recorded.resolve('accepted');
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );
});
