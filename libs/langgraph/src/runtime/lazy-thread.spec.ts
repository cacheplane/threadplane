import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@langchain/langgraph-sdk';
import { createSession } from './create-session';
import { answerPending } from './testing/answer-pending';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

type Payload = { messages?: { id: string; type: string; content: string }[] };

/** A completed run that echoes the submitted user message and answers it. */
function answer(payload: unknown, content = 'Done'): StreamEvent[] {
  return [
    {
      type: 'values',
      data: {
        messages: [
          ...((payload as Payload | null)?.messages ?? []),
          { type: 'ai', id: `answer-${content}`, content },
        ],
      },
    },
  ];
}

function fixture(
  options: {
    createThread?: NonNullable<AgentTransport['createThread']>;
    runStatus?: boolean;
  } = {}
) {
  const createThread = vi.fn<NonNullable<AgentTransport['createThread']>>(
    options.createThread ?? (async () => 'created')
  );
  const stream = vi.fn<AgentTransport['stream']>(async function* (
    _assistant,
    thread,
    payload,
    _signal,
    settings
  ) {
    settings?.onRunCreated?.({ run_id: 'run-0', thread_id: thread ?? '' });
    yield* answer(payload);
  });
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const getState = vi.fn<NonNullable<AgentTransport['getState']>>();
  const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
    async (): Promise<Run['status']> => 'success'
  );
  const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
    async function* () {
      yield* [];
    }
  );
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>();
  const onThreadId = vi.fn<(threadId: string) => void>();
  const transport: AgentTransport = {
    stream,
    createThread,
    getHistory,
    getState,
    joinStream,
    updateState,
    ...(options.runStatus === false ? {} : { getRunStatus }),
  };
  const session = createSession({
    assistantId: 'a',
    transport,
    onThreadId,
  });
  return {
    session,
    createThread,
    stream,
    getHistory,
    getState,
    getRunStatus,
    joinStream,
    updateState,
    onThreadId,
  };
}

describe('a session without a thread', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends no request before the first submit', async () => {
    const f = fixture();
    expect(f.session.threadId).toBeUndefined();
    const initial = f.session.getSnapshot();
    await f.session.load?.();
    await f.session.checkStatus?.();
    await expect(f.session.reconnect()).rejects.toThrow(
      'Reconnect requires an idle retained run'
    );
    await expect(
      f.session.resume(answerPending(f.session, true))
    ).rejects.toThrow('Resume requires an observed interrupt.');
    await expect(
      f.session.fork(
        {
          thread_id: 'other',
          checkpoint_ns: '',
          checkpoint_id: 'c',
          checkpoint_map: {},
        },
        'Branch'
      )
    ).rejects.toThrow('Fork requires the session thread to exist.');
    await expect(f.session.regenerate?.('missing')).rejects.toThrow();
    expect(await f.session.retry?.()).toBe('aborted');
    await f.session.stop();
    expect(f.session.getSnapshot()).toBe(initial);
    for (const call of [
      f.createThread,
      f.stream,
      f.getHistory,
      f.getState,
      f.getRunStatus,
      f.joinStream,
      f.updateState,
      f.onThreadId,
    ])
      expect(call).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('creates the thread on the first submit, reports it, and reuses it', async () => {
    const f = fixture();
    expect(await f.session.submit('Hello')).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(1);
    expect(f.onThreadId).toHaveBeenCalledTimes(1);
    expect(f.onThreadId).toHaveBeenCalledWith('created');
    expect(f.session.threadId).toBe('created');
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.stream.mock.calls[0][1]).toBe('created');
    // The thread exists before the run starts.
    expect(f.createThread.mock.invocationCallOrder[0]).toBeLessThan(
      f.stream.mock.invocationCallOrder[0]
    );
    expect(
      f.session
        .getSnapshot()
        .messages.map(({ role, content }) => [role, content])
    ).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Done'],
    ]);
    expect(await f.session.submit('Again')).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(1);
    expect(f.onThreadId).toHaveBeenCalledTimes(1);
    expect(f.stream.mock.calls[1][1]).toBe('created');
    await f.session.load?.();
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.getHistory.mock.calls[0][0]).toBe('created');
    await f.session.dispose();
  });

  it('creates one thread when a second submit replaces a pending creation', async () => {
    const pending = deferred<string>();
    const f = fixture({ createThread: () => pending.promise });
    const first = f.session.submit('First');
    await Promise.resolve();
    const second = f.session.submit('Second');
    pending.resolve('only');
    expect(await first).toBe('interrupted');
    expect(await second).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(1);
    expect(f.onThreadId).toHaveBeenCalledTimes(1);
    expect(f.onThreadId).toHaveBeenCalledWith('only');
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.stream.mock.calls[0][1]).toBe('only');
    expect((f.stream.mock.calls[0][2] as Payload).messages?.[0].content).toBe(
      'Second'
    );
    await f.session.dispose();
  });

  it('keeps a thread whose creation finishes after stop', async () => {
    const pending = deferred<string>();
    const f = fixture({ createThread: () => pending.promise });
    const first = f.session.submit('First');
    await Promise.resolve();
    await f.session.stop();
    expect(await first).toBe('aborted');
    pending.resolve('kept');
    await pending.promise;
    await Promise.resolve();
    expect(f.session.threadId).toBe('kept');
    expect(f.onThreadId).toHaveBeenCalledWith('kept');
    expect(f.stream).not.toHaveBeenCalled();
    expect(await f.session.submit('Second')).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(1);
    expect(f.stream.mock.calls[0][1]).toBe('kept');
    await f.session.dispose();
  });

  it('aborts a pending creation on dispose and never reports it', async () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<string>();
    const f = fixture({
      createThread: (abort) => {
        signal = abort;
        return pending.promise;
      },
    });
    const first = f.session.submit('First');
    await Promise.resolve();
    await f.session.dispose();
    expect(await first).toBe('aborted');
    expect(signal?.aborted).toBe(true);
    pending.resolve('late');
    await pending.promise;
    await Promise.resolve();
    expect(f.session.threadId).toBeUndefined();
    expect(f.onThreadId).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
  });

  it('reports a failed creation without its body and retries it', async () => {
    let attempts = 0;
    const f = fixture({
      createThread: async () => {
        if (attempts++ === 0)
          throw Object.assign(new Error('PRIVATE_BODY'), { status: 500 });
        return 'second';
      },
    });
    expect(await f.session.submit('Hello')).toBe('error');
    const failed = f.session.getSnapshot();
    expect(failed).toMatchObject({
      status: 'error',
      error: {
        kind: 'server',
        message: 'The LangGraph request failed.',
        retryable: true,
        recovery: 'retry',
      },
    });
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_BODY');
    expect(f.session.threadId).toBeUndefined();
    expect(f.onThreadId).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(await f.session.retry?.()).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(2);
    expect(f.session.threadId).toBe('second');
    expect(f.onThreadId).toHaveBeenCalledWith('second');
    expect(
      f.session
        .getSnapshot()
        .messages.map(({ role, content }) => [role, content])
    ).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Done'],
    ]);
    await f.session.dispose();
  });

  it('accepts a new submit after a failed creation when retry is unavailable', async () => {
    let attempts = 0;
    const f = fixture({
      runStatus: false,
      createThread: async () => {
        if (attempts++ === 0) throw new TypeError('fetch failed');
        return 'second';
      },
    });
    expect(f.session.retry).toBeUndefined();
    expect(await f.session.submit('Hello')).toBe('error');
    expect(f.session.getSnapshot().error).toMatchObject({
      kind: 'server',
      message: 'The LangGraph request failed.',
      retryable: false,
      recovery: 'none',
    });
    expect(await f.session.submit('Hello again')).toBe('success');
    expect(f.createThread).toHaveBeenCalledTimes(2);
    expect(f.stream.mock.calls[0][1]).toBe('second');
    await f.session.dispose();
  });

  it('reports a rejected credential as an authentication failure', async () => {
    const f = fixture({
      createThread: async () => {
        throw Object.assign(new Error('PRIVATE_BODY'), { status: 401 });
      },
    });
    expect(await f.session.submit('Hello')).toBe('error');
    expect(f.session.getSnapshot().error).toEqual({
      kind: 'auth',
      message: 'Authentication failed. Check your credentials.',
      status: 401,
      retryable: false,
      recovery: 'none',
    });
    await f.session.dispose();
  });

  it('rejects an empty created thread id', async () => {
    const f = fixture({ createThread: async () => '' });
    expect(await f.session.submit('Hello')).toBe('error');
    expect(f.session.threadId).toBeUndefined();
    expect(f.onThreadId).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('isolates a throwing onThreadId callback from the run', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _assistant,
      _thread,
      payload
    ) {
      yield* answer(payload);
    });
    const session = createSession({
      assistantId: 'a',
      transport: { stream, createThread: async () => 'created' },
      onThreadId: () => {
        throw new Error('application failure');
      },
    });
    expect(await session.submit('Hello')).toBe('success');
    expect(session.threadId).toBe('created');
    await session.dispose();
  });

  it('requires a transport that can create threads', () => {
    expect(() =>
      createSession({
        assistantId: 'a',
        transport: {
          stream: async function* () {
            yield* [];
          },
        },
      })
    ).toThrow(TypeError);
  });

  it('leaves a session with a fixed thread unchanged', async () => {
    const createThread = vi.fn(async () => 'never');
    const onThreadId = vi.fn();
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _assistant,
      _thread,
      payload
    ) {
      yield* answer(payload);
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 'fixed',
      transport: { stream, createThread },
      onThreadId,
    });
    expect(session.threadId).toBe('fixed');
    expect(await session.submit('Hello')).toBe('success');
    expect(stream.mock.calls[0][1]).toBe('fixed');
    expect(createThread).not.toHaveBeenCalled();
    expect(onThreadId).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('creates the thread through the owned SDK client without retries', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/threads'))
        return new Response(JSON.stringify({ thread_id: 'server-thread' }), {
          headers: { 'content-type': 'application/json' },
        });
      return new Response(
        `event: values\ndata: ${JSON.stringify({
          messages: [{ type: 'ai', id: 'answer', content: 'Done' }],
        })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    vi.stubGlobal('fetch', fetch);
    const onThreadId = vi.fn();
    const session = createSession({
      assistantId: 'a',
      apiUrl: 'https://runtime.example',
      onThreadId,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await session.submit('Hello')).toBe('success');
    expect(onThreadId).toHaveBeenCalledWith('server-thread');
    expect(String(fetch.mock.calls[0][0])).toBe(
      'https://runtime.example/threads'
    );
    expect(String(fetch.mock.calls[1][0])).toContain(
      '/threads/server-thread/runs/stream'
    );
    await session.dispose();
  });

  it('fails an owned creation once, without reading its body', async () => {
    const fetch = vi.fn(
      async () => new Response('PRIVATE_BODY', { status: 500 })
    );
    vi.stubGlobal('fetch', fetch);
    const session = createSession({
      assistantId: 'a',
      apiUrl: 'https://runtime.example',
    });
    expect(await session.submit('Hello')).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(1);
    const snapshot = session.getSnapshot();
    expect(snapshot.error).toMatchObject({
      kind: 'server',
      message: 'The LangGraph request failed.',
    });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_BODY');
    await session.dispose();
  });
});
