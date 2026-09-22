import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import { describe, expect, it, vi } from 'vitest';
import { createSession, type SessionOptions } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';

const human = { type: 'human', id: 'saved-user', content: 'Question' };
const saved = { type: 'ai', id: 'saved-answer', content: 'Waiting' };
const final = {
  type: 'values',
  data: { messages: [{ ...saved, content: 'Done' }] },
} satisfies StreamEvent;
const pause = {
  type: 'updates',
  data: { __interrupt__: [{ id: 'next', value: 'Again?' }] },
} satisfies StreamEvent;
function history(messages: unknown[] = [human, saved]): ThreadState[] {
  return [
    {
      values: { messages, stage: 'approval' },
      next: ['approval'],
      tasks: [
        {
          id: 'task',
          name: 'approval',
          error: null,
          checkpoint: null,
          state: null,
          interrupts: [{ id: 'approve', value: 'Proceed?' }],
        },
      ],
      checkpoint: {
        thread_id: 't',
        checkpoint_id: 'c',
        checkpoint_ns: '',
        checkpoint_map: {},
      },
      metadata: null,
      created_at: null,
      parent_checkpoint: null,
    },
  ];
}
async function fixture(
  options: {
    messages?: unknown[];
    stream?: AgentTransport['stream'];
    store?: SessionOptions['executionStore'];
    followUp?: boolean;
  } = {}
) {
  const handler = vi.fn((args: { amount: number }) => ({
    doubled: args.amount * 2,
  }));
  const stream = vi.fn<AgentTransport['stream']>(
    options.stream ??
      async function* () {
        yield final;
      }
  );
  const getHistory = vi.fn(async () => history(options.messages));
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory, updateState },
    executionStore: options.store,
    tools: {
      work: {
        description: 'Work',
        handler,
        followUp: options.followUp ?? true,
      },
    },
  });
  await session.load?.();
  getHistory.mockClear();
  return { session, stream, getHistory, updateState, handler };
}
const tool = (id: string, call = id, amount = 2) => ({
  type: 'ai',
  id,
  content: '',
  tool_calls: [{ id: call, name: 'work', args: { amount } }],
});

describe('explicit interrupt resume', () => {
  it.each([
    undefined,
    null,
    false,
    0,
    '',
    [false, null],
    { approve: true, second: { answer: 0 } },
  ] satisfies PlainValue[])(
    'passes opaque response %j with null input and no authored human/catalog',
    async (value) => {
      const f = await fixture();
      const before = f.session.getSnapshot();
      const external = new AbortController();
      const seen: unknown[] = [];
      f.session.subscribe(() => seen.push(f.session.getSnapshot()));
      expect(await f.session.resume(value, { signal: external.signal })).toBe(
        'success'
      );
      expect(f.stream).toHaveBeenCalledTimes(1);
      expect(f.stream.mock.calls[0].slice(0, 3)).toEqual(['a', 't', null]);
      expect(f.stream.mock.calls[0][3]).not.toBe(external.signal);
      expect(f.stream.mock.calls[0][4]).toEqual(
        value === undefined ? undefined : { command: { resume: value } }
      );
      expect(seen[0]).toMatchObject({
        status: 'running',
        interrupts: [],
        messages: before.messages,
        values: before.values,
      });
      expect(
        f.session.getSnapshot().messages.filter((m) => m.role === 'user')
      ).toEqual([before.messages[0]]);
      expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
        content: 'Done',
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(f.getHistory).not.toHaveBeenCalled();
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.updateState).not.toHaveBeenCalled();
    }
  );

  it('owns nested response data before dispatch without freezing caller objects', async () => {
    const f = await fixture();
    const value = { approve: { choices: ['first'] } };
    const done = f.session.resume(value);
    value.approve.choices.push('later');
    await done;
    const command = f.stream.mock.calls[0][4]?.command;
    expect(command).toEqual({ resume: { approve: { choices: ['first'] } } });
    expect(Object.isFrozen(command?.resume)).toBe(true);
    expect(Object.isFrozen(value.approve)).toBe(false);
  });

  it('re-pauses without running finalized pending tools', async () => {
    const f = await fixture({
      messages: [human, tool('step')],
      stream: async function* () {
        yield { type: 'values', data: { messages: [human, tool('step')] } };
        yield pause;
      },
    });
    expect(await f.session.resume(true)).toBe('paused');
    expect(f.session.getSnapshot().interrupts).toEqual([
      { id: 'next', value: 'Again?' },
    ]);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.updateState).not.toHaveBeenCalled();
  });

  it.each(['empty', 'throw', 'error'] as const)(
    'does not recover ambiguous %s resume from old checkpoints',
    async (kind) => {
      const f = await fixture({
        stream: async function* () {
          if (kind === 'throw') throw new Error('network');
          if (kind === 'error')
            yield { type: 'error', data: { message: 'failed' } };
        },
      });
      expect(await f.session.resume(true)).toBe(
        kind === 'error' ? 'error' : 'interrupted'
      );
      expect(f.session.getSnapshot().error).toMatchObject({
        recovery: 'none',
        retryable: false,
      });
      await f.session.checkStatus?.();
      expect(f.getHistory).not.toHaveBeenCalled();
      await f.session.load?.();
      expect(f.getHistory).toHaveBeenCalledTimes(1);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.stream).toHaveBeenCalledTimes(1);
    }
  );

  it('accepts explicit terminal replay as success while retaining unchanged message delivery', async () => {
    const f = await fixture({
      stream: async function* () {
        yield { type: 'values', data: { messages: [human, saved] } };
      },
    });
    const before = f.session.getSnapshot().messages;
    expect(await f.session.resume()).toBe('success');
    expect(f.session.getSnapshot().messages).toBe(before);
  });

  it('accepts a message-less static breakpoint and explicit terminal values', async () => {
    const f = await fixture({
      messages: [],
      stream: async function* () {
        yield { type: 'values', data: { stage: 'done' } };
      },
    });
    expect(await f.session.resume()).toBe('success');
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(f.session.getSnapshot().values).toEqual({ stage: 'done' });
  });

  it('rejects absent pause without effects and keeps disposed/pre-aborted calls inert', async () => {
    const f = await fixture();
    const before = f.session.getSnapshot();
    expect(await f.session.resume(true, { signal: AbortSignal.abort() })).toBe(
      'aborted'
    );
    expect(f.session.getSnapshot()).toBe(before);
    await f.session.dispose();
    const disposed = f.session.getSnapshot();
    expect(await f.session.resume(true)).toBe('aborted');
    expect(f.session.getSnapshot()).toBe(disposed);
    expect(f.stream).not.toHaveBeenCalled();
    const fresh = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream: f.stream },
    });
    await expect(fresh.resume()).rejects.toThrow(/interrupt|pause/i);
    expect(fresh.getSnapshot().status).toBe('idle');
  });

  it('admits only one concurrent resume and rejects during an active load', async () => {
    const controlled = controlledTransport<StreamEvent>();
    const f = await fixture({ stream: () => controlled.stream });
    const first = f.session.resume(true);
    await expect(f.session.resume(false)).rejects.toThrow(/active|request/i);
    await f.session.stop();
    expect(await first).toBe('aborted');
    const read = deferred<ThreadState[]>();
    f.getHistory.mockImplementation(() => read.promise);
    const loading = f.session.load?.();
    await expect(f.session.resume()).rejects.toThrow(/active|load|history/i);
    read.resolve(history());
    await loading;
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it.each(['stop', 'dispose', 'submit'] as const)(
    'a response getter that calls %s cannot dispatch stale resume',
    async (command) => {
      const f = await fixture();
      let nested: Promise<unknown> | undefined;
      const response = {
        get answer() {
          nested =
            command === 'submit'
              ? f.session.submit('Replacement')
              : f.session[command]();
          return true;
        },
      };
      expect(await f.session.resume(response)).toBe('aborted');
      await nested;
      expect(f.stream).toHaveBeenCalledTimes(command === 'submit' ? 1 : 0);
      if (command === 'submit')
        expect(f.stream.mock.calls[0][2]).not.toBeNull();
    }
  );

  it.each([
    () => ({
      get answer() {
        throw new Error('caller getter');
      },
    }),
    () => new Date(),
    () => {
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      return cyclic;
    },
  ])(
    'rejects unsupported response ownership before mutating',
    async (value) => {
      const f = await fixture();
      const before = f.session.getSnapshot();
      await expect(f.session.resume(value() as PlainValue)).rejects.toThrow();
      expect(f.session.getSnapshot()).toBe(before);
      expect(f.stream).not.toHaveBeenCalled();
    }
  );

  it.each(['stop', 'dispose'] as const)(
    'running observer %s prevents resume I/O',
    async (command) => {
      const f = await fixture();
      f.session.subscribe(() => {
        if (f.session.getSnapshot().status === 'running')
          void f.session[command]();
      });
      expect(await f.session.resume()).toBe('aborted');
      expect(f.stream).not.toHaveBeenCalled();
    }
  );

  it('external cancellation settles promptly and ignores late stream data', async () => {
    const next = deferred<IteratorResult<StreamEvent>>();
    const opened = deferred<void>();
    const f = await fixture({
      stream: () => ({
        [Symbol.asyncIterator]() {
          opened.resolve();
          return {
            next: () => next.promise,
            return: async () => ({ done: true, value: undefined }),
          };
        },
      }),
    });
    const external = new AbortController();
    const pending = f.session.resume(true, { signal: external.signal });
    await opened.promise;
    external.abort();
    expect(await pending).toBe('aborted');
    const stopped = f.session.getSnapshot();
    expect(f.stream.mock.calls[0][3].aborted).toBe(true);
    next.resolve({ done: false, value: pause });
    await Promise.resolve();
    expect(f.session.getSnapshot()).toBe(stopped);
    f.stream.mockImplementation(async function* () {
      yield final;
    });
    expect(await f.session.submit('New question')).toBe('success');
  });

  it('executes only finalized latest-turn pending calls and sends no resume command on follow-up', async () => {
    const messages = [human, tool('step', 'pending', 1)];
    const f = await fixture({
      messages,
      stream: async function* (_a, _t, payload) {
        if (payload === null)
          yield {
            type: 'values',
            data: { messages: [tool('step', 'pending', 3)] },
          };
        else yield final;
      },
    });
    expect(await f.session.resume({ approve: true })).toBe('success');
    expect(f.handler).toHaveBeenCalledExactlyOnceWith(
      { amount: 3 },
      expect.anything()
    );
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.stream.mock.calls[1][4]).toBeUndefined();
    expect(f.stream.mock.calls[1][2]).toMatchObject({
      messages: [{ type: 'tool', tool_call_id: 'pending' }],
      client_tools: [{ name: 'work' }],
    });
    expect(f.updateState).not.toHaveBeenCalled();
  });

  it('does not execute baseline tools absent from terminal data, older turns, later turns, or complete wire calls', async () => {
    const old = tool('old', 'old-call');
    const current = tool('current', 'current-call');
    const complete = tool('complete', 'complete-call');
    const messages = [
      { ...human, id: 'old-user' },
      old,
      human,
      current,
      complete,
      {
        type: 'tool',
        id: 'result',
        tool_call_id: 'complete-call',
        content: 'remote result',
      },
    ];
    const f = await fixture({
      messages,
      stream: async function* () {
        yield {
          type: 'values',
          data: {
            messages: [
              old,
              complete,
              { ...human, id: 'later-user' },
              tool('later', 'later-call'),
            ],
          },
        };
      },
    });
    expect(await f.session.resume()).toBe('success');
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it.each(['empty', 'throw', 'error'] as const)(
    'retains unacknowledged results after %s follow-up and allows only explicit submit handoff',
    async (failure) => {
      const f = await fixture({
        messages: [human, tool('step')],
        stream: async function* (_a, _t, payload) {
          if (payload === null)
            yield { type: 'values', data: { messages: [tool('step')] } };
          else if (failure === 'throw') throw new Error('follow-up failed');
          else if (failure === 'error')
            yield { type: 'error', data: { message: 'failed' } };
        },
      });
      expect(await f.session.resume(true)).toBe(
        failure === 'error' ? 'error' : 'interrupted'
      );
      expect(f.session.getSnapshot().error).toMatchObject({
        recovery: 'none',
        retryable: false,
      });
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(f.getHistory).not.toHaveBeenCalled();
      await f.session.checkStatus?.();
      await expect(f.session.load?.()).rejects.toThrow(/unsettled/i);
      await expect(f.session.resume(true)).rejects.toThrow(/unsettled/i);
      f.stream.mockImplementation(async function* () {
        yield final;
      });
      expect(await f.session.submit('Explicit handoff')).toBe('success');
      expect(f.stream.mock.calls[2][2]).toMatchObject({
        messages: [
          { type: 'tool', tool_call_id: 'step' },
          { type: 'human', content: 'Explicit handoff' },
        ],
      });
      expect(f.handler).toHaveBeenCalledTimes(1);
    }
  );
});

it('never re-enables a later-turn call when subsequent terminal data omits its human boundary', async () => {
  const later = tool('later', 'later-call');
  const f = await fixture({
    stream: async function* () {
      yield {
        type: 'values',
        data: {
          messages: [human, saved, { ...human, id: 'later-user' }, later],
        },
      };
      yield { type: 'values', data: { messages: [later] } };
    },
  });
  expect(await f.session.resume()).toBe('success');
  expect(f.handler).not.toHaveBeenCalled();
  expect(f.stream).toHaveBeenCalledTimes(1);
});

it('retracts tool eligibility when a later terminal batch reveals its foreign user boundary', async () => {
  const later = tool('later', 'later-call');
  const f = await fixture({
    stream: async function* () {
      yield { type: 'values', data: { messages: [later] } };
      yield {
        type: 'values',
        data: {
          messages: [human, saved, { ...human, id: 'later-user' }, later],
        },
      };
    },
  });
  expect(await f.session.resume()).toBe('success');
  expect(f.handler).not.toHaveBeenCalled();
});

it('does not attribute an unseen assistant after an observed later user to the resumed turn', async () => {
  const f = await fixture({
    stream: async function* () {
      yield {
        type: 'values',
        data: { messages: [human, saved, { ...human, id: 'later-user' }] },
      };
      yield {
        type: 'values',
        data: { messages: [tool('unknown-later', 'later-call')] },
      };
    },
  });
  expect(await f.session.resume()).toBe('success');
  expect(f.handler).not.toHaveBeenCalled();
});

it('allows finalized anonymous assistant tools after a message-less pause', async () => {
  const anonymous = {
    type: 'ai',
    content: '',
    tool_calls: [{ id: 'anonymous-call', name: 'work', args: { amount: 4 } }],
  };
  const f = await fixture({
    messages: [],
    stream: async function* (_a, _t, payload) {
      yield payload === null
        ? { type: 'values', data: { messages: [anonymous] } }
        : final;
    },
  });
  expect(await f.session.resume()).toBe('success');
  expect(f.handler).toHaveBeenCalledExactlyOnceWith(
    { amount: 4 },
    expect.anything()
  );
});

it('an abort during listener registration cannot publish stale running state', async () => {
  const f = await fixture();
  const external = new AbortController();
  const add = external.signal.addEventListener.bind(external.signal);
  vi.spyOn(external.signal, 'addEventListener').mockImplementation(
    (...args) => {
      add(...args);
      external.abort();
    }
  );
  expect(await f.session.resume(true, { signal: external.signal })).toBe(
    'aborted'
  );
  expect(f.session.getSnapshot().status).toBe('idle');
  expect(f.stream).not.toHaveBeenCalled();
});

it('blocks resume while an uncertain normal submit still owns history recovery', async () => {
  const f = await fixture({
    stream: async function* () {
      yield pause;
      yield { type: 'error', data: { message: 'Failed' } };
    },
  });
  expect(await f.session.submit('Uncertain')).toBe('error');
  expect(f.session.getSnapshot().interrupts.length).toBeGreaterThan(0);
  expect(f.session.getSnapshot().error?.recovery).toBe('check');
  const before = f.session.getSnapshot();
  await expect(f.session.resume(true)).rejects.toThrow(/recovery/i);
  expect(f.session.getSnapshot()).toBe(before);
  expect(f.stream).toHaveBeenCalledTimes(1);
});

it.each(['claim', 'record', 'write'] as const)(
  'blocks resume through outstanding late %s and persistence',
  async (phase) => {
    const claim = deferred<'claimed'>();
    const recorded = deferred<void>();
    const written = deferred<void>();
    const claimStarted = deferred<void>();
    const recordStarted = deferred<void>();
    const writeStarted = deferred<void>();
    const f = await fixture({
      messages: [human, tool('step')],
      followUp: false,
      store: {
        claim: () => {
          claimStarted.resolve();
          return phase === 'claim'
            ? claim.promise
            : Promise.resolve('claimed' as const);
        },
        record: () => {
          recordStarted.resolve();
          return phase === 'record' ? recorded.promise : Promise.resolve();
        },
      },
      stream: async function* () {
        yield { type: 'values', data: { messages: [tool('step')] } };
      },
    });
    f.updateState.mockImplementation(() => {
      writeStarted.resolve();
      return written.promise;
    });
    const resumed = f.session.resume(true);
    await (phase === 'claim'
      ? claimStarted.promise
      : phase === 'record'
      ? recordStarted.promise
      : writeStarted.promise);
    await f.session.stop();
    expect(await resumed).toBe('aborted');
    await expect(f.session.resume(true)).rejects.toThrow(/unsettled/i);
    claim.resolve('claimed');
    recorded.resolve();
    await writeStarted.promise;
    await expect(f.session.resume(true)).rejects.toThrow(/unsettled/i);
    written.resolve();
    await written.promise;
    await Promise.resolve();
    await f.session.load?.();
    f.stream.mockImplementation(async function* () {
      yield final;
    });
    expect(await f.session.resume(true)).toBe('success');
    expect(f.stream).toHaveBeenCalledTimes(2);
  }
);

it('preserves durable completed facts and local resolved IDs across explicit reload/resume', async () => {
  const claim = vi.fn(async () => ({
    status: 'done' as const,
    result: { ok: true as const, value: { doubled: 12 } },
  }));
  const record = vi.fn(async () => undefined);
  const f = await fixture({
    messages: [human, tool('step')],
    store: { claim, record },
    stream: async function* (_a, _t, payload) {
      yield payload === null
        ? { type: 'values', data: { messages: [tool('step')] } }
        : final;
    },
  });
  expect(await f.session.resume(true)).toBe('success');
  expect(f.session.getSnapshot().toolCalls[0]).toMatchObject({
    status: 'complete',
    result: { doubled: 12 },
  });
  await f.session.load?.();
  expect(await f.session.resume(true)).toBe('success');
  expect(claim).toHaveBeenCalledTimes(1);
  expect(record).not.toHaveBeenCalled();
  expect(f.handler).not.toHaveBeenCalled();
});

it('keeps sessions independent and observes stale rejected reads after disposal', async () => {
  const next = deferred<IteratorResult<StreamEvent>>();
  const entered = deferred<void>();
  const a = await fixture({
    stream: () => ({
      [Symbol.asyncIterator]() {
        entered.resolve();
        return {
          next: () => next.promise,
          return: async () => ({ done: true, value: undefined }),
        };
      },
    }),
  });
  const b = await fixture();
  const pending = a.session.resume(true);
  await entered.promise;
  await a.session.dispose();
  expect(await pending).toBe('aborted');
  expect(await b.session.resume(false)).toBe('success');
  const before = a.session.getSnapshot();
  next.reject(new Error('Late failure'));
  await next.promise.catch(() => undefined);
  await Promise.resolve();
  expect(a.session.getSnapshot()).toBe(before);
  expect(a.getHistory).not.toHaveBeenCalled();
});

it('retracts an anonymous candidate when a later batch reveals its foreign turn', async () => {
  const anonymous = {
    type: 'ai',
    content: '',
    tool_calls: [{ id: 'foreign', name: 'work', args: { amount: 4 } }],
  };
  const f = await fixture({
    stream: async function* () {
      yield { type: 'values', data: { messages: [anonymous] } };
      yield {
        type: 'values',
        data: {
          messages: [human, saved, { ...human, id: 'later-user' }, anonymous],
        },
      };
    },
  });
  expect(await f.session.resume()).toBe('success');
  expect(f.handler).not.toHaveBeenCalled();
});

it('retains later-turn evidence across a legitimate current-turn tool follow-up', async () => {
  let streams = 0;
  const f = await fixture({
    messages: [human, tool('current')],
    stream: async function* () {
      streams += 1;
      yield streams === 1
        ? {
            type: 'values',
            data: {
              messages: [
                human,
                tool('current'),
                { ...human, id: 'later-user' },
                tool('later'),
              ],
            },
          }
        : streams === 2
        ? { type: 'values', data: { messages: [tool('new-foreign')] } }
        : final;
    },
  });
  expect(await f.session.resume(true)).toBe('success');
  expect(f.handler).toHaveBeenCalledTimes(1);
  expect(f.stream).toHaveBeenCalledTimes(2);
});

it('admits at most one of two resumes queued by a paused observer', async () => {
  let count = 0;
  const f = await fixture({
    stream: async function* () {
      yield ++count === 1 ? pause : final;
    },
  });
  let queued: Promise<PromiseSettledResult<unknown>[]> | undefined;
  const off = f.session.subscribe(() => {
    if (
      !queued &&
      f.session.getSnapshot().status === 'idle' &&
      f.session.getSnapshot().interrupts[0]?.id === 'next'
    ) {
      queued = Promise.allSettled([
        f.session.resume(true),
        f.session.resume(false),
      ]);
    }
  });
  expect(await f.session.resume()).toBe('paused');
  expect(await queued).toEqual([
    { status: 'fulfilled', value: 'success' },
    { status: 'rejected', reason: expect.any(Error) },
  ]);
  expect(f.stream).toHaveBeenCalledTimes(2);
  off();
});
