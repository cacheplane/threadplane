import { HttpAgent, PROTOCOL_VERSION, type RunAgentInput } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { createRun } from './create-run';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Client tool milestone timeout')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function held() {
  const requests: {
    input: RunAgentInput;
    send: (...events: unknown[]) => void;
    end: () => void;
  }[] = [];
  const arrivals = new Map<
    number,
    ReturnType<typeof deferred<(typeof requests)[number]>>
  >();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as RunAgentInput;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const request = {
      input,
      send: (...events: unknown[]) => {
        for (const event of events)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
          );
      },
      end: () => controller.close(),
    };
    requests.push(request);
    arrivals.get(requests.length - 1)?.resolve(request);
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  return {
    fetch,
    requests,
    next: (index = 0) => {
      if (requests[index]) return Promise.resolve(requests[index]);
      const arrival =
        arrivals.get(index) ?? deferred<(typeof requests)[number]>();
      arrivals.set(index, arrival);
      return bounded(arrival.promise);
    },
  };
}
function lifecycle(input: RunAgentInput, type = 'RUN_STARTED') {
  return { type, threadId: input.threadId, runId: input.runId };
}
function assistant(ids = ['c'], raw = '{"value":1}') {
  return {
    id: 'a',
    role: 'assistant',
    toolCalls: ids.map((id) => ({
      id,
      type: 'function',
      function: { name: 'f', arguments: raw },
    })),
  };
}
function tools(
  handler = vi.fn(
    async (args: { value: number }, _context: { signal: AbortSignal }) =>
      args.value + 1
  ),
  followUp = true
) {
  return { f: { description: 'f', parameters: {}, handler, followUp } };
}
describe('native client tool command ownership', () => {
  it.each(
    (['stop', 'dispose', 'signal'] as const).flatMap((action) =>
      (['direct', 'nested', 'throwing', 'unencodable'] as const).map(
        (shape) => ({
          action,
          shape,
        })
      )
    )
  )(
    '$shape result getter $action invalidates completion before any result commit',
    async ({ action, shape }) => {
      const wire = held();
      const controller = new AbortController();
      let closed: Promise<void> | undefined;
      const read = vi.fn(() => {
        if (action === 'signal') controller.abort();
        else closed = owner[action]();
        if (shape === 'throwing')
          throw new Error('copy failed after cancellation');
        return shape === 'unencodable' ? undefined : 3;
      });
      const handler = vi.fn(
        async (_args: { value: number }, _context: { signal: AbortSignal }) => {
          expect(_args).toEqual({ value: 1 });
          expect(_context.signal.aborted).toBe(false);
          return shape === 'nested'
            ? {
                nested: {
                  get value() {
                    return read();
                  },
                },
              }
            : {
                get value() {
                  return read();
                },
              };
        }
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        { f: { description: 'f', handler } }
      );
      const observed: ReturnType<typeof owner.getSnapshot>[] = [];
      owner.subscribe(() => {
        observed.push(owner.getSnapshot());
      });
      const done = owner.submit('first', { signal: controller.signal });
      const first = await wire.next();
      try {
        first.send(
          lifecycle(first.input),
          {
            type: 'MESSAGES_SNAPSHOT',
            messages: [...first.input.messages, assistant()],
          },
          lifecycle(first.input, 'RUN_FINISHED')
        );
        expect(await bounded(done)).toBe('aborted');
        if (closed) await bounded(closed);
        expect(read).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledOnce();
        expect(wire.requests).toHaveLength(1);
        const value = owner.getSnapshot();
        expect(value.clientTools.calls[0]).toMatchObject({
          status: 'cancelled',
        });
        expect(value.clientTools.calls[0]).not.toHaveProperty('result');
        expect(value.clientTools.calls[0]).not.toHaveProperty('error');
        expect(value.clientTools.blocker).toMatchObject({
          reason: 'cancelled',
          callIds: ['c'],
        });
        expect(value.clientTools.commandOutcome).toBe('aborted');
        expect(value.run?.outcome).toBe('success');
        expect(
          value.transcript.some((message) => message.role === 'tool')
        ).toBe(false);
        expect(
          observed.some((snapshot) => {
            return (
              snapshot.clientTools.calls.some(
                (call) => call.status === 'complete' || call.status === 'error'
              ) ||
              snapshot.transcript.some((message) => message.role === 'tool')
            );
          })
        ).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(owner.getSnapshot()).toBe(value);
        if (action !== 'dispose')
          expect(await owner.submit('bypass')).toBe('error');
      } finally {
        await owner.dispose();
        await done;
      }
    }
  );
  it.each(['stop', 'dispose', 'signal'] as const)(
    'result getter %s retains only earlier legitimate group results',
    async (action) => {
      const wire = held();
      const controller = new AbortController();
      let closed: Promise<void> | undefined;
      let count = 0;
      const handler = vi.fn(
        async (_args: { value: number }, _context: { signal: AbortSignal }) => {
          expect(_args).toEqual({ value: 1 });
          expect(_context.signal.aborted).toBe(false);
          count++;
          if (count === 1) return { value: 1 };
          return {
            get value() {
              if (action === 'signal') controller.abort();
              else closed = owner[action]();
              return 3;
            },
          };
        }
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        { f: { description: 'f', handler } }
      );
      const done = owner.submit('first', { signal: controller.signal });
      const first = await wire.next();
      try {
        first.send(
          lifecycle(first.input),
          {
            type: 'MESSAGES_SNAPSHOT',
            messages: [...first.input.messages, assistant(['c', 'd'])],
          },
          lifecycle(first.input, 'RUN_FINISHED')
        );
        expect(await bounded(done)).toBe('aborted');
        if (closed) await bounded(closed);
        expect(
          owner.getSnapshot().clientTools.calls.map((call) => call.status)
        ).toEqual(['complete', 'cancelled']);
        expect(owner.getSnapshot().clientTools.calls[0].result).toEqual({
          value: 1,
        });
        expect(owner.getSnapshot().clientTools.calls[1]).not.toHaveProperty(
          'result'
        );
        expect(owner.getSnapshot().clientTools.blocker).toMatchObject({
          reason: 'cancelled',
          callIds: ['d'],
        });
        expect(
          owner
            .getSnapshot()
            .transcript.filter((message) => message.role === 'tool')
        ).toEqual([
          expect.objectContaining({ toolCallId: 'c', content: '{"value":1}' }),
        ]);
        expect(wire.requests).toHaveLength(1);
      } finally {
        await owner.dispose();
        await done;
      }
    }
  );
  it('checks the private invocation guard at the actual fetch seam', async () => {
    const fetch = vi.fn();
    const guard = vi.fn(() => false);
    const event = vi.fn();
    const run = createRun({ url: 'unused', fetch }).start(
      {
        threadId: 't',
        runId: 'r',
        protocolVersion: PROTOCOL_VERSION,
        messages: [],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      },
      event,
      undefined,
      guard
    );
    expect(await bounded(run.done)).toEqual({
      outcome: 'aborted',
      fetchInvoked: false,
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });
  it('stop during an inconclusive physical-result callback still blocks bypass after fetch', async () => {
    const wire = held();
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools()
    );
    let stopped: Promise<void> | undefined;
    owner.subscribe(() => {
      if (!stopped && owner.getSnapshot().run?.outcome === 'error')
        stopped = owner.stop();
    });
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(lifecycle(first.input), {
      type: 'RUN_ERROR',
      message: 'failed',
    });
    expect(await bounded(done)).toBe('aborted');
    await bounded(stopped!);
    expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
    expect(await owner.submit('bypass')).toBe('error');
    await owner.dispose();
  });
  it.each([false, true])(
    'preserves a conclusive native cancellation, unresolved calls %s',
    async (unresolved) => {
      const wire = held();
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools()
      );
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        ...(unresolved
          ? [
              {
                type: 'MESSAGES_SNAPSHOT',
                messages: [...first.input.messages, assistant()],
              },
            ]
          : []),
        {
          ...lifecycle(first.input, 'RUN_FINISHED'),
          outcome: { type: 'cancelled' },
        }
      );
      expect(await bounded(done)).toBe('aborted');
      expect(owner.getSnapshot().run?.outcome).toBe('aborted');
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe(
        unresolved ? 'cancelled' : undefined
      );
      expect(owner.getSnapshot().clientTools.calls).toEqual([]);
      await owner.dispose();
    }
  );
  it('settles a local result message collision without executing a continuation', async () => {
    const wire = held();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(
          '00000000-0000-0000-0000-000000000000'
        );
        return args.value;
      }
    );
    const owner = createSession(
      {
        threadId: 't',
        url: 'unused',
        fetch: wire.fetch,
        messages: [
          {
            id: '00000000-0000-0000-0000-000000000000',
            role: 'user',
            content: 'seed',
          },
        ],
      },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    try {
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('interrupted');
      expect(wire.requests).toHaveLength(1);
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('conflict');
      expect(owner.getSnapshot().run?.outcome).toBe('success');
      expect(
        owner.getSnapshot().transcript.some((m) => m.role === 'tool')
      ).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await owner.dispose();
    }
  });
  it('stop from physical-result publication wins the local command after native success', async () => {
    const wire = held();
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools()
    );
    let stopped: Promise<void> | undefined;
    owner.subscribe(() => {
      if (!stopped && owner.getSnapshot().run?.outcome === 'success')
        stopped = owner.stop();
    });
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(lifecycle(first.input), lifecycle(first.input, 'RUN_FINISHED'));
    expect(await bounded(done)).toBe('aborted');
    await bounded(stopped!);
    expect(owner.getSnapshot().run?.outcome).toBe('success');
    expect(owner.getSnapshot().clientTools.commandOutcome).toBe('aborted');
    await owner.dispose();
  });
  it('allows corrected submit after initial no-fetch preparation failure', async () => {
    const wire = held();
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools()
    );
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementationOnce(() => {
        throw new Error('preparation');
      });
    try {
      expect(await bounded(owner.submit('bad'))).toBe('error');
      expect(wire.fetch).not.toHaveBeenCalled();
      expect(owner.getSnapshot().clientTools.blocker).toBeUndefined();
      const done = owner.submit('corrected');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('success');
    } finally {
      run.mockRestore();
      await owner.dispose();
    }
  });
  it('retains unsent results and blocks a no-fetch continuation preparation failure', async () => {
    const wire = held();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) => {
        vi.spyOn(HttpAgent.prototype, 'run').mockImplementationOnce(() => {
          throw new Error('continuation preparation');
        });
        return args.value;
      }
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    try {
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('error');
      expect(wire.requests).toHaveLength(1);
      expect(owner.getSnapshot().clientTools.calls[0]).toMatchObject({
        status: 'complete',
        delivery: 'unsent',
      });
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
    } finally {
      vi.restoreAllMocks();
      await owner.dispose();
    }
  });
  it.each(['empty-error', 'nonportable', 'unencodable'] as const)(
    'authors an explicit local error for %s and makes its bounded continuation',
    async (mode) => {
      const wire = held();
      // These intentionally untyped runtime results exercise the private storage
      // boundary; the authored catalog's public declaration remains portable.
      const handler = vi.fn(
        async (
          _args: { value: number },
          _context: { signal: AbortSignal }
        ): Promise<number> => {
          if (mode === 'empty-error') throw new Error('');
          return (mode === 'nonportable'
            ? new Date()
            : { missing: undefined }) as unknown as number;
        }
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools(handler)
      );
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      const next = await wire.next(1);
      expect(owner.getSnapshot().clientTools.calls[0].status).toBe('error');
      expect(next.input.messages.at(-1)?.content).toMatch(/^Error: /);
      next.send(lifecycle(next.input), lifecycle(next.input, 'RUN_FINISHED'));
      expect(await bounded(done)).toBe('success');
      await owner.dispose();
    }
  );
  it.each(['terminal', 'pending', 'running', 'complete'] as const)(
    'rejects subscriber submit during %s before input and option getters',
    async (stage) => {
      const wire = held();
      const read = vi.fn(() => {
        throw new Error('must not read');
      });
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools(undefined, false)
      );
      let nested: Promise<unknown> | undefined;
      owner.subscribe(() => {
        const value = owner.getSnapshot();
        if (
          !nested &&
          (stage === 'terminal'
            ? !!value.run?.terminal
            : value.clientTools.calls[0]?.status === stage)
        )
          nested = owner.submit(
            {
              get message() {
                return read();
              },
            },
            {
              get signal() {
                return read();
              },
            }
          );
      });
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('success');
      expect(await bounded(nested!)).toBe('error');
      expect(read).not.toHaveBeenCalled();
      expect(
        owner.getSnapshot().transcript.filter((m) => m.role === 'user')
      ).toHaveLength(1);
      await owner.dispose();
    }
  );
  it('handler submit is rejected and handler stop prevents publication of its returned value', async () => {
    const wire = held();
    let nested!: Promise<unknown>;
    let stopped!: Promise<void>;
    const handler = vi.fn(
      async (_args: { value: number }, _context: { signal: AbortSignal }) => {
        nested = owner.submit('orphan');
        stopped = owner.stop();
        return 9;
      }
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant()],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    expect(await bounded(done)).toBe('aborted');
    await bounded(stopped);
    expect(await nested).toBe('error');
    expect(
      owner.getSnapshot().transcript.filter((m) => m.role === 'user')
    ).toHaveLength(1);
    expect(owner.getSnapshot().transcript.some((m) => m.role === 'tool')).toBe(
      false
    );
    await owner.dispose();
  });
  it.each(['pending', 'running'] as const)(
    'dispose at %s prevents handler execution and settles',
    async (stage) => {
      const wire = held();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools(handler)
      );
      let disposed: Promise<void> | undefined;
      owner.subscribe(() => {
        if (
          !disposed &&
          owner.getSnapshot().clientTools.calls[0]?.status === stage
        )
          disposed = owner.dispose();
      });
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('aborted');
      await bounded(disposed!);
      expect(handler).not.toHaveBeenCalled();
      expect(owner.getSnapshot().clientTools.calls[0].status).toBe('cancelled');
    }
  );
  it('malformed final JSON authors an error without decoded args or a handler', async () => {
    const wire = held();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant(['c'], '{"value":')],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    const next = await wire.next(1);
    expect(handler).not.toHaveBeenCalled();
    expect(owner.getSnapshot().clientTools.calls[0]).toMatchObject({
      status: 'error',
      rawArguments: '{"value":',
      error: 'Invalid JSON arguments',
    });
    expect(owner.getSnapshot().clientTools.calls[0]).not.toHaveProperty('args');
    expect(next.input.messages.at(-1)?.content).toBe(
      'Error: Invalid JSON arguments'
    );
    next.send(lifecycle(next.input), lifecycle(next.input, 'RUN_FINISHED'));
    expect(await bounded(done)).toBe('success');
    await owner.dispose();
  });
  it.each(['RUN_ERROR', 'EOF', 'abort'] as const)(
    'keeps results sent-unconfirmed and blocks after continuation %s',
    async (ending) => {
      const wire = held();
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools()
      );
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      const next = await wire.next(1);
      next.send(lifecycle(next.input));
      if (ending === 'RUN_ERROR')
        next.send({ type: 'RUN_ERROR', message: 'failed' });
      else if (ending === 'EOF') next.end();
      else await bounded(owner.stop());
      expect(await bounded(done)).toBe(
        ending === 'RUN_ERROR'
          ? 'error'
          : ending === 'EOF'
          ? 'interrupted'
          : 'aborted'
      );
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
      expect(owner.getSnapshot().clientTools.calls[0]).toMatchObject({
        status: 'complete',
        delivery: 'sent-unconfirmed',
      });
      expect(
        owner.getSnapshot().transcript.filter((m) => m.role === 'tool')
      ).toHaveLength(1);
      expect(await owner.submit('bypass')).toBe('error');
      await owner.dispose();
    }
  );
  it.each([false, true])(
    'rejects busy submit before every getter, including empty catalog %s',
    async (empty) => {
      const wire = held();
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        empty ? {} : tools()
      );
      const first = owner.submit('first');
      await wire.next();
      const previous = owner.getSnapshot();
      const read = vi.fn(() => {
        throw new Error('must not read');
      });
      expect(
        await owner.submit(
          {
            get message() {
              return read();
            },
          },
          {
            get signal() {
              return read();
            },
          }
        )
      ).toBe('error');
      expect(read).not.toHaveBeenCalled();
      expect(owner.getSnapshot()).toBe(previous);
      await bounded(owner.stop());
      expect(await bounded(first)).toBe('aborted');
      await owner.dispose();
    }
  );
  it('runs snapshot-only calls and continues using a fresh physical id with no extra human', async () => {
    const wire = held();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value + 1
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant()],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    const next = await wire.next(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual({ value: 1 });
    expect(next.input.runId).not.toBe(first.input.runId);
    expect(owner.getSnapshot().run?.id).toBe(next.input.runId);
    expect(next.input.messages.filter((m) => m.role === 'user')).toHaveLength(
      1
    );
    expect(next.input.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c',
      content: '2',
    });
    expect(owner.getSnapshot().clientTools.calls[0].delivery).toBe(
      'sent-unconfirmed'
    );
    next.send(
      lifecycle(next.input),
      { type: 'MESSAGES_SNAPSHOT', messages: next.input.messages },
      lifecycle(next.input, 'RUN_FINISHED')
    );
    expect(await bounded(done)).toBe('success');
    expect(owner.getSnapshot().clientTools.calls[0].delivery).toBe('observed');
    await owner.dispose();
  });
  it.each(['terminal', 'pending', 'running', 'complete'] as const)(
    'queued stop at %s prevents the next side effect',
    async (stage) => {
      const wire = held();
      const handler = vi.fn(
        async (args: { value: number }, _context: { signal: AbortSignal }) =>
          args.value
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools(handler)
      );
      let stop: Promise<void> | undefined;
      owner.subscribe(() => {
        const value = owner.getSnapshot();
        const call = value.clientTools.calls[0];
        if (
          !stop &&
          (stage === 'terminal'
            ? !!value.run?.terminal
            : call?.status === stage)
        )
          stop = owner.stop();
      });
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant(['c', 'd'])],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('aborted');
      await bounded(stop!);
      expect(handler).toHaveBeenCalledTimes(stage === 'complete' ? 1 : 0);
      expect(wire.requests).toHaveLength(1);
      expect(owner.getSnapshot().run?.terminal?.type).toBe('RUN_FINISHED');
      expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('cancelled');
      expect(
        owner.getSnapshot().transcript.filter((m) => m.role === 'tool')
      ).toHaveLength(stage === 'complete' ? 1 : 0);
      await owner.dispose();
    }
  );
  it.each(['resolve', 'reject'] as const)(
    'settles stop with a noncooperative handler and ignores late %s',
    async (ending) => {
      const wire = held();
      const late = deferred<number>();
      const entered = deferred<void>();
      const handler = vi.fn(
        (_args: { value: number }, _context: { signal: AbortSignal }) => {
          entered.resolve();
          return late.promise;
        }
      );
      const owner = createSession(
        { threadId: 't', url: 'unused', fetch: wire.fetch },
        tools(handler)
      );
      const done = owner.submit('first');
      const first = await wire.next();
      first.send(
        lifecycle(first.input),
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [...first.input.messages, assistant()],
        },
        lifecycle(first.input, 'RUN_FINISHED')
      );
      await bounded(entered.promise);
      await bounded(owner.stop());
      expect(await bounded(done)).toBe('aborted');
      const settled = owner.getSnapshot();
      if (ending === 'resolve') late.resolve(9);
      else late.reject(new Error('late'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(owner.getSnapshot()).toBe(settled);
      expect(wire.requests).toHaveLength(1);
      expect(settled.clientTools.calls[0].status).toBe('cancelled');
      expect(settled.transcript.some((m) => m.role === 'tool')).toBe(false);
      await owner.dispose();
    }
  );
  it('dispose settles a noncooperative handler and leaves late values without publication authority', async () => {
    const wire = held();
    const late = deferred<number>();
    const entered = deferred<void>();
    const handler = vi.fn(
      (_args: { value: number }, _context: { signal: AbortSignal }) => {
        entered.resolve();
        return late.promise;
      }
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant()],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    await bounded(entered.promise);
    await bounded(owner.dispose());
    expect(await bounded(done)).toBe('aborted');
    const value = owner.getSnapshot();
    const notify = vi.fn();
    owner.subscribe(notify);
    late.resolve(8);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owner.getSnapshot()).toBe(value);
    expect(notify).not.toHaveBeenCalled();
    expect(wire.requests).toHaveLength(1);
  });
  it('partial group retains its completed result and rejects future human before getters', async () => {
    const wire = held();
    const second = deferred<number>();
    const entered = deferred<void>();
    let count = 0;
    const handler = vi.fn(
      (_args: { value: number }, _context: { signal: AbortSignal }) => {
        count++;
        if (count === 1) return Promise.resolve(1);
        entered.resolve();
        return second.promise;
      }
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant(['c', 'd'])],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    await bounded(entered.promise);
    await bounded(owner.stop());
    expect(await bounded(done)).toBe('aborted');
    expect(
      owner.getSnapshot().clientTools.calls.map((call) => call.status)
    ).toEqual(['complete', 'cancelled']);
    expect(
      owner.getSnapshot().transcript.filter((m) => m.role === 'tool')
    ).toHaveLength(1);
    const read = vi.fn(() => {
      throw new Error('must not read');
    });
    expect(
      await owner.submit(
        {
          get message() {
            return read();
          },
        },
        {
          get signal() {
            return read();
          },
        }
      )
    ).toBe('error');
    expect(read).not.toHaveBeenCalled();
    second.resolve(2);
    await owner.dispose();
  });
  it('uses reconciled transcript order when a final raw snapshot reverses surviving assistant ids', async () => {
    const wire = held();
    const seen: number[] = [];
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) => {
        seen.push(args.value);
        args.value = 99;
        return seen.length;
      }
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler, false)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    const a = assistant(['c'], '{"value":1}');
    const b = { ...assistant(['d'], '{"value":2}'), id: 'b' };
    first.send(
      lifecycle(first.input),
      { type: 'MESSAGES_SNAPSHOT', messages: [...first.input.messages, a, b] },
      { type: 'MESSAGES_SNAPSHOT', messages: [...first.input.messages, b, a] },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    expect(await bounded(done)).toBe('success');
    expect(seen).toEqual([1, 2]);
    expect(
      owner.getSnapshot().clientTools.calls.map((call) => call.args)
    ).toEqual([{ value: 1 }, { value: 2 }]);
    await owner.dispose();
  });
  it('keeps all-false results unsent and carries them on the next explicit submit', async () => {
    const wire = held();
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(undefined, false)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant()],
      },
      lifecycle(first.input, 'RUN_FINISHED')
    );
    expect(await bounded(done)).toBe('success');
    expect(wire.requests).toHaveLength(1);
    expect(owner.getSnapshot().clientTools.calls[0].delivery).toBe('unsent');
    const second = owner.submit('next');
    const next = await wire.next(1);
    expect(next.input.messages.filter((m) => m.role === 'tool')).toHaveLength(
      1
    );
    next.send(lifecycle(next.input), lifecycle(next.input, 'RUN_FINISHED'));
    expect(await bounded(second)).toBe('success');
    await owner.dispose();
  });
  it('blocks an explicit empty pending list without rewriting native success', async () => {
    const wire = held();
    const handler = vi.fn(
      async (args: { value: number }, _context: { signal: AbortSignal }) =>
        args.value
    );
    const owner = createSession(
      { threadId: 't', url: 'unused', fetch: wire.fetch },
      tools(handler)
    );
    const done = owner.submit('first');
    const first = await wire.next();
    first.send(
      lifecycle(first.input),
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [...first.input.messages, assistant()],
      },
      {
        ...lifecycle(first.input, 'RUN_FINISHED'),
        outcome: { type: 'success', pendingToolCallIds: [] },
      }
    );
    expect(await bounded(done)).toBe('interrupted');
    expect(handler).not.toHaveBeenCalled();
    expect(owner.getSnapshot().run?.outcome).toBe('success');
    expect(owner.getSnapshot().clientTools.commandOutcome).toBe('interrupted');
    expect(owner.getSnapshot().clientTools.blocker?.reason).toBe('unsupported');
    expect(await owner.submit('bypass')).toBe('error');
    await owner.dispose();
  });
});
