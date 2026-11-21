import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const answer = (id = 'answer', content = 'Done'): StreamEvent => ({
  type: 'values',
  data: { messages: [{ type: 'ai', id, content }] },
});
const pause: StreamEvent = {
  type: 'values',
  data: { __interrupt__: [{ id: 'ask', value: 'Approve?' }] },
};

function fixture(extra: Partial<AgentTransport> = {}, events = [answer()]) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield* events;
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, ...extra },
  });
  sessions.push(session);
  return { session, stream };
}

describe('run settings', () => {
  it('passes each setting to the run request beside config, context and metadata', async () => {
    const { session, stream } = fixture();
    const run = {
      multitaskStrategy: 'interrupt',
      interruptBefore: ['review'],
      interruptAfter: '*',
      streamMode: ['debug'],
      streamSubgraphs: true,
      durability: 'sync',
      checkpointDuring: true,
      onCompletion: 'continue',
      onDisconnect: 'cancel',
      webhook: 'https://example.test/hook',
      afterSeconds: 5,
      ifNotExists: 'create',
      feedbackKeys: ['quality'],
    } as const;
    expect(await session.submit('Go', { context: { a: 1 }, run })).toBe(
      'success'
    );
    expect(stream.mock.calls[0][4]).toEqual({ context: { a: 1 }, ...run });
    // Nothing carries over to the next command.
    await session.submit('Again');
    expect(stream.mock.calls[1][4]).toBeUndefined();
  });

  it('owns the settings, so later changes by the caller have no effect', async () => {
    const { session, stream } = fixture();
    const interruptBefore = ['review'];
    const pending = session.submit('Go', { run: { interruptBefore } });
    interruptBefore.push('other');
    await pending;
    expect(stream.mock.calls[0][4]?.interruptBefore).toEqual(['review']);
  });

  it.each([
    { command: { resume: true } },
    { command: [] },
    { checkpointId: '' },
    { checkpoint: {} },
    { onRunCreated: 'no' },
    { webhook: new Date() },
  ])('rejects %j before any request', async (run) => {
    const { session, stream } = fixture();
    const before = session.getSnapshot();
    await expect(
      session.submit('Go', { run: run as never })
    ).rejects.toBeInstanceOf(TypeError);
    expect(session.getSnapshot()).toBe(before);
    expect(stream).not.toHaveBeenCalled();
  });

  it("keeps the modes and callbacks the session needs and adds the caller's", async () => {
    const created = vi.fn(() => {
      throw new Error('ignored');
    });
    const { session, stream } = fixture({
      stream: vi.fn<AgentTransport['stream']>(async function* (
        _assistant,
        _thread,
        _payload,
        _signal,
        options
      ) {
        options?.onRunCreated?.({ run_id: 'run-1', thread_id: 'thread' });
        yield answer();
      }),
      joinStream: async function* () {
        /* never joined */
      },
      getRunStatus: async () => 'success',
    });
    void stream;
    expect(
      await session.submit('Go', {
        run: { onRunCreated: created, streamMode: ['debug'] },
      })
    ).toBe('success');
    expect(created).toHaveBeenCalledWith({
      run_id: 'run-1',
      thread_id: 'thread',
    });
  });

  it('sends a state update with the answer to a pause', async () => {
    const { session, stream } = fixture({}, [pause]);
    expect(await session.submit('Go')).toBe('paused');
    await session.resume(
      [{ interruptId: 'ask', status: 'resolved', value: 'yes' }],
      { run: { command: { update: { approved: true }, goto: 'publish' } } }
    );
    expect(stream.mock.calls[1][2]).toBeNull();
    expect(stream.mock.calls[1][4]?.command).toEqual({
      update: { approved: true },
      goto: 'publish',
      resume: 'yes',
    });
  });
});

describe('a run with no input', () => {
  it('continues the graph without adding a user message', async () => {
    const { session, stream } = fixture();
    await session.submit('Hi');
    const before = session.getSnapshot().messages;
    stream.mockImplementationOnce(async function* () {
      yield answer('second', 'More');
    });
    expect(await session.submit(null)).toBe('success');
    expect(stream.mock.calls[1][2]).toBeNull();
    expect(stream.mock.calls[1][4]).toBeUndefined();
    const { messages } = session.getSnapshot();
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(
      1
    );
    expect(messages.slice(0, before.length).map((m) => m.id)).toEqual(
      before.map((m) => m.id)
    );
    expect(messages.at(-1)).toMatchObject({ id: 'second', content: 'More' });
  });

  it('carries a command and does not count as answering a pause', async () => {
    const { session, stream } = fixture();
    expect(
      await session.submit(undefined, {
        run: { command: { goto: 'agent', update: { topic: 'x' } } },
      })
    ).toBe('success');
    expect(stream.mock.calls[0][2]).toBeNull();
    expect(stream.mock.calls[0][4]).toEqual({
      command: { goto: 'agent', update: { topic: 'x' } },
    });
    expect(session.lifecycle.getSnapshot().interruptResolvedAt).toBeNull();
  });
});

describe('a run from a checkpoint', () => {
  const saved = (id: string, messages: unknown[]): ThreadState =>
    ({
      values: { messages },
      next: [],
      tasks: [],
      checkpoint: { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: id },
      parent_checkpoint: null,
    } as unknown as ThreadState);
  const user = { type: 'human', id: 'u1', content: 'Hi' };
  const first = { type: 'ai', id: 'a1', content: 'Hello' };
  const later = [
    user,
    first,
    { type: 'human', id: 'u2', content: 'More' },
    { type: 'ai', id: 'a2', content: 'Sure' },
  ];

  it('rewinds the transcript to a checkpoint whose state is loaded', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield answer('a3', 'A different turn');
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      historyState: true,
      transport: {
        stream,
        getHistory: async () => [
          saved('c2', later),
          saved('c1', [user, first]),
        ],
      },
    });
    sessions.push(session);
    await session.load?.();
    expect(session.getSnapshot().messages).toHaveLength(4);
    expect(
      await session.submit('Instead', { run: { checkpointId: 'c1' } })
    ).toBe('success');
    expect(stream.mock.calls[0][4]).toMatchObject({ checkpointId: 'c1' });
    expect(session.getSnapshot().messages.map((m) => m.content)).toEqual([
      'Hi',
      'Hello',
      'Instead',
      'A different turn',
    ]);
  });

  it('loads the saved branch afterwards when the checkpoint is not loaded', async () => {
    const history = [saved('c2', later)];
    const getHistory = vi.fn(async () => history);
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: {
        async *stream() {
          yield answer('a3', 'A different turn');
        },
        getHistory,
      },
    });
    sessions.push(session);
    await session.load?.();
    history.splice(
      0,
      1,
      saved('c3', [
        user,
        first,
        { type: 'ai', id: 'a3', content: 'A different turn' },
      ])
    );
    expect(
      await session.submit(null, {
        run: {
          checkpoint: { checkpoint_id: 'c1', checkpoint_ns: '' },
        },
      })
    ).toBe('success');
    await vi.waitFor(() =>
      expect(session.getSnapshot().messages.map((m) => m.id)).toEqual([
        'u1',
        'a1',
        'a3',
      ])
    );
    expect(getHistory).toHaveBeenCalledTimes(2);
  });
});

describe('queued runs', () => {
  function queueFixture(extra: Partial<AgentTransport> = {}) {
    const active = controlledTransport<StreamEvent>();
    const joined = controlledTransport<StreamEvent>();
    const stream = vi.fn<AgentTransport['stream']>(() => active.stream);
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      () => joined.stream
    );
    let next = 0;
    const createQueuedRun = vi.fn<
      NonNullable<AgentTransport['createQueuedRun']>
    >(async (_assistant, threadId, values) => ({
      id: `queued-${(next += 1)}`,
      threadId,
      values,
      createdAt: new Date(),
    }));
    const cancelRun = vi.fn<NonNullable<AgentTransport['cancelRun']>>(
      async () => undefined
    );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream, joinStream, createQueuedRun, cancelRun, ...extra },
    });
    sessions.push(session);
    return {
      session,
      active,
      joined,
      stream,
      joinStream,
      createQueuedRun,
      cancelRun,
    };
  }
  const enqueue = { run: { multitaskStrategy: 'enqueue' } } as const;

  it('queues a run during another, then joins it and resolves with its outcome', async () => {
    const f = queueFixture();
    const created = vi.fn();
    const first = f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const second = f.session.submit('Two', {
      metadata: { source: 'ui' },
      run: { ...enqueue.run, onRunCreated: created },
    });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().queue).toHaveLength(1)
    );
    expect(f.session.getSnapshot().queue?.[0]).toMatchObject({
      id: 'queued-1',
      message: 'Two',
    });
    expect(created).toHaveBeenCalledWith({
      run_id: 'queued-1',
      thread_id: 'thread',
    });
    const [, , payload, , options] = f.createQueuedRun.mock.calls[0];
    expect(payload).toMatchObject({
      messages: [{ type: 'human', content: 'Two' }],
    });
    expect(options).toMatchObject({
      metadata: { source: 'ui' },
      multitaskStrategy: 'enqueue',
    });
    // The queued message is not in the transcript until its run is joined.
    expect(
      f.session.getSnapshot().messages.map((message) => message.content)
    ).toEqual(['One']);
    expect(f.session.getSnapshot().status).toBe('running');
    f.active.release(answer('a1', 'First'));
    f.active.finish();
    expect(await first).toBe('success');
    await vi.waitFor(() => expect(f.joinStream).toHaveBeenCalled());
    expect(f.joinStream.mock.calls[0].slice(0, 3)).toEqual([
      'thread',
      'queued-1',
      undefined,
    ]);
    expect('queue' in f.session.getSnapshot()).toBe(false);
    expect(f.session.getSnapshot().status).toBe('running');
    f.joined.release({
      type: 'values',
      data: {
        messages: [
          { type: 'ai', id: 'a1', content: 'First' },
          payload && (payload as { messages: unknown[] }).messages[0],
          { type: 'ai', id: 'a2', content: 'Second' },
        ],
      },
    });
    f.joined.finish();
    expect(await second).toBe('success');
    expect(
      f.session.getSnapshot().messages.map((message) => message.content)
    ).toEqual(['One', 'First', 'Two', 'Second']);
    expect(f.session.getSnapshot().status).toBe('idle');
  });

  it('cancels one queued run and clears the rest', async () => {
    const f = queueFixture();
    void f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const second = f.session.submit('Two', enqueue);
    const third = f.session.submit('Three', enqueue);
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().queue).toHaveLength(2)
    );
    expect(await f.session.cancelQueued('missing')).toBe(false);
    expect(await f.session.cancelQueued('queued-1')).toBe(true);
    expect(await second).toBe('aborted');
    expect(f.cancelRun.mock.calls[0].slice(0, 2)).toEqual([
      'thread',
      'queued-1',
    ]);
    expect(f.session.getSnapshot().queue?.map((entry) => entry.id)).toEqual([
      'queued-2',
    ]);
    await f.session.clearQueue();
    expect(await third).toBe('aborted');
    expect('queue' in f.session.getSnapshot()).toBe(false);
    expect(f.cancelRun).toHaveBeenCalledTimes(2);
    expect(f.session.getSnapshot().status).toBe('running');
  });

  it('drops and cancels the queue on stop', async () => {
    const f = queueFixture();
    const first = f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const second = f.session.submit('Two', enqueue);
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().queue).toHaveLength(1)
    );
    await f.session.stop();
    expect(await first).toBe('aborted');
    expect(await second).toBe('aborted');
    expect('queue' in f.session.getSnapshot()).toBe(false);
    await vi.waitFor(() => expect(f.cancelRun).toHaveBeenCalledTimes(1));
    expect(f.joinStream).not.toHaveBeenCalled();
  });

  it('runs at once when nothing is running, passing the strategy on', async () => {
    const f = queueFixture();
    const run = f.session.submit('One', enqueue);
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    expect(f.stream.mock.calls[0][4]).toEqual({ multitaskStrategy: 'enqueue' });
    expect(f.createQueuedRun).not.toHaveBeenCalled();
    f.active.release(answer());
    f.active.finish();
    expect(await run).toBe('success');
  });

  it('rejects when the transport cannot queue, leaving the active run alone', async () => {
    const f = queueFixture({ createQueuedRun: undefined });
    const first = f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    await expect(f.session.submit('Two', enqueue)).rejects.toThrow(
      'createQueuedRun'
    );
    expect(f.session.getSnapshot().status).toBe('running');
    f.active.release(answer());
    f.active.finish();
    expect(await first).toBe('success');
  });

  it('rejects with a safe error when the queue request fails', async () => {
    const f = queueFixture({
      createQueuedRun: async () => {
        throw new Error('secret detail');
      },
    });
    void f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const failure = await f.session.submit('Two', enqueue).catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure.message)).not.toContain('secret');
    expect('queue' in f.session.getSnapshot()).toBe(false);
  });

  it('resolves a queued run as aborted on dispose', async () => {
    const f = queueFixture();
    void f.session.submit('One');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const second = f.session.submit('Two', enqueue);
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().queue).toHaveLength(1)
    );
    await f.session.dispose();
    expect(await second).toBe('aborted');
    expect(f.cancelRun).not.toHaveBeenCalled();
  });

  // Found against a real backend: LangGraph orders queued runs by creation,
  // so a run queued before the active run's own creation request had landed
  // ran ahead of it. A transport asked to report run creation is waited for.
  describe('behind a run whose creation is reported', () => {
    const reporting = () =>
      queueFixture({ getRunStatus: vi.fn(async () => 'success' as const) });
    const quiet = () => new Promise((done) => setTimeout(done, 20));

    it('creates the queued run only after the active run exists', async () => {
      const f = reporting();
      const first = f.session.submit('One');
      await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
      const second = f.session.submit('Two', enqueue);
      await quiet();
      expect(f.createQueuedRun).not.toHaveBeenCalled();
      expect('queue' in f.session.getSnapshot()).toBe(false);
      f.stream.mock.calls[0][4]?.onRunCreated?.({
        run_id: 'active',
        thread_id: 'thread',
      });
      await vi.waitFor(() =>
        expect(f.session.getSnapshot().queue).toHaveLength(1)
      );
      expect(f.createQueuedRun).toHaveBeenCalledOnce();
      f.active.release(answer('a1', 'First'));
      f.active.finish();
      expect(await first).toBe('success');
      f.joined.release(answer('a2', 'Second'));
      f.joined.finish();
      expect(await second).toBe('success');
    });

    it('takes the first stream event as the creation when none is reported', async () => {
      const f = reporting();
      void f.session.submit('One');
      await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
      void f.session.submit('Two', enqueue);
      await quiet();
      expect(f.createQueuedRun).not.toHaveBeenCalled();
      f.active.release(answer('a1', 'First'));
      await vi.waitFor(() => expect(f.createQueuedRun).toHaveBeenCalledOnce());
    });

    it('does not wait for a run that has ended', async () => {
      const f = reporting();
      const first = f.session.submit('One');
      await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
      const second = f.session.submit('Two', enqueue);
      await quiet();
      expect(f.createQueuedRun).not.toHaveBeenCalled();
      // The active run ends without ever reporting: nothing is left to order
      // behind, so the queued run is created and joined at once.
      f.active.finish();
      await first;
      await vi.waitFor(() => expect(f.joinStream).toHaveBeenCalled());
      expect(f.createQueuedRun).toHaveBeenCalledOnce();
      f.joined.release(answer('a2', 'Second'));
      f.joined.finish();
      expect(await second).toBe('success');
    });

    it('creates nothing for a queued submission the session is disposed under', async () => {
      const f = reporting();
      void f.session.submit('One');
      await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
      const second = f.session.submit('Two', enqueue);
      await quiet();
      await f.session.dispose();
      expect(await second).toBe('aborted');
      expect(f.createQueuedRun).not.toHaveBeenCalled();
    });
  });
});
