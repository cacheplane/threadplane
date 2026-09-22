import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

function state(messages: unknown[] = [], paused = false): ThreadState {
  return {
    values: { messages } as ThreadState['values'],
    next: paused ? ['ask'] : [],
    tasks: paused
      ? [
          {
            id: 'task',
            name: 'ask',
            error: null,
            interrupts: [{ value: 'continue?' }],
            checkpoint: null,
            state: null,
            result: null,
          },
        ]
      : [],
    checkpoint: {
      checkpoint_id: 'after',
      thread_id: 't',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
    metadata: null,
    created_at: null,
    parent_checkpoint: null,
  };
}
function setup() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 3 }, () => deferred<void>());
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
    const next = controlledTransport<StreamEvent>({ signal });
    streams.push(next);
    starts[streams.length - 1].resolve();
    return next.stream;
  });
  const history = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory: history },
  });
  return {
    session,
    stream,
    history,
    streams,
    started: (index = 0) => starts[index].promise,
    turnState: (messages: unknown[] = [], paused = false) =>
      state(
        [
          stream.mock.calls.at(-1)?.[2] &&
            (stream.mock.calls.at(-1)?.[2] as { messages: unknown[] })
              .messages[0],
          ...messages,
        ],
        paused
      ),
  };
}
const committed = { id: 'committed', type: 'ai', content: 'finished remotely' };

describe('neutral session read-only recovery', () => {
  it('only exposes checkStatus with history and reads/observes/checks without issuing runs', async () => {
    const f = setup();
    expect(f.history).not.toHaveBeenCalled();
    expect(f.session.checkStatus).toBeTypeOf('function');
    f.session.getSnapshot();
    const off = f.session.subscribe(() => undefined);
    off();
    await f.session.checkStatus?.();
    expect(f.stream).not.toHaveBeenCalled();
    const noHistory = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream: f.stream },
    });
    expect(noHistory.checkStatus).toBeUndefined();
    await noHistory.dispose();
    await f.session.dispose();
  });

  it.each(['eof', 'abort', 'network'] as const)(
    'never infers safe retry from absent first bytes: %s',
    async (mode) => {
      const stream = vi.fn<AgentTransport['stream']>(() => ({
        async *[Symbol.asyncIterator]() {
          if (mode === 'abort')
            throw Object.assign(new Error('reset'), { name: 'AbortError' });
          if (mode === 'network') throw new TypeError('fetch failed');
          yield* [];
        },
      }));
      const session = createSession({
        assistantId: 'a',
        threadId: 't',
        transport: { stream },
      });
      expect(await session.submit('hello')).toBe('interrupted');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'interrupted',
        retryable: false,
        recovery: 'none',
      });
      expect(stream).toHaveBeenCalledTimes(1);
      await session.dispose();
    }
  );

  it.each(['committed', 'paused'] as const)(
    'rescues a closed stream from conclusive %s history atomically',
    async (mode) => {
      const f = setup();
      f.history.mockImplementation(async () => [
        f.turnState(mode === 'committed' ? [committed] : [], mode === 'paused'),
      ]);
      const snapshots: ReturnType<typeof f.session.getSnapshot>[] = [];
      f.session.subscribe(() => snapshots.push(f.session.getSnapshot()));
      const run = f.session.submit('hello');
      await f.started();
      f.streams[0].finish();
      expect(await run).toBe(mode === 'committed' ? 'success' : 'paused');
      expect(f.session.getSnapshot()).toMatchObject({
        status: 'idle',
        error: undefined,
      });
      if (mode === 'committed')
        expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
          content: committed.content,
          delivery: { outcome: 'success' },
        });
      expect(snapshots.filter((s) => s.status === 'idle')).toHaveLength(1);
      expect(f.stream).toHaveBeenCalledTimes(1);
      await f.session.dispose();
    }
  );

  it('retains the original interrupted aggregate on inconclusive or failed checks and recovers on a later check', async () => {
    const f = setup();
    const run = f.session.submit('hello');
    await f.started();
    f.streams[0].finish();
    expect(await run).toBe('interrupted');
    const original = f.session.getSnapshot();
    expect(original.error).toMatchObject({
      kind: 'interrupted',
      retryable: false,
      recovery: 'check',
    });
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toBe(original);
    f.history.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(f.session.checkStatus?.()).rejects.toThrow();
    expect(f.session.getSnapshot()).toBe(original);
    f.history.mockResolvedValueOnce([f.turnState([committed])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.stream).toHaveBeenCalledTimes(1);
    await f.session.dispose();
  });

  it('ignores failed close-time history and does not mistake the optimistic echo for completion', async () => {
    const f = setup();
    f.history.mockRejectedValueOnce(new Error('history failed'));
    const first = f.session.submit('hello');
    await f.started();
    f.streams[0].finish();
    expect(await first).toBe('interrupted');
    const second = f.session.submit('same');
    await f.started(1);
    f.history.mockResolvedValueOnce([
      state(
        f.session
          .getSnapshot()
          .messages.filter((m) => m.role === 'user')
          .map((m) => ({ ...m, type: 'human' }))
      ),
    ]);
    f.streams[1].finish();
    expect(await second).toBe('interrupted');
    await f.session.dispose();
  });

  it.each(['stop', 'dispose', 'submit'] as const)(
    'settles locally during noncooperative close history on %s and ignores late answers',
    async (action) => {
      const f = setup();
      const read = deferred<ThreadState[]>();
      const started = deferred<void>();
      f.history.mockImplementationOnce(() => {
        started.resolve();
        return read.promise;
      });
      const run = f.session.submit('hello');
      await f.started();
      f.streams[0].finish();
      await started.promise;
      let newer: Promise<unknown> | undefined;
      if (action === 'submit') newer = f.session.submit('new');
      else await f.session[action]();
      expect(await run).toBe(action === 'submit' ? 'interrupted' : 'aborted');
      const stable = f.session.getSnapshot();
      read.resolve([f.turnState([committed])]);
      await read.promise;
      expect(f.session.getSnapshot()).toBe(stable);
      if (newer) {
        await f.session.stop();
        await newer;
      }
      await f.session.dispose();
    }
  );

  it.each(['stop', 'dispose', 'submit'] as const)(
    'ignores an explicit check overtaken by %s',
    async (action) => {
      const f = setup();
      const run = f.session.submit('hello');
      await f.started();
      f.streams[0].finish();
      await run;
      const read = deferred<ThreadState[]>();
      const checkingStarted = deferred<void>();
      f.history.mockImplementationOnce(() => {
        checkingStarted.resolve();
        return read.promise;
      });
      const checking = f.session.checkStatus?.();
      await checkingStarted.promise;
      let newer: Promise<unknown> | undefined;
      if (action === 'submit') newer = f.session.submit('new');
      else await f.session[action]();
      const stable = f.session.getSnapshot();
      read.resolve([f.turnState([committed])]);
      await checking;
      expect(f.session.getSnapshot()).toBe(stable);
      if (newer) {
        await f.session.stop();
        await newer;
      }
      await f.session.dispose();
    }
  );

  it('rejects checkStatus during execution and after disposal', async () => {
    const f = setup();
    const run = f.session.submit('hello');
    await expect(f.session.checkStatus?.()).rejects.toThrow('active');
    await f.session.dispose();
    expect(await run).toBe('aborted');
    await expect(f.session.checkStatus?.()).rejects.toThrow('disposed');
    expect(f.history).not.toHaveBeenCalled();
  });

  it('does not let a recovered publication clear a run submitted by an observer', async () => {
    const f = setup();
    const first = f.session.submit('hello');
    await f.started();
    f.streams[0].finish();
    await first;
    let next: Promise<unknown> | undefined;
    f.session.subscribe(() => {
      if (!next && f.session.getSnapshot().status === 'idle')
        next = f.session.submit('new');
    });
    f.history.mockResolvedValueOnce([f.turnState([committed])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot().status).toBe('running');
    expect(f.stream).toHaveBeenCalledTimes(2);
    await f.session.stop();
    await next;
    await f.session.dispose();
  });

  it.each(['old answer', 'old pause'] as const)(
    'does not claim a new request completed from an uncorrelated %s',
    async (kind) => {
      const f = setup();
      f.history.mockResolvedValue([state([committed], kind === 'old pause')]);
      const run = f.session.submit('new request');
      await f.started();
      f.streams[0].finish();
      expect(await run).toBe('interrupted');
      expect(f.session.getSnapshot().messages).toHaveLength(1);
      await f.session.checkStatus?.();
      expect(f.session.getSnapshot().status).toBe('error');
      await f.session.dispose();
    }
  );

  it('recovers a persisted final message sharing the streamed partial ID when the submitted turn is correlated', async () => {
    const f = setup();
    const run = f.session.submit('hello');
    await f.started();
    f.streams[0].release({
      type: 'messages',
      messageMetadata: {},
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'answer',
          content: 'draft longer than final',
        },
      ],
    });
    f.history.mockImplementation(async () => [
      f.turnState([{ type: 'ai', id: 'answer', content: 'final' }]),
    ]);
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'answer',
      content: 'final',
      delivery: { outcome: 'success' },
    });
    await f.session.dispose();
  });

  it('keeps the recovery action usable after stop on an interrupted session', async () => {
    const f = setup();
    const run = f.session.submit('hello');
    await f.started();
    f.streams[0].finish();
    await run;
    await f.session.stop();
    f.history.mockResolvedValueOnce([f.turnState([committed])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.stream).toHaveBeenCalledTimes(1);
    await f.session.dispose();
  });
});
