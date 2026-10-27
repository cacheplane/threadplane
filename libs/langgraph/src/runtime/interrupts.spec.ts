import type { ThreadState } from '@langchain/langgraph-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { LangGraphSnapshot } from './langgraph-snapshot';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

const ai = (content: string, id = 'answer') => ({ id, type: 'ai', content });
const full = (data: unknown): StreamEvent => ({ type: 'values', data });
const checkpoint = (values: unknown, next: string[] = []): ThreadState => ({
  values: values as ThreadState['values'],
  next,
  tasks: [],
  metadata: null,
  checkpoint: {
    thread_id: 't',
    checkpoint_id: 'c',
    checkpoint_ns: '',
    checkpoint_map: {},
  },
  parent_checkpoint: null,
  created_at: null,
});
const fixtures: {
  session: { dispose(): Promise<void> };
  streams: ReturnType<typeof controlledTransport<StreamEvent>>[];
}[] = [];
function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const acknowledgements: ReturnType<typeof deferred<void>>[] = [];
  const starts = Array.from({ length: 8 }, () => deferred<void>());
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
    const index = streams.length;
    const controlled = controlledTransport<StreamEvent>({
      signal,
      ignoreAbort: true,
    });
    streams.push(controlled);
    starts[index].resolve();
    const iterator: AsyncIterableIterator<StreamEvent> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      next() {
        acknowledgements[index]?.resolve();
        return controlled.stream.next();
      },
      return() {
        acknowledgements[index]?.resolve();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    return iterator;
  });
  const history = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const write = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  const handler = vi.fn((args: { input: string }) => args.input);
  const acquire = vi.fn(async () => ({
    status: 'acquired' as const,
    token: 'owner',
  }));
  const settle = vi.fn(async () => 'accepted' as const);
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory: history, updateState: write },
    executionStore: { acquire, settle },
    tools: { work: { description: 'Work', handler } },
  });
  const f = {
    session,
    streams,
    stream,
    history,
    write,
    handler,
    acquire,
    settle,
    snapshot: () => session.getSnapshot() as LangGraphSnapshot,
    started: (index = 0) => starts[index].promise,
    async emit(event: StreamEvent, index = 0) {
      acknowledgements[index] = deferred<void>();
      streams[index].release(event);
      await acknowledgements[index].promise;
    },
    turn(values: Record<string, unknown> = {}, index = 0) {
      const user = (stream.mock.calls[index][2] as { messages: unknown[] })
        .messages[0];
      const data = Object.create(
        Object.getPrototypeOf(values),
        Object.getOwnPropertyDescriptors(values)
      );
      Object.defineProperty(data, 'messages', {
        value: [user, ai('Recovered')],
        enumerable: true,
        configurable: true,
      });
      return checkpoint(data);
    },
  };
  fixtures.push(f);
  return f;
}
async function seed(f: ReturnType<typeof fixture>) {
  f.history.mockResolvedValueOnce([
    checkpoint({
      messages: [ai('Saved', 'saved')],
      count: 1,
      __interrupt__: [{ id: 'saved', value: { prompt: ['Confirm'] } }],
    }),
  ]);
  await f.session.load?.();
}
const control = (interrupts: unknown): StreamEvent =>
  full({ __interrupt__: interrupts });
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (f) => {
      await f.session.dispose();
      f.streams.forEach((stream) => stream.finish());
    })
  );
});

describe('session interrupt observation', () => {
  for (const mode of ['close', 'check'] as const) {
    it(`recovers the earlier turn as success while observing a later turn's pending batch (${mode})`, async () => {
      const f = fixture();
      const run = f.session.submit('Earlier request');
      await f.started();
      if (mode === 'check') {
        f.streams[0].finish();
        expect(await run).toBe('interrupted');
      }
      const user = (f.stream.mock.calls[0][2] as { messages: unknown[] })
        .messages[0];
      f.history.mockResolvedValueOnce([
        checkpoint(
          {
            count: 2,
            messages: [
              user,
              ai('Earlier answer', 'earlier'),
              { type: 'human', id: 'later-user', content: 'Later request' },
              {
                ...ai('Later pause', 'later'),
                tool_calls: [
                  { id: 'later-tool', name: 'work', args: { input: 'later' } },
                ],
              },
            ],
            __interrupt__: [{ id: 'later-pause', value: false }],
          },
          ['approval']
        ),
      ]);
      if (mode === 'close') {
        f.streams[0].finish();
        expect(await run).toBe('success');
      } else await f.session.checkStatus?.();
      expect(f.snapshot().interrupts).toEqual([
        { id: 'later-pause', value: false },
      ]);
      expect(f.snapshot().values).toEqual({ count: 2 });
      expect(f.snapshot().messages.at(-1)).toMatchObject({
        id: 'earlier',
        delivery: { outcome: 'success' },
      });
      expect(f.snapshot().toolCalls).toEqual([]);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.acquire).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
    });
  }
  it('starts with an owned empty batch and observation performs no I/O', () => {
    const f = fixture();
    const first = f.snapshot();
    expect(first.interrupts).toEqual([]);
    expect(Object.isFrozen(first.interrupts)).toBe(true);
    f.session.subscribe(() => undefined)();
    expect(f.snapshot()).toBe(first);
    expect(f.history).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it('publishes separate controls in wire order, retains them through full state, and pauses at EOF', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    const seen: LangGraphSnapshot[] = [];
    f.session.subscribe(() => seen.push(f.snapshot()));
    await f.emit(control([{ id: 'a', value: false }]));
    await f.emit({
      type: 'updates',
      data: {
        __interrupt__: [
          { id: 'a', value: 'duplicate' },
          { id: 'b', value: 0 },
        ],
      },
    });
    const batch = f.snapshot().interrupts;
    expect(batch).toEqual([
      { id: 'a', value: false },
      { id: 'b', value: 0 },
    ]);
    await f.emit(full({ count: 2, messages: [ai('Awaiting approval')] }));
    expect(f.snapshot().interrupts).toBe(batch);
    expect(seen.at(-1)).toMatchObject({
      values: { count: 2 },
      interrupts: batch,
      messages: [{ role: 'user' }, { content: 'Awaiting approval' }],
    });
    f.streams[0].finish();
    expect(await run).toBe('paused');
    expect(f.snapshot().messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'paused',
    });
    expect(f.history).not.toHaveBeenCalled();
    expect(f.handler).not.toHaveBeenCalled();
  });

  it('treats a messageless empty control as a static breakpoint, without reads or tool execution', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(control([]));
    f.streams[0].finish();
    expect(await run).toBe('paused');
    expect(f.snapshot().interrupts).toEqual([{ when: 'breakpoint' }]);
    expect(f.history).not.toHaveBeenCalled();
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it('clears pause with an explicit standalone empty list and ignores custom and child lookalikes', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(control([]));
    await f.emit({ type: 'interrupts', data: { interrupts: [] } });
    await f.emit({
      type: 'custom',
      data: { __interrupt__: [{ value: 'not a control' }] },
    });
    await f.emit({ type: 'values|child', data: { __interrupt__: [] } });
    await f.emit(full({ messages: [ai('Done')] }));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.snapshot().interrupts).toEqual([]);
  });

  it('restores all latest task interrupts atomically, deduplicates equal reads, and clears empty history', async () => {
    const f = fixture();
    const saved = checkpoint({ count: 2, messages: [ai('Saved')] });
    saved.tasks = [
      {
        id: 't1',
        name: 'node',
        error: null,
        checkpoint: null,
        state: null,
        interrupts: [{ id: 'a', value: false }],
      },
      {
        id: 't2',
        name: 'node',
        error: null,
        checkpoint: null,
        state: null,
        interrupts: [{ id: 'b', value: { nested: [1] } }],
      },
    ];
    f.history.mockResolvedValueOnce([saved]);
    const seen: LangGraphSnapshot[] = [];
    f.session.subscribe(() => seen.push(f.snapshot()));
    await f.session.load?.();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      values: { count: 2 },
      interrupts: [
        { id: 'a', value: false },
        { id: 'b', value: { nested: [1] } },
      ],
    });
    expect(seen[0].messages[0].delivery).toMatchObject({ outcome: 'paused' });
    const before = f.snapshot();
    f.history.mockResolvedValueOnce([structuredClone(saved)]);
    await f.session.load?.();
    expect(f.snapshot()).toBe(before);
    expect(seen).toHaveLength(1);
    await f.session.load?.();
    expect(f.snapshot().interrupts).toEqual([]);
    expect(f.snapshot().values).toBeUndefined();
    expect(f.snapshot().messages).toEqual([]);
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.handler).not.toHaveBeenCalled();
  });

  it('clears once on accepted submit while pre-aborted submits retain exact history', async () => {
    const f = fixture();
    await seed(f);
    const before = f.snapshot();
    expect(
      await f.session.submit('Cancelled', { signal: AbortSignal.abort() })
    ).toBe('aborted');
    expect(f.snapshot()).toBe(before);
    const seen: LangGraphSnapshot[] = [];
    f.session.subscribe(() => seen.push(f.snapshot()));
    const run = f.session.submit('Go');
    await f.started();
    expect(seen).toHaveLength(1);
    expect(seen[0].interrupts).toEqual([]);
    expect(seen[0].values).toBe(before.values);
    expect(seen[0].status).toBe('running');
    await f.session.stop();
    expect(await run).toBe('aborted');
  });

  for (const action of ['stop', 'dispose', 'failure'] as const) {
    it(`preserves observed interrupts through ${action} and ignores late events`, async () => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      await f.emit(control([{ id: 'a', value: 'pending' }]));
      const before = f.snapshot().interrupts;
      if (action === 'failure')
        await f.emit({ type: 'error', data: { message: 'failed' } });
      else await f.session[action]();
      expect(await run).toBe(action === 'failure' ? 'error' : 'aborted');
      const settled = f.snapshot();
      expect(settled.interrupts).toBe(before);
      f.streams[0].release(control([{ id: 'late' }]));
      f.streams[0].finish();
      await f.streams[0].closed;
      expect(f.snapshot()).toBe(settled);
      expect(f.write).not.toHaveBeenCalled();
      if (action === 'dispose') {
        expect(await f.session.submit('No')).toBe('aborted');
        expect(f.snapshot()).toBe(settled);
      }
    });
  }

  it('projects messages, values, and interrupts as one publication for a checkpoint', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    const seen: LangGraphSnapshot[] = [];
    f.session.subscribe(() => seen.push(f.snapshot()));
    await f.emit({
      type: 'checkpoints',
      data: checkpoint({
        count: 3,
        messages: [ai('Checkpoint')],
        __interrupt__: [{ id: 'approval', value: 0 }],
      }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      values: { count: 3 },
      interrupts: [{ id: 'approval', value: 0 }],
    });
    expect(seen[0].messages.at(-1)?.content).toBe('Checkpoint');
    f.streams[0].finish();
    expect(await run).toBe('paused');
  });

  it('keeps prior interrupts and values when message ownership rejects the same checkpoint', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(control([{ id: 'prior', value: false }]));
    const before = f.snapshot();
    await f.emit({
      type: 'checkpoints',
      data: checkpoint({
        count: 9,
        __interrupt__: [{ id: 'rejected' }],
        messages: [
          {
            ...ai('Invalid'),
            tool_calls: [{ id: 'invalid', name: 'work', args: new Date() }],
          },
        ],
      }),
    });
    expect(await run).toBe('interrupted');
    expect(f.snapshot().interrupts).toBe(before.interrupts);
    expect(f.snapshot().values).toBe(before.values);
    expect(f.snapshot().messages.map((message) => message.content)).toEqual(
      before.messages.map((message) => message.content)
    );
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  for (const invalid of ['instance', 'cycle', 'getter'] as const) {
    it(`commits no message/value/tool eligibility when interrupt ownership fails (${invalid})`, async () => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      const before = f.snapshot();
      const cycle: Record<string, unknown> = {};
      cycle['self'] = cycle;
      const item =
        invalid === 'getter'
          ? {
              get value() {
                throw new Error('private');
              },
            }
          : { value: invalid === 'cycle' ? cycle : new Date() };
      await f.emit({
        type: 'checkpoints',
        data: checkpoint({
          count: 9,
          __interrupt__: [item],
          messages: [
            {
              ...ai('Invalid'),
              tool_calls: [
                { id: 'bad-call', name: 'work', args: { input: 'bad' } },
              ],
            },
          ],
        }),
      });
      f.streams[0].finish();
      expect(await run).toBe('interrupted');
      expect(f.snapshot().status).toBe('error');
      expect(f.snapshot().values).toBe(before.values);
      expect(f.snapshot().interrupts).toBe(before.interrupts);
      expect(f.snapshot().messages.map((message) => message.content)).toEqual(
        before.messages.map((message) => message.content)
      );
      expect(f.snapshot().toolCalls).toEqual([]);
      expect(f.acquire).not.toHaveBeenCalled();
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
    });
  }

  for (const phase of ['live', 'load', 'recovery'] as const) {
    for (const action of ['stop', 'dispose', 'submit'] as const) {
      it(`a ${phase} interrupt getter cannot overwrite a nested ${action}`, async () => {
        const f = fixture();
        await seed(f);
        let run: Promise<unknown> | undefined;
        if (phase !== 'load') {
          run = f.session.submit('Go');
          await f.started();
        }
        const before = f.snapshot();
        let nested: Promise<unknown> | undefined;
        let fired = false;
        const item = {
          get value() {
            if (!fired) {
              fired = true;
              nested =
                action === 'submit'
                  ? f.session.submit('Replacement')
                  : f.session[action]();
            }
            return { secret: 'stale' };
          },
        };
        const data = {
          count: 9,
          __interrupt__: [item],
          messages: [ai('Stale')],
        };
        if (phase === 'load') {
          f.history.mockResolvedValueOnce([checkpoint(data)]);
          await f.session.load?.();
        } else if (phase === 'live') {
          await f.emit({ type: 'checkpoints', data: checkpoint(data) });
          f.streams[0].finish();
        } else {
          f.history.mockImplementationOnce(async () => [f.turn(data)]);
          f.streams[0].finish();
        }
        if (run)
          expect(await run).toBe(
            action === 'submit' ? 'interrupted' : 'aborted'
          );
        expect(fired).toBe(true);
        expect(f.snapshot().values).toBe(before.values);
        expect(f.snapshot().interrupts).toEqual(
          action === 'submit' ? [] : before.interrupts
        );
        expect(
          f
            .snapshot()
            .messages.some((message) =>
              ['Stale', 'Recovered'].includes(message.content)
            )
        ).toBe(false);
        if (action === 'submit') {
          await f.started(phase === 'load' ? 0 : 1);
          await f.session.stop();
        }
        await nested;
      });
    }
  }

  for (const mode of ['close', 'check'] as const) {
    it(`recovers correlated ${mode} history with an atomic paused checkpoint`, async () => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      if (mode === 'check') {
        f.streams[0].finish();
        expect(await run).toBe('interrupted');
      }
      f.history.mockImplementationOnce(async () => [
        f.turn({ count: 3, __interrupt__: [] }),
      ]);
      const seen: LangGraphSnapshot[] = [];
      f.session.subscribe(() => seen.push(f.snapshot()));
      if (mode === 'close') {
        f.streams[0].finish();
        expect(await run).toBe('paused');
      } else await f.session.checkStatus?.();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        status: 'idle',
        values: { count: 3 },
        interrupts: [{ when: 'breakpoint' }],
      });
      expect(seen[0].messages.at(-1)?.delivery).toMatchObject({
        outcome: 'paused',
      });
    });
  }

  it('retains exact interrupted state for unrelated and inconclusive checkpoints', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    f.streams[0].finish();
    expect(await run).toBe('interrupted');
    const before = f.snapshot();
    f.history.mockResolvedValueOnce([
      checkpoint({
        __interrupt__: [
          {
            get value() {
              throw new Error('must not project unrelated interrupts');
            },
          },
        ],
      }),
    ]);
    await f.session.checkStatus?.();
    expect(f.snapshot()).toBe(before);
    const user = (f.stream.mock.calls[0][2] as { messages: unknown[] })
      .messages[0];
    f.history.mockResolvedValueOnce([
      checkpoint({ messages: [user], count: 9 }, ['work']),
    ]);
    await f.session.checkStatus?.();
    expect(f.snapshot()).toBe(before);
  });

  for (const mode of ['load', 'close', 'check'] as const) {
    it(`retains prior candidates after a throwing ${mode} interrupt getter`, async () => {
      const f = fixture();
      await seed(f);
      let run: Promise<unknown> | undefined;
      if (mode !== 'load') {
        run = f.session.submit('Go');
        await f.started();
        if (mode === 'check') {
          f.streams[0].finish();
          expect(await run).toBe('interrupted');
        }
      }
      const before = f.snapshot();
      const data = {
        count: 9,
        __interrupt__: [
          {
            get value() {
              throw new Error('private payload');
            },
          },
        ],
      };
      f.history.mockImplementationOnce(async () => [
        mode === 'load' ? checkpoint(data) : f.turn(data),
      ]);
      if (mode === 'close') {
        f.streams[0].finish();
        expect(await run).toBe('interrupted');
      } else if (mode === 'load')
        await expect(f.session.load?.()).rejects.not.toThrow('private payload');
      else await expect(f.session.checkStatus?.()).rejects.toThrow();
      expect(f.snapshot().values).toBe(before.values);
      expect(f.snapshot().interrupts).toBe(before.interrupts);
      expect(f.snapshot().messages.map((message) => message.content)).toEqual(
        before.messages.map((message) => message.content)
      );
      if (mode !== 'close') expect(f.snapshot()).toBe(before);
    });
  }

  for (const action of ['submit', 'checkStatus'] as const) {
    it(`a status interrupt getter cannot clear a replacement ${action} owner`, async () => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      f.streams[0].finish();
      expect(await run).toBe('interrupted');
      const before = f.snapshot();
      let fired = false;
      let nested: Promise<unknown> | undefined;
      const replacement = deferred<ThreadState[]>();
      f.history.mockImplementationOnce(async () => [
        f.turn({
          __interrupt__: [
            {
              get value() {
                if (!fired) {
                  fired = true;
                  nested =
                    action === 'submit'
                      ? f.session.submit('Replacement')
                      : f.session.checkStatus?.();
                }
                return 'stale';
              },
            },
          ],
        }),
      ]);
      f.history.mockReturnValueOnce(replacement.promise);
      await f.session.checkStatus?.();
      expect(fired).toBe(true);
      expect(f.snapshot().interrupts).toBe(before.interrupts);
      expect(f.snapshot().values).toBe(before.values);
      if (action === 'submit') {
        await f.started(1);
        await f.session.stop();
      } else
        replacement.resolve([f.turn({ __interrupt__: [{ id: 'fresh' }] })]);
      await nested;
      if (action === 'checkStatus')
        expect(f.snapshot().interrupts).toEqual([{ id: 'fresh' }]);
    });
  }

  it('does not acknowledge a staged handoff after invalid interrupt projection', async () => {
    const f = fixture();
    const run = f.session.submit('Work');
    await f.started();
    await f.emit(
      full({
        messages: [
          {
            ...ai('Tool'),
            tool_calls: [
              { id: 'call', name: 'work', args: { input: 'result' } },
            ],
          },
        ],
      })
    );
    f.streams[0].finish();
    await f.started(1);
    const handoff = (f.stream.mock.calls[1][2] as { messages: unknown[] })
      .messages[0];
    await f.emit(
      {
        type: 'checkpoints',
        data: checkpoint({
          messages: [ai('Invalid')],
          __interrupt__: [{ value: new Date() }],
        }),
      },
      1
    );
    f.streams[1].finish();
    expect(await run).toBe('interrupted');
    expect(f.snapshot().status).toBe('error');
    const retry = f.session.submit('Again');
    await f.started(2);
    expect(
      (f.stream.mock.calls[2][2] as { messages: unknown[] }).messages[0]
    ).toEqual(handoff);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
    await f.session.stop();
    await retry;
  });

  it('keeps two session batches independent', async () => {
    const first = fixture();
    const second = fixture();
    await seed(first);
    expect(first.snapshot().interrupts).toHaveLength(1);
    expect(second.snapshot().interrupts).toEqual([]);
    await second.session.load?.();
    expect(first.snapshot().interrupts).toHaveLength(1);
  });

  for (const mode of ['load', 'close', 'check'] as const) {
    it(`projects ${mode} interrupt getters once and shares the candidate with message delivery`, async () => {
      const f = fixture();
      let run: Promise<unknown> | undefined;
      if (mode !== 'load') {
        run = f.session.submit('Go');
        await f.started();
        if (mode === 'check') {
          f.streams[0].finish();
          expect(await run).toBe('interrupted');
        }
      }
      let reads = 0;
      const data = {
        messages: [ai('Loaded')],
        get __interrupt__() {
          reads += 1;
          return [{ id: 'once', value: false }];
        },
      };
      f.history.mockImplementationOnce(async () => [
        mode === 'load' ? checkpoint(data) : f.turn(data),
      ]);
      if (mode === 'close') {
        f.streams[0].finish();
        expect(await run).toBe('paused');
      } else if (mode === 'load') await f.session.load?.();
      else await f.session.checkStatus?.();
      expect(reads).toBe(1);
      expect(f.snapshot().interrupts).toEqual([{ id: 'once', value: false }]);
      expect(f.snapshot().messages.at(-1)?.delivery).toMatchObject({
        outcome: 'paused',
      });
    });
  }

  it('a pause with finalized pending tools never claims, executes, persists or continues them', async () => {
    const f = fixture();
    const run = f.session.submit('Work');
    await f.started();
    await f.emit(
      full({
        __interrupt__: [],
        messages: [
          {
            ...ai('Waiting'),
            tool_calls: [
              { id: 'pending', name: 'work', args: { input: 'later' } },
            ],
          },
        ],
      })
    );
    f.streams[0].finish();
    expect(await run).toBe('paused');
    expect(f.snapshot().toolCalls).toMatchObject([
      { id: 'pending', status: 'pending' },
    ]);
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.stream).toHaveBeenCalledTimes(1);
  });
});
