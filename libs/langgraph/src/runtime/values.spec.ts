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
    const controlled = controlledTransport<StreamEvent>({ signal });
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
        return controlled.stream.return();
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
  const claim = vi.fn(async () => 'claimed' as const);
  const record = vi.fn(async () => undefined);
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory: history, updateState: write },
    executionStore: { claim, record },
    tools: { work: { description: 'Work', handler } },
  });
  const f = {
    session,
    streams,
    stream,
    history,
    write,
    handler,
    claim,
    record,
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
      stable: { nested: ['owned'] },
    }),
  ]);
  await f.session.load?.();
}
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (f) => {
      await f.session.dispose();
      f.streams.forEach((stream) => stream.finish());
    })
  );
});

describe('session application values', () => {
  it('starts unobserved and publishes values-only changes in one coherent aggregate', async () => {
    const f = fixture();
    expect(f.snapshot()).toHaveProperty('values', undefined);
    const run = f.session.submit('Go');
    await f.started();
    const observed: LangGraphSnapshot[] = [];
    f.session.subscribe(() => observed.push(f.snapshot()));
    await f.emit(
      full({
        messages: [ai('First')],
        count: 1,
        removed: true,
        stable: { x: 1 },
      })
    );
    expect(observed).toHaveLength(1);
    expect(observed[0].values).toEqual({
      count: 1,
      removed: true,
      stable: { x: 1 },
    });
    expect(observed[0].messages.at(-1)?.content).toBe('First');
    const first = f.snapshot();
    await f.emit(full({ count: 2, stable: { x: 1 } }));
    expect(observed).toHaveLength(2);
    expect(f.snapshot().messages).toBe(first.messages);
    expect(f.snapshot().values).toEqual({ count: 2, stable: { x: 1 } });
    expect(f.snapshot().values?.['stable']).toBe(first.values?.['stable']);
    const same = f.snapshot();
    await f.emit(full({ count: 2, stable: { x: 1 } }));
    expect(f.snapshot()).toBe(same);
    expect(observed).toHaveLength(2);
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  it('retains values through tokens, ignored envelopes, stop, failure and disposal', async () => {
    const f = fixture();
    await seed(f);
    const values = f.snapshot().values;
    const run = f.session.submit('Go');
    await f.started();
    expect(f.snapshot().values).toBe(values);
    for (const event of [
      {
        type: 'messages',
        messages: [{ type: 'AIMessageChunk', id: 'partial', content: 'Token' }],
        messageMetadata: {},
      },
      full({ __interrupt__: [] }),
      { type: 'updates', data: { node: { changed: true } } },
      { type: 'custom', data: { changed: true } },
      { type: 'values', namespace: ['child'], data: { changed: true } },
      { type: 'values|child', data: { changed: true } },
    ] satisfies StreamEvent[]) {
      await f.emit(event);
      expect(f.snapshot().values).toBe(values);
    }
    await f.session.stop();
    expect(await run).toBe('aborted');
    const failed = f.session.submit('Fail');
    await f.started(1);
    await f.emit({ type: 'error', data: { message: 'Unavailable' } }, 1);
    expect(await failed).toBe('error');
    expect(f.snapshot().values).toBe(values);
    await f.session.dispose();
    expect(f.snapshot().values).toBe(values);
  });

  it('uses root checkpoints authoritatively even with interrupt metadata', async () => {
    const f = fixture();
    await seed(f);
    const run = f.session.submit('Go');
    await f.started();
    await f.emit({
      type: 'checkpoints',
      data: {
        values: { count: 2, __interrupt__: [], messages: [ai('Checkpoint')] },
      },
    });
    expect(f.snapshot().values).toEqual({ count: 2 });
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  for (const [label, invalid] of [
    ['nested instance', () => ({ bad: new Date(0) })],
    [
      'root instance',
      () => Object.assign(new Date(0), { messages: [ai('Invalid')] }),
    ],
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {};
        value['self'] = value;
        return value;
      },
    ],
    [
      'throwing getter',
      () => ({
        get bad() {
          throw new Error('PRIVATE');
        },
      }),
    ],
  ] as const) {
    it(`rejects ${label} without committing candidate messages, tools or values`, async () => {
      const f = fixture();
      await seed(f);
      const run = f.session.submit('Go');
      await f.started();
      const prior = f.snapshot();
      const input = invalid();
      Object.defineProperty(input, 'messages', {
        value: [
          {
            ...ai('Invalid', 'rejected-message'),
            tool_calls: [
              { id: 'bad-call', name: 'work', args: { input: 'bad' } },
            ],
          },
        ],
        enumerable: true,
        configurable: true,
      });
      await f.emit(full(input));
      expect(f.snapshot().messages.map((message) => message.content)).toEqual(
        prior.messages.map((message) => message.content)
      );
      expect(f.snapshot().values).toBe(prior.values);
      expect(f.snapshot().toolCalls).toBe(prior.toolCalls);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
      expect(f.stream).toHaveBeenCalledTimes(1);
      await run;
      // Reconciliation must not resurrect the rejected event's canonical
      // message or tool eligibility from a partially committed projection.
      f.history.mockImplementationOnce(async () => [
        f.turn({ recovered: true }),
      ]);
      await f.session.checkStatus?.();
      expect(
        f
          .snapshot()
          .messages.some((message) => message.id === 'rejected-message')
      ).toBe(false);
      expect(f.snapshot().toolCalls).toEqual([]);
      expect(f.handler).not.toHaveBeenCalled();
    });
  }

  it('does not commit values when message ownership fails first', async () => {
    const f = fixture();
    await seed(f);
    const prior = f.snapshot();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(
      full({
        count: 9,
        messages: [
          {
            ...ai('Bad'),
            tool_calls: [{ id: 'bad', name: 'work', args: new Date(0) }],
          },
        ],
      })
    );
    await run;
    expect(f.snapshot().values).toBe(prior.values);
    expect(
      f.snapshot().messages.some((message) => message.content === 'Bad')
    ).toBe(false);
  });

  for (const action of ['stop', 'submit', 'dispose'] as const) {
    it(`discards live candidates when a values getter invokes ${action}`, async () => {
      const f = fixture();
      await seed(f);
      const prior = f.snapshot().values;
      const run = f.session.submit('Old');
      await f.started();
      let fired = false;
      let nested: Promise<unknown> | undefined;
      const data = {
        messages: [ai('Stale')],
        get count() {
          if (!fired) {
            fired = true;
            nested =
              action === 'submit'
                ? f.session.submit('New')
                : f.session[action]();
          }
          return 9;
        },
      };
      await f.emit(full(data));
      expect(fired).toBe(true);
      await run;
      expect(f.snapshot().values).toBe(prior);
      expect(
        f.snapshot().messages.some((message) => message.content === 'Stale')
      ).toBe(false);
      if (action === 'submit') {
        await f.started(1);
        await f.session.stop();
      }
      await nested;
      expect(f.stream).toHaveBeenCalledTimes(action === 'submit' ? 2 : 1);
    });
  }

  it('loads coherent state, preserves equal identity, retains failed reads and clears empty history', async () => {
    const f = fixture();
    await seed(f);
    const before = f.snapshot();
    const changed = vi.fn();
    f.session.subscribe(changed);
    await seed(f);
    expect(f.snapshot()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    f.history.mockRejectedValueOnce(new Error('PRIVATE'));
    await expect(f.session.load?.()).rejects.toThrow();
    expect(f.snapshot()).toBe(before);
    f.history.mockResolvedValueOnce([
      checkpoint({ count: new Map(), messages: [ai('Invalid load')] }),
    ]);
    await expect(f.session.load?.()).rejects.toThrow();
    expect(f.snapshot()).toBe(before);
    const pending = deferred<ThreadState[]>();
    f.history.mockReturnValueOnce(pending.promise);
    const stale = f.session.load?.();
    await Promise.resolve();
    await f.session.stop();
    await stale;
    pending.resolve([checkpoint({ count: 99, messages: [ai('Stale load')] })]);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.snapshot()).toBe(before);
    await f.session.load?.();
    expect(f.snapshot().values).toBeUndefined();
    expect(f.snapshot().messages).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('guards load candidates after a values getter submits a new request', async () => {
    const f = fixture();
    await seed(f);
    const prior = f.snapshot().values;
    let run: Promise<unknown> | undefined;
    f.history.mockResolvedValueOnce([
      checkpoint({
        messages: [ai('Stale load')],
        get count() {
          run ??= f.session.submit('New');
          return 9;
        },
      }),
    ]);
    await f.session.load?.();
    expect(run).toBeDefined();
    await f.started();
    expect(f.snapshot().values).toBe(prior);
    expect(
      f.snapshot().messages.some((message) => message.content === 'Stale load')
    ).toBe(false);
    await f.session.stop();
    await run;
  });

  for (const mode of ['close', 'check'] as const) {
    it(`recovers correlated ${mode} history atomically with checkpoint values`, async () => {
      const f = fixture();
      await seed(f);
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
        expect(await run).toBe('success');
      } else await f.session.checkStatus?.();
      expect(f.snapshot().values).toEqual({ count: 3 });
      expect(f.snapshot().messages.at(-1)?.content).toBe('Recovered');
      expect(
        seen.every(
          (snapshot) =>
            snapshot.messages.at(-1)?.content !== 'Recovered' ||
            snapshot.values?.['count'] === 3
        )
      ).toBe(true);
    });
  }

  it('does not change values from unrelated or inconclusive recovery checkpoints', async () => {
    const f = fixture();
    await seed(f);
    const prior = f.snapshot().values;
    const run = f.session.submit('Go');
    await f.started();
    f.history.mockResolvedValueOnce([
      checkpoint({ count: 8, messages: [ai('Unrelated')] }),
    ]);
    f.streams[0].finish();
    expect(await run).toBe('interrupted');
    const interrupted = f.snapshot();
    const inconclusive = f.turn({ count: 8 });
    inconclusive.next = ['still-running'];
    f.history.mockResolvedValueOnce([inconclusive]);
    await f.session.checkStatus?.();
    expect(f.snapshot()).toBe(interrupted);
    expect(f.snapshot().values).toBe(prior);
  });

  for (const action of ['stop', 'submit', 'dispose'] as const) {
    it(`discards close-time recovery candidates after a getter invokes ${action}`, async () => {
      const f = fixture();
      await seed(f);
      const prior = f.snapshot().values;
      const run = f.session.submit('Old');
      await f.started();
      let nested: Promise<unknown> | undefined;
      let fired = false;
      f.history.mockImplementationOnce(async () => [
        f.turn({
          get count() {
            if (!fired) {
              fired = true;
              nested =
                action === 'submit'
                  ? f.session.submit('New')
                  : f.session[action]();
            }
            return 9;
          },
        }),
      ]);
      f.streams[0].finish();
      expect(await run).toBe(action === 'submit' ? 'interrupted' : 'aborted');
      expect(fired).toBe(true);
      expect(f.snapshot().values).toBe(prior);
      expect(
        f.snapshot().messages.some((message) => message.content === 'Recovered')
      ).toBe(false);
      if (action === 'submit') {
        await f.started(1);
        await f.session.stop();
      }
      await nested;
    });
  }

  for (const mode of ['close', 'check'] as const) {
    it(`preserves prior candidates when ${mode} recovery values ownership fails`, async () => {
      const f = fixture();
      await seed(f);
      const run = f.session.submit('Old');
      await f.started();
      if (mode === 'check') {
        f.streams[0].finish();
        expect(await run).toBe('interrupted');
      }
      const before = f.snapshot();
      f.history.mockImplementationOnce(async () => [
        f.turn({ invalid: new Date(0) }),
      ]);
      if (mode === 'close') {
        f.streams[0].finish();
        expect(await run).toBe('interrupted');
      } else await expect(f.session.checkStatus?.()).rejects.toThrow(TypeError);
      expect(f.snapshot().values).toBe(before.values);
      expect(f.snapshot().messages.map((message) => message.content)).toEqual(
        before.messages.map((message) => message.content)
      );
      if (mode === 'check') expect(f.snapshot()).toBe(before);
      f.history.mockImplementationOnce(async () => [
        f.turn({ recovered: true }),
      ]);
      await f.session.checkStatus?.();
      expect(f.snapshot().values).toEqual({ recovered: true });
    });
  }

  it('does not acknowledge a staged handoff on invalid values or unrelated continuation recovery', async () => {
    const f = fixture();
    await seed(f);
    const run = f.session.submit('Work');
    await f.started();
    await f.emit(
      full({
        messages: [
          {
            ...ai('Tool'),
            tool_calls: [
              { id: 'work-call', name: 'work', args: { input: 'result' } },
            ],
          },
        ],
      })
    );
    f.streams[0].finish();
    await f.started(1);
    // The earlier tool-producing checkpoint lacks this continuation's exact
    // ToolMessage handoff, so its values cannot recover the continuation.
    f.history.mockImplementationOnce(async () => [
      f.turn({ wrong: 'earlier step' }),
    ]);
    f.streams[1].finish();
    expect(await run).toBe('interrupted');
    expect(f.snapshot().values).toEqual({});
    const handoff = (f.stream.mock.calls[1][2] as { messages: unknown[] })
      .messages[0];
    const invalid = f.session.submit('Retry');
    await f.started(2);
    await f.emit(full({ messages: [ai('Invalid')], bad: new Date(0) }), 2);
    await invalid;
    const retry = f.session.submit('Again');
    await f.started(3);
    expect(
      (f.stream.mock.calls[2][2] as { messages: unknown[] }).messages[0]
    ).toEqual(handoff);
    expect(
      (f.stream.mock.calls[3][2] as { messages: unknown[] }).messages[0]
    ).toEqual(handoff);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
    await f.session.stop();
    await retry;
  });

  for (const action of ['submit', 'checkStatus'] as const) {
    it(`an older recovery getter cannot clear a replacement ${action} owner`, async () => {
      const f = fixture();
      await seed(f);
      const run = f.session.submit('Old');
      await f.started();
      f.streams[0].finish();
      expect(await run).toBe('interrupted');
      const prior = f.snapshot();
      let fired = false;
      let nested: Promise<unknown> | undefined;
      const replacement = deferred<ThreadState[]>();
      f.history.mockImplementationOnce(async () => [
        f.turn({
          get count() {
            if (!fired) {
              fired = true;
              nested =
                action === 'submit'
                  ? f.session.submit('New')
                  : f.session.checkStatus?.();
            }
            return 9;
          },
        }),
      ]);
      f.history.mockReturnValueOnce(replacement.promise);
      await f.session.checkStatus?.();
      expect(f.snapshot().values).toBe(prior.values);
      expect(
        f.snapshot().messages.some((message) => message.content === 'Recovered')
      ).toBe(false);
      if (action === 'submit') {
        await f.started(1);
        await f.session.stop();
      } else {
        replacement.resolve([f.turn({ count: 4 })]);
      }
      await nested;
      if (action === 'checkStatus')
        expect(f.snapshot().values).toEqual({ count: 4 });
    });
  }

  it('keeps independent values for two sessions', async () => {
    const first = fixture();
    const second = fixture();
    await seed(first);
    expect(second.snapshot()).toHaveProperty('values', undefined);
    second.history.mockResolvedValueOnce([checkpoint({ other: 2 })]);
    await second.session.load?.();
    expect(second.snapshot().values).toEqual({ other: 2 });
    expect(first.snapshot().values?.['count']).toBe(1);
  });
});
