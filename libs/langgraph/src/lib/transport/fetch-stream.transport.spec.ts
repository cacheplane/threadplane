import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from './fetch-stream.transport';

const mocks = vi.hoisted(() => ({
  threadsCreate: vi.fn(),
  threadsGetHistory: vi.fn(),
  threadsUpdateState: vi.fn(),
  runsStream: vi.fn(),
  runsCreate: vi.fn(),
  runsCancel: vi.fn(),
  runsJoinStream: vi.fn(),
  clientCtor: vi.fn(function (_config: { apiUrl: string; callerOptions?: { fetch?: typeof fetch } }) {
    return {
      threads: {
        create: mocks.threadsCreate,
        getHistory: mocks.threadsGetHistory,
        updateState: mocks.threadsUpdateState,
      },
      runs: {
        stream: mocks.runsStream,
        create: mocks.runsCreate,
        cancel: mocks.runsCancel,
        joinStream: mocks.runsJoinStream,
      },
    };
  }),
}));

vi.mock('@langchain/langgraph-sdk', () => ({
  Client: mocks.clientCtor,
}));

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}

describe('FetchStreamTransport', () => {
  beforeEach(() => {
    mocks.threadsCreate.mockReset();
    mocks.threadsGetHistory.mockReset();
    mocks.threadsUpdateState.mockReset();
    mocks.runsStream.mockReset();
    mocks.runsCreate.mockReset();
    mocks.runsCancel.mockReset();
    mocks.runsJoinStream.mockReset();
    mocks.clientCtor.mockClear();
  });

  it.each([401, 403])('does not report arbitrary SDK status %s lookalikes and throws cause-free generic errors', async status => {
    const reportOperationFailure = vi.fn();
    const remote = Object.assign(new Error('test-key-redact-me'), { status });
    mocks.threadsCreate.mockRejectedValueOnce(remote);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await collect(transport.stream(
      'assistant-1',
      null,
      {},
      new AbortController().signal,
    )).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('reports network_blocked only for rejection from its installed SDK fetch', async () => {
    const reportOperationFailure = vi.fn();
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );
    const config = mocks.clientCtor.mock.calls.at(-1)?.[0] as {
      callerOptions?: { fetch?: typeof fetch };
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('test-key-redact-me')));
    const protectedFailure = await config.callerOptions?.fetch?.('https://runtime.example/api')
      .catch((reason: unknown) => reason);
    mocks.threadsCreate.mockRejectedValueOnce(protectedFailure);

    const error = await collect(transport.stream(
      'assistant-1',
      null,
      {},
      new AbortController().signal,
    )).catch((reason: unknown) => reason);

    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith('network_blocked');
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    vi.unstubAllGlobals();
  });

  it('preserves an owned fetch abort without reporting a runtime failure', async () => {
    const reportOperationFailure = vi.fn();
    new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );
    const config = mocks.clientCtor.mock.calls.at(-1)?.[0] as {
      callerOptions?: { fetch?: typeof fetch };
    };
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test-key-redact-me')));

    const error = await config.callerOptions?.fetch?.(
      'https://runtime.example/api',
      { signal: controller.signal },
    ).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    vi.unstubAllGlobals();
  });

  it('preserves a race-aborted installed SDK fetch without reporting', async () => {
    const reportOperationFailure = vi.fn();
    new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );
    const config = mocks.clientCtor.mock.calls.at(-1)?.[0] as {
      callerOptions?: { fetch?: typeof fetch };
    };
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error('test-key-redact-me'));
    }));

    const error = await config.callerOptions?.fetch?.(
      'https://runtime.example/api',
      { signal: controller.signal },
    ).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    vi.unstubAllGlobals();
  });

  it.each([401, 403])('reports native fetch Response %s exactly once and sanitizes its body', async status => {
    const reportOperationFailure = vi.fn();
    new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );
    const config = mocks.clientCtor.mock.calls.at(-1)?.[0] as {
      callerOptions?: { fetch?: typeof fetch };
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('test-key-redact-me', { status }),
    ));

    const response = await config.callerOptions?.fetch?.('https://runtime.example/api');

    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith('unauthorized');
    expect(response?.status).toBe(status);
    expect(await response?.text()).toBe('');
    vi.unstubAllGlobals();
  });

  it('fails closed when the installed SDK fetch receives a hostile response object', async () => {
    new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
    );
    const config = mocks.clientCtor.mock.calls.at(-1)?.[0] as {
      callerOptions?: { fetch?: typeof fetch };
    };
    const hostileResponse = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined;
        throw new Error('test-key-redact-me');
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hostileResponse));

    const response = await config.callerOptions?.fetch?.('https://runtime.example/api');

    expect(response === hostileResponse).toBe(false);
    expect(response?.status).toBe(500);
    expect(await response?.text()).toBe('');
    vi.unstubAllGlobals();
  });

  it('fails closed when a trusted SDK operation rejects with hostile property getters', async () => {
    const reportOperationFailure = vi.fn();
    const hostile = new Proxy({}, {
      get() { throw new Error('test-key-redact-me'); },
      getOwnPropertyDescriptor() { throw new Error('test-key-redact-me'); },
    });
    mocks.threadsGetHistory.mockRejectedValueOnce(hostile);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await transport.getHistory('thread-1', new AbortController().signal)
      .catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('sanitizes every non-stream default SDK operation when defaultHeaders are configured', async () => {
    const sentinel = new Error('test-key-redact-me');
    mocks.runsCreate.mockRejectedValue(sentinel);
    mocks.runsCancel.mockRejectedValue(sentinel);
    mocks.threadsGetHistory.mockRejectedValue(sentinel);
    mocks.threadsUpdateState.mockRejectedValue(sentinel);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
    );
    const signal = new AbortController().signal;
    const operations = [
      transport.createQueuedRun('assistant-1', 'thread-1', {}, signal),
      transport.cancelRun('thread-1', 'run-1', signal),
      transport.getHistory('thread-1', signal),
      transport.updateState('thread-1', {}, signal),
    ];

    const errors = await Promise.all(operations.map(operation => operation.catch(error => error)));

    for (const error of errors) {
      expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    }
  });

  it('does not report status lookalikes thrown by the application thread callback', async () => {
    const reportOperationFailure = vi.fn();
    const callbackError = Object.assign(new Error('test-key-redact-me'), { status: 401 });
    mocks.threadsCreate.mockResolvedValueOnce({ thread_id: 'thread-1' });
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      () => { throw callbackError; },
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await collect(transport.stream(
      'assistant-1',
      null,
      {},
      new AbortController().signal,
    )).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('does not report hostile local run-payload construction as an SDK failure', async () => {
    const reportOperationFailure = vi.fn();
    const options = new Proxy({} as object, {
      ownKeys() { throw Object.assign(new Error('test-key-redact-me'), { status: 403 }); },
    });
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await collect(transport.stream(
      'assistant-1',
      'thread-1',
      {},
      new AbortController().signal,
      options,
    )).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('does not report a payload proxy returned as a 403 SDK lookalike', async () => {
    const reportOperationFailure = vi.fn();
    const payload = new Proxy({}, {
      getOwnPropertyDescriptor(_target, property) {
        if (property === 'status') {
          return { configurable: true, enumerable: false, writable: false, value: 403 };
        }
        return undefined;
      },
    });
    mocks.runsStream.mockImplementationOnce(() => { throw payload; });
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await collect(transport.stream(
      'assistant-1',
      'thread-1',
      payload,
      new AbortController().signal,
    )).catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
  });

  it('does not report an AbortSignal proxy carrying a 401 lookalike', async () => {
    const reportOperationFailure = vi.fn();
    const nativeSignal = new AbortController().signal;
    const signal = new Proxy(nativeSignal, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'status') {
          return { configurable: true, enumerable: false, writable: false, value: 401 };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    mocks.threadsGetHistory.mockRejectedValueOnce(signal);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await transport.getHistory('thread-1', signal)
      .catch((reason: unknown) => reason);

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
  });

  it('does not report sync SDK, stream iterator, or non-stream status lookalikes', async () => {
    const reportOperationFailure = vi.fn();
    const statusLookalike = Object.assign(new Error('test-key-redact-me'), { status: 401 });
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );
    const signal = new AbortController().signal;

    mocks.threadsCreate.mockImplementationOnce(() => { throw statusLookalike; });
    const syncThreadError = await collect(transport.stream('assistant-1', null, {}, signal))
      .catch((reason: unknown) => reason);

    mocks.runsStream.mockImplementationOnce(() => { throw statusLookalike; });
    const syncStreamError = await collect(transport.stream('assistant-1', 'thread-1', {}, signal))
      .catch((reason: unknown) => reason);

    mocks.runsStream.mockReturnValueOnce({
      [Symbol.asyncIterator]() { throw statusLookalike; },
    });
    const iteratorAcquisitionError = await collect(
      transport.stream('assistant-1', 'thread-1', {}, signal),
    ).catch((reason: unknown) => reason);

    mocks.runsStream.mockReturnValueOnce({
      [Symbol.asyncIterator]() {
        return { next: vi.fn().mockRejectedValue(statusLookalike) };
      },
    });
    const iteratorError = await collect(transport.stream('assistant-1', 'thread-1', {}, signal))
      .catch((reason: unknown) => reason);

    mocks.runsCreate.mockRejectedValueOnce(statusLookalike);
    mocks.runsCancel.mockRejectedValueOnce(statusLookalike);
    mocks.threadsGetHistory.mockRejectedValueOnce(statusLookalike);
    mocks.threadsUpdateState.mockRejectedValueOnce(statusLookalike);
    const nonStreamErrors = await Promise.all([
      transport.createQueuedRun('assistant-1', 'thread-1', {}, signal),
      transport.cancelRun('thread-1', 'run-1', signal),
      transport.getHistory('thread-1', signal),
      transport.updateState('thread-1', {}, signal),
    ].map(operation => operation.catch((reason: unknown) => reason)));

    expect(reportOperationFailure).not.toHaveBeenCalled();
    for (const error of [
      syncThreadError,
      syncStreamError,
      iteratorAcquisitionError,
      iteratorError,
      ...nonStreamErrors,
    ]) {
      expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    }
  });

  it('normalizes messages/* events with a direct messages array', async () => {
    const message = { id: 'msg-1', type: 'ai', content: 'pong' };
    mocks.runsStream.mockReturnValue(
      (async function* () {
        yield { event: 'messages/partial', data: [message] };
      })(),
    );

    const transport = new FetchStreamTransport('http://example.test');
    const events = await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(events).toEqual([
      {
        type: 'messages/partial',
        messages: [message],
        data: [message],
      },
    ]);
  });

  it('requests the stream modes required for values, messages, and custom events', async () => {
    mocks.runsStream.mockReturnValue((async function* () {
      yield { event: 'metadata', data: { run_id: 'run-1', thread_id: 'thread-1' } };
    })());

    const transport = new FetchStreamTransport('http://example.test');
    await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(mocks.runsStream).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        streamMode: expect.arrayContaining([
          'values',
          'messages-tuple',
          'updates',
          'custom',
        ]),
      }),
    );
  });

  it('requests subgraph streams so subagent namespaces are delivered', async () => {
    mocks.runsStream.mockReturnValue((async function* () {
      yield { event: 'metadata', data: { run_id: 'run-1', thread_id: 'thread-1' } };
    })());

    const transport = new FetchStreamTransport('http://example.test');
    await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(mocks.runsStream).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        streamSubgraphs: true,
      }),
    );
  });

  it('forwards LangGraph submit options to streamed runs', async () => {
    const checkpoint = {
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint-1',
      checkpoint_map: null,
    };
    const config = { configurable: { userId: 'user-1' } };
    const metadata = { source: 'ui' };
    const command = { resume: { approved: true } };
    mocks.runsStream.mockReturnValue((async function* () {
      yield { event: 'metadata', data: { run_id: 'run-1', thread_id: 'thread-1' } };
    })());

    const transport = new FetchStreamTransport('http://example.test');
    await collect(
      transport.stream(
        'assistant-1',
        'thread-1',
        null,
        new AbortController().signal,
        {
          checkpoint,
          config,
          metadata,
          command,
          durability: 'sync',
          interruptBefore: ['review'],
          onDisconnect: 'continue',
          streamResumable: true,
          feedbackKeys: ['quality'],
        },
      ),
    );

    expect(mocks.runsStream).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        input: null,
        checkpoint,
        config,
        metadata,
        command,
        durability: 'sync',
        interruptBefore: ['review'],
        onDisconnect: 'continue',
        streamResumable: true,
        feedbackKeys: ['quality'],
      }),
    );
  });

  it('preserves explicit null checkpoints on streamed runs', async () => {
    mocks.runsStream.mockReturnValue((async function* () {
      yield { event: 'metadata', data: { run_id: 'run-1', thread_id: 'thread-1' } };
    })());

    const transport = new FetchStreamTransport('http://example.test');
    await collect(
      transport.stream(
        'assistant-1',
        'thread-1',
        null,
        new AbortController().signal,
        { checkpoint: null },
      ),
    );

    expect(mocks.runsStream).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        checkpoint: null,
      }),
    );
  });

  it('preserves namespaced subgraph event types during normalization', async () => {
    const message = { id: 'sub-ai-1', type: 'ai', content: 'working' };
    const metadata = { checkpoint_ns: 'tools:call-1|model:abc' };
    mocks.runsStream.mockReturnValue(
      (async function* () {
        yield { event: 'messages|tools:call-1', data: [message, metadata] };
      })(),
    );

    const transport = new FetchStreamTransport('http://example.test');
    const events = await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(events).toEqual([
      {
        type: 'messages|tools:call-1',
        namespace: ['tools:call-1'],
        messages: [message],
        messageMetadata: metadata,
        data: [message, metadata],
      },
    ]);
  });

  it('normalizes message tuple events without dropping metadata', async () => {
    const message = { id: 'ai-1', type: 'ai', content: 'pong' };
    const metadata = { langgraph_node: 'model', run_id: 'run-1' };
    mocks.runsStream.mockReturnValue(
      (async function* () {
        yield { event: 'messages', data: [message, metadata] };
      })(),
    );

    const transport = new FetchStreamTransport('http://example.test');
    const events = await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(events).toEqual([
      {
        type: 'messages',
        messages: [message],
        messageMetadata: metadata,
        data: [message, metadata],
      },
    ]);
  });

  it('normalizes updates, interrupt, and interrupts payloads', async () => {
    mocks.runsStream.mockReturnValue(
      (async function* () {
        yield { event: 'updates', data: { nodeA: { answer: 42 } } };
        yield { event: 'interrupt', data: { interrupt: { id: 'i-1' } } };
        yield { event: 'interrupts', data: { interrupts: [{ id: 'i-2' }] } };
      })(),
    );

    const transport = new FetchStreamTransport('http://example.test');
    const events = await collect(
      transport.stream('assistant-1', 'thread-1', { input: 'hello' }, new AbortController().signal),
    );

    expect(events).toEqual([
      { type: 'updates', nodeA: { answer: 42 }, data: { nodeA: { answer: 42 } } },
      { type: 'interrupt', interrupt: { id: 'i-1' }, data: { interrupt: { id: 'i-1' } } },
      { type: 'interrupts', interrupts: [{ id: 'i-2' }], data: { interrupts: [{ id: 'i-2' }] } },
    ]);
  });

  it('forwards lastEventId and reuses the existing thread when joining', async () => {
    mocks.runsJoinStream.mockReturnValue(
      (async function* () {
        yield { event: 'values', data: { status: 'resumed' } };
      })(),
    );

    const transport = new FetchStreamTransport('http://example.test');
    const events = await collect(
      transport.joinStream('thread-1', 'run-1', 'event-9', new AbortController().signal),
    );

    expect(mocks.threadsCreate).not.toHaveBeenCalled();
    expect(mocks.runsJoinStream).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      expect.objectContaining({
        lastEventId: 'event-9',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(events).toEqual([
      { type: 'values', status: 'resumed', data: { status: 'resumed' } },
    ]);
  });

  it('creates a server-side queued run with enqueue multitask strategy', async () => {
    mocks.runsCreate.mockResolvedValue({
      run_id: 'run-queued',
      thread_id: 'thread-1',
      created_at: '2026-05-02T00:00:00.000Z',
    });

    const transport = new FetchStreamTransport('http://example.test');
    const entry = await transport.createQueuedRun(
      'assistant-1',
      'thread-1',
      { messages: [{ type: 'human', content: 'queued' }] },
      new AbortController().signal,
    );

    expect(mocks.runsCreate).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        input: { messages: [{ type: 'human', content: 'queued' }] },
        multitaskStrategy: 'enqueue',
        streamSubgraphs: true,
      }),
    );
    expect(entry).toMatchObject({
      id: 'run-queued',
      threadId: 'thread-1',
      values: { messages: [{ type: 'human', content: 'queued' }] },
    });
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('forwards LangGraph submit options when creating queued runs', async () => {
    const checkpoint = {
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint-queued',
      checkpoint_map: null,
    };
    mocks.runsCreate.mockResolvedValue({
      run_id: 'run-queued',
      thread_id: 'thread-1',
      created_at: '2026-05-02T00:00:00.000Z',
    });

    const transport = new FetchStreamTransport('http://example.test');
    await transport.createQueuedRun(
      'assistant-1',
      'thread-1',
      { messages: [{ type: 'human', content: 'queued' }] },
      new AbortController().signal,
      {
        checkpoint,
        command: { resume: { ok: true } },
        multitaskStrategy: 'interrupt',
      },
    );

    expect(mocks.runsCreate).toHaveBeenCalledWith(
      'thread-1',
      'assistant-1',
      expect.objectContaining({
        checkpoint,
        command: { resume: { ok: true } },
        multitaskStrategy: 'enqueue',
      }),
    );
  });

  it('cancels a queued run by thread and run id', async () => {
    const transport = new FetchStreamTransport('http://example.test');

    await transport.cancelRun('thread-1', 'run-queued', new AbortController().signal);

    expect(mocks.runsCancel).toHaveBeenCalledWith(
      'thread-1',
      'run-queued',
      false,
      'interrupt',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('loads thread history through the LangGraph SDK client', async () => {
    const history = [
      {
        values: { messages: [] },
        next: [],
        checkpoint: {
          thread_id: 'thread-1',
          checkpoint_ns: '',
          checkpoint_id: 'checkpoint-1',
          checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-05-02T00:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      },
    ];
    mocks.threadsGetHistory.mockResolvedValue(history);
    const signal = new AbortController().signal;

    const transport = new FetchStreamTransport('http://example.test');
    const result = await transport.getHistory('thread-1', signal);

    expect(mocks.threadsGetHistory).toHaveBeenCalledWith('thread-1', { signal });
    expect(result).toBe(history);
  });
});


describe('SDK iterator cleanup', () => {
  it.each([false, true])('preserves the primary error when cleanup fails (protected=%s)', async (protectedErrors) => {
    const primary = new Error('primary failure');
    const close = vi.fn().mockRejectedValue(new Error('cleanup failure'));
    mocks.runsStream.mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next: async () => { throw primary; }, return: close }),
    });
    const transport = new FetchStreamTransport('https://runtime.example', undefined, protectedErrors ? { defaultHeaders: {} } : undefined);
    const error = await collect(transport.stream('assistant', 'thread', {}, new AbortController().signal)).catch((reason: unknown) => reason);
    expect(close).toHaveBeenCalledTimes(1);
    if (protectedErrors) {
      expect(error).toMatchObject({ name: 'LangGraphRequestError', message: 'The LangGraph request failed.' });
      expect(error).not.toHaveProperty('cause');
    } else {
      expect(error).toBe(primary);
    }
  });
});
