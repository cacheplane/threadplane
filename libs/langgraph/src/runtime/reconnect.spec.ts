import { describe, expect, it, vi } from 'vitest';
import type { Run, ThreadState } from '@langchain/langgraph-sdk';
import type {
  FunctionToolDefinition,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';

const chunk = (content: string, sseId?: string): StreamEvent => ({
  type: 'messages',
  sseId,
  messageMetadata: {},
  messages: [{ type: 'AIMessageChunk', id: 'answer', content }],
});
const terminal = (content = 'Done', sseId = '2'): StreamEvent => ({
  type: 'values',
  sseId,
  data: { messages: [{ type: 'ai', id: 'answer', content }] },
});
const pause = (sseId = '1'): StreamEvent => ({
  type: 'updates',
  sseId,
  data: { __interrupt__: [{ id: 'approval', value: 'Proceed?' }] },
});
const toolFrame = (id: string, sseId = id): StreamEvent => ({
  type: 'values',
  sseId,
  data: {
    messages: [
      {
        type: 'ai',
        id: `assistant-${id}`,
        content: '',
        tool_calls: [{ id, name: 'work', args: { id } }],
      },
    ],
  },
});
function fixture(
  options: {
    events?: StreamEvent[];
    status?: Run['status'];
    joined?: StreamEvent[];
    tools?: Record<string, FunctionToolDefinition>;
    executionStore?: ToolExecutionStore;
    identify?: (
      callback: NonNullable<
        Parameters<AgentTransport['stream']>[4]
      >['onRunCreated']
    ) => void;
  } = {}
) {
  const stream = vi.fn<AgentTransport['stream']>(async function* (
    _a,
    _t,
    _input,
    _signal,
    settings
  ) {
    if (options.identify) options.identify(settings?.onRunCreated);
    else settings?.onRunCreated?.({ run_id: 'run-1', thread_id: 't' });
    for (const event of options.events ?? [chunk('Partial', '1')]) yield event;
  });
  const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
    async function* () {
      for (const event of options.joined ?? [
        chunk(' suffix', '2'),
        terminal('Final', '3'),
      ])
        yield event;
    }
  );
  const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
    async () => options.status ?? 'running'
  );
  const getHistory = vi.fn(async (): Promise<ThreadState[]> => []);
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  const config = {
    assistantId: 'a',
    threadId: 't',
    transport: { stream, joinStream, getRunStatus, getHistory, updateState },
    executionStore: options.executionStore,
  };
  const session = options.tools
    ? createSession({ ...config, tools: options.tools })
    : createSession(config);
  return { session, stream, joinStream, getRunStatus, getHistory, updateState };
}

describe('owned run reconnect', () => {
  it.each(['Partial suffix', '', 'Short'])(
    'keeps anonymous identity while applying the joined canonical correction %j',
    async (content) => {
      const f = fixture({
        events: [
          {
            type: 'messages',
            sseId: '1',
            messageMetadata: {},
            messages: [{ type: 'AIMessageChunk', content: 'Partial' }],
          },
        ],
      });
      await f.session.submit('Question');
      const original = f.session.getSnapshot().messages[1];
      const observed: string[] = [];
      const counts: number[] = [];
      f.session.subscribe(() => {
        const assistants = f.session
          .getSnapshot()
          .messages.filter((message) => message.role === 'assistant');
        counts.push(assistants.length);
        observed.push(assistants[0].content);
      });
      f.getRunStatus.mockResolvedValue('success');
      f.joinStream.mockImplementation(async function* () {
        yield {
          type: 'messages',
          sseId: '2',
          messageMetadata: {},
          messages: [{ type: 'AIMessageChunk', content: ' suffix' }],
        };
        yield {
          type: 'values',
          sseId: '3',
          data: { messages: [{ type: 'ai', content }] },
        };
      });
      expect(await f.session.reconnect()).toBe('success');
      const assistants = f.session
        .getSnapshot()
        .messages.filter((message) => message.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]).toMatchObject({
        id: original.id,
        content,
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(assistants[0].delivery.generation).not.toBe(
        original.delivery.generation
      );
      expect(observed).toContain('Partial suffix');
      expect(counts.every((count) => count === 1)).toBe(true);
    }
  );

  it('preserves anonymous identity and delta text through repeated reconnect generations', async () => {
    const anonymous = (content: string, sseId: string): StreamEvent => ({
      type: 'messages',
      sseId,
      messageMetadata: {},
      messages: [{ type: 'AIMessageChunk', content }],
    });
    const f = fixture({
      events: [anonymous('A', '1')],
      joined: [anonymous('B', '2')],
    });
    await f.session.submit('Question');
    const id = f.session.getSnapshot().messages[1].id;
    expect(await f.session.reconnect()).toBe('interrupted');
    expect(f.session.getSnapshot().messages).toHaveLength(2);
    expect(f.session.getSnapshot().messages[1]).toMatchObject({
      id,
      content: 'AB',
    });
    f.joinStream.mockImplementation(async function* () {
      yield anonymous('C', '3');
      yield {
        type: 'values',
        sseId: '4',
        data: { messages: [{ type: 'ai', content: 'ABC' }] },
      };
    });
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(f.session.getSnapshot().messages).toHaveLength(2);
    expect(f.session.getSnapshot().messages[1]).toMatchObject({
      id,
      content: 'ABC',
    });
  });

  it('allocates a distinct anonymous identity for a new physical tool follow-up', async () => {
    const handler = vi.fn(() => 1);
    const f = fixture({
      status: 'success',
      tools: { work: { description: 'Work', handler } },
    });
    f.stream.mockImplementationOnce(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'first' });
      yield {
        type: 'values',
        sseId: '1',
        data: {
          messages: [
            {
              type: 'ai',
              content: 'Working',
              tool_calls: [{ id: 'call', name: 'work', args: {} }],
            },
          ],
        },
      };
    });
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'follow' });
      yield {
        type: 'values',
        sseId: '1',
        data: { messages: [{ type: 'ai', content: 'Finished' }] },
      };
    });
    expect(await f.session.submit('Question')).toBe('success');
    const assistants = f.session
      .getSnapshot()
      .messages.filter((message) => message.role === 'assistant');
    expect(assistants.map((message) => message.content)).toEqual([
      'Working',
      'Finished',
    ]);
    expect(assistants[0].id).not.toBe(assistants[1].id);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(2);
  });

  it('retains anonymous resumed-turn exclusions through reconnect even when the original user anchor returns', async () => {
    const handler = vi.fn(() => 1);
    const f = fixture({
      status: 'success',
      events: [terminal('Paused'), pause('pause')],
      tools: { work: { description: 'Work', handler } },
    });
    await f.session.submit('Question');
    const user = f.session.getSnapshot().messages[0];
    const foreign = {
      type: 'ai',
      content: 'Foreign',
      tool_calls: [{ id: 'foreign', name: 'work', args: {} }],
    };
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'resume' });
      yield {
        type: 'values',
        sseId: '1',
        data: {
          messages: [
            { type: 'human', id: user.id, content: user.content },
            { type: 'human', id: 'later', content: 'Later' },
            foreign,
          ],
        },
      };
    });
    f.getRunStatus.mockResolvedValue('running');
    expect(await f.session.resume(null)).toBe('interrupted');
    const anonymous = f.session
      .getSnapshot()
      .messages.find((message) => message.content === 'Foreign');
    f.joinStream.mockImplementation(async function* () {
      yield {
        type: 'values',
        sseId: '2',
        data: {
          messages: [
            { type: 'human', id: user.id, content: user.content },
            foreign,
          ],
        },
      };
    });
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(
      f.session
        .getSnapshot()
        .messages.filter((message) => message.content === 'Foreign')
        .map((message) => message.id)
    ).toEqual([anonymous?.id]);
    expect(handler).not.toHaveBeenCalled();
    expect(f.stream).toHaveBeenCalledTimes(2);
  });

  it('constructs inertly, captures options and offers only the exact identified safe-cursor run', async () => {
    const f = fixture();
    const off = f.session.subscribe(() => undefined);
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.getRunStatus).not.toHaveBeenCalled();
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.stream.mock.calls[0][4]).toMatchObject({
      streamResumable: true,
      onDisconnect: 'continue',
      onRunCreated: expect.any(Function),
    });
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      reconnect: { runId: 'run-1' },
      error: { recovery: 'none', retryable: false },
    });
    expect(f.getRunStatus).toHaveBeenCalledExactlyOnceWith(
      't',
      'run-1',
      f.stream.mock.calls[0][3]
    );
    await f.session.checkStatus?.();
    expect(f.getHistory).not.toHaveBeenCalled();
    off();
  });

  it.each(['pending', 'running'] as const)(
    'does not treat values or observed pause as final while exact status is %s',
    async (status) => {
      for (const event of [terminal(), pause()]) {
        const f = fixture({ status, events: [event] });
        expect(await f.session.submit('Question')).toBe('interrupted');
        expect(f.session.getSnapshot().reconnect).toEqual({ runId: 'run-1' });
        expect(f.getHistory).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['success', 'interrupted'] as const)(
    'requires observed current-run interrupt to confirm %s as paused',
    async (status) => {
      const f = fixture({ status, events: [pause()] });
      expect(await f.session.submit('Question')).toBe('paused');
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.getRunStatus).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['error', 'timeout', 'interrupted'] as const)(
    'discards reconnect on confirmed %s without executing anything',
    async (status) => {
      const f = fixture({ status, events: [terminal()] });
      expect(await f.session.submit('Question')).toBe(
        status === 'interrupted' ? 'interrupted' : 'error'
      );
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.getHistory).not.toHaveBeenCalled();
      await expect(f.session.reconnect()).rejects.toThrow();
    }
  );

  it('joins an exclusive suffix with a fresh generation, preserving partial text and human identity', async () => {
    const f = fixture();
    await f.session.submit('Question');
    const before = f.session.getSnapshot();
    const published: ReturnType<typeof f.session.getSnapshot>[] = [];
    f.session.subscribe(() => published.push(f.session.getSnapshot()));
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(f.joinStream.mock.calls[0].slice(0, 3)).toEqual(['t', 'run-1', '1']);
    expect(f.joinStream.mock.calls[0][3]).not.toBe(f.stream.mock.calls[0][3]);
    expect(published[0].status).toBe('running');
    expect(published[0].reconnect).toBeUndefined();
    expect(published[0].messages[1]).toMatchObject({
      content: 'Partial',
      delivery: { phase: 'streaming' },
    });
    expect(published[0].messages[1].delivery.generation).not.toBe(
      before.messages[1].delivery.generation
    );
    expect(
      published.some(
        (snapshot) => snapshot.messages[1].content === 'Partial suffix'
      )
    ).toBe(true);
    expect(f.session.getSnapshot().messages[0]).toBe(before.messages[0]);
    expect(f.session.getSnapshot().messages[1]).toMatchObject({
      content: 'Final',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.getHistory).not.toHaveBeenCalled();
  });

  it.each(['', 'Short'])(
    'applies joined canonical correction %j exactly',
    async (content) => {
      const f = fixture({ joined: [terminal(content)] });
      await f.session.submit('Question');
      f.getRunStatus.mockResolvedValue('success');
      expect(await f.session.reconnect()).toBe('success');
      expect(f.session.getSnapshot().messages[1].content).toBe(content);
    }
  );

  it('carries current physical terminal evidence through an empty joined stream only with confirmed status', async () => {
    const f = fixture({ events: [terminal('Interim')], joined: [] });
    await f.session.submit('Question');
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(f.session.getSnapshot().messages[1].content).toBe('Interim');
    const noTerminal = fixture({ joined: [], status: 'success' });
    expect(await noTerminal.session.submit('Question')).toBe('interrupted');
    expect(await noTerminal.session.reconnect()).toBe('interrupted');
    expect(noTerminal.session.getSnapshot().reconnect).toBeDefined();
  });

  it('projects repeated-ID payloads, but offers no unsafe repeated/idless boundary until a new ID', async () => {
    for (const last of [undefined, '1']) {
      const f = fixture({ events: [chunk('A', '1'), chunk('B', last)] });
      await f.session.submit('Question');
      expect(f.session.getSnapshot().messages[1].content).toBe('AB');
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.getHistory).not.toHaveBeenCalled();
    }
    const f = fixture({
      events: [chunk('A', '1'), chunk('B', '1'), chunk('C', 'next')],
    });
    await f.session.submit('Question');
    await f.session.reconnect();
    expect(f.joinStream.mock.calls[0][2]).toBe('next');
  });

  it('rejects inclusive cursor replay without projecting or offering it again', async () => {
    const f = fixture({ joined: [chunk('DUPLICATE', '1')] });
    await f.session.submit('Question');
    expect(await f.session.reconnect()).toBe('interrupted');
    expect(f.session.getSnapshot().messages[1].content).toBe('Partial');
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('requires a cursor even for a header-only drop and rejects conflicting/unsafe identities', async () => {
    const header = fixture({ events: [] });
    await header.session.submit('Question');
    expect(header.session.getSnapshot().reconnect).toBeUndefined();
    for (const metadata of [
      { run_id: '../bad', thread_id: 't' },
      { run_id: 'run', thread_id: 'other' },
    ]) {
      const f = fixture({ identify: (callback) => callback?.(metadata) });
      await f.session.submit('Question');
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.getHistory).not.toHaveBeenCalled();
    }
    const conflict = fixture({
      identify: (callback) => {
        callback?.({ run_id: 'one', thread_id: 't' });
        callback?.({ run_id: 'two', thread_id: 't' });
      },
    });
    await conflict.session.submit('Question');
    expect(conflict.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('keeps the legacy no-identity fallback and requests no capture options without both capabilities', async () => {
    const noId = fixture({ identify: () => undefined });
    await noId.session.submit('Question');
    expect(noId.getHistory).toHaveBeenCalledTimes(1);
    expect(noId.getRunStatus).not.toHaveBeenCalled();
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield terminal();
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream, joinStream: noId.joinStream },
    });
    expect(await session.submit('Question')).toBe('success');
    expect(stream.mock.calls[0][4]).toBeUndefined();
  });

  it('retains on status inspection failure but discards on explicit SSE error', async () => {
    const f = fixture({ events: [terminal()] });
    f.getRunStatus.mockRejectedValue(new Error('private status error'));
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.session.getSnapshot().reconnect).toBeDefined();
    const failed = fixture({
      events: [
        chunk('Partial', '1'),
        { type: 'error', data: { message: 'Failed' } },
      ],
    });
    expect(await failed.session.submit('Question')).toBe('error');
    expect(failed.session.getSnapshot().reconnect).toBeUndefined();
    expect(failed.getRunStatus).not.toHaveBeenCalled();
  });

  it('discards on stop/dispose/replacement submit, and preaborted reconnect is inert', async () => {
    for (const command of ['stop', 'dispose', 'submit'] as const) {
      const f = fixture();
      await f.session.submit('Question');
      const before = f.session.getSnapshot();
      expect(await f.session.reconnect({ signal: AbortSignal.abort() })).toBe(
        'aborted'
      );
      expect(f.session.getSnapshot()).toBe(before);
      if (command === 'submit') {
        f.stream.mockImplementation(async function* () {
          yield terminal();
        });
        await f.session.submit('Replacement');
      } else await f.session[command]();
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      if (command === 'dispose')
        expect(await f.session.reconnect()).toBe('aborted');
      else await expect(f.session.reconnect()).rejects.toThrow();
      expect(f.joinStream).not.toHaveBeenCalled();
    }
  });

  it('blocks resume/load and duplicate reconnect while a retained run or join owns the operation', async () => {
    const f = fixture();
    await f.session.submit('Question');
    await expect(f.session.load?.()).rejects.toThrow();
    await expect(f.session.resume(true)).rejects.toThrow();
    const wait = deferred<IteratorResult<StreamEvent>>();
    const started = deferred<void>();
    f.joinStream.mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        started.resolve();
        return {
          next: () => wait.promise,
          return: async () => ({ done: true, value: undefined }),
        };
      },
    }));
    const joining = f.session.reconnect();
    await started.promise;
    await expect(f.session.reconnect()).rejects.toThrow();
    await f.session.stop();
    expect(await joining).toBe('aborted');
    wait.resolve({ done: false, value: terminal('Stale') });
    await Promise.resolve();
    expect(f.session.getSnapshot().messages[1].content).toBe('Partial');
  });

  it('carries the latest cursor and text through multiple disconnects without replaying POST', async () => {
    const f = fixture({ joined: [chunk(' B', '2')] });
    await f.session.submit('Question');
    expect(await f.session.reconnect()).toBe('interrupted');
    expect(f.session.getSnapshot().messages[1].content).toBe('Partial B');
    f.joinStream.mockImplementation(async function* () {
      yield chunk(' C', '3');
      yield terminal('Final', '4');
    });
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(f.joinStream.mock.calls.map((call) => call[2])).toEqual(['1', '2']);
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.getRunStatus).toHaveBeenCalledTimes(3);
  });

  it('does not advance the cursor or commit messages when a later projection throws', async () => {
    const invalid = {
      get bad() {
        throw new Error('private');
      },
      messages: [{ type: 'ai', id: 'answer', content: 'Invalid' }],
    };
    const f = fixture({
      events: [
        chunk('Partial', '1'),
        { type: 'values', sseId: '2', data: invalid },
      ],
    });
    await f.session.submit('Question');
    expect(f.session.getSnapshot().messages[1].content).toBe('Partial');
    expect(f.session.getSnapshot().values).toBeUndefined();
    await f.session.reconnect();
    expect(f.joinStream.mock.calls[0][2]).toBe('1');
  });

  it.each(['stop', 'dispose', 'submit'] as const)(
    'rejects reentrant %s projection candidates and late run callbacks',
    async (command) => {
      const f = fixture();
      let replacement: Promise<unknown> | undefined;
      f.stream.mockImplementationOnce(async function* (
        _a,
        _t,
        _input,
        _signal,
        options
      ) {
        options?.onRunCreated?.({ run_id: 'old', thread_id: 't' });
        yield chunk('Old', '1');
        yield {
          type: 'values',
          sseId: '2',
          data: {
            get stage() {
              replacement =
                command === 'submit'
                  ? f.session.submit('New')
                  : f.session[command]();
              options?.onRunCreated?.({ run_id: 'stale', thread_id: 't' });
              return 'stale';
            },
            messages: [{ type: 'ai', id: 'answer', content: 'Stale' }],
          },
        };
      });
      f.stream.mockImplementation(async function* () {
        yield {
          type: 'values',
          data: { messages: [{ type: 'ai', id: 'new', content: 'New' }] },
        };
      });
      expect(await f.session.submit('Old')).toBe(
        command === 'submit' ? 'interrupted' : 'aborted'
      );
      await replacement;
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.session.getSnapshot().values?.['stage']).toBeUndefined();
      expect(
        f.session
          .getSnapshot()
          .messages.some((message) => message.content === 'Stale')
      ).toBe(false);
      expect(f.getRunStatus).not.toHaveBeenCalled();
    }
  );

  it.each(['stop', 'dispose', 'abort', 'submit'] as const)(
    'settles %s promptly during ignored-abort joined status inspection',
    async (command) => {
      const f = fixture();
      await f.session.submit('Question');
      const status = deferred<Run['status']>();
      const started = deferred<void>();
      f.getRunStatus.mockImplementationOnce(() => {
        started.resolve();
        return status.promise;
      });
      const controller = new AbortController();
      const joined = f.session.reconnect({ signal: controller.signal });
      await started.promise;
      if (command === 'abort') controller.abort();
      else if (command === 'submit') {
        f.stream.mockImplementation(async function* () {
          yield terminal('Replacement');
        });
        await f.session.submit('New');
      } else await f.session[command]();
      expect(await joined).toBe(
        command === 'submit' ? 'interrupted' : 'aborted'
      );
      const snapshot = f.session.getSnapshot();
      status.resolve('success');
      await Promise.resolve();
      await Promise.resolve();
      expect(f.session.getSnapshot()).toBe(snapshot);
      expect(snapshot.reconnect).toBeUndefined();
    }
  );

  it('commits the cursor before publication and observes a listener stopping a join', async () => {
    const f = fixture();
    await f.session.submit('Question');
    const unsubscribe = f.session.subscribe(() => {
      if (f.session.getSnapshot().status === 'running') void f.session.stop();
    });
    expect(await f.session.reconnect()).toBe('aborted');
    expect(f.joinStream).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    unsubscribe();
  });

  it('isolates retained run identity and cursor between two sessions', async () => {
    const first = fixture();
    const second = fixture({ events: [chunk('Other', 'other')] });
    await Promise.all([
      first.session.submit('First'),
      second.session.submit('Second'),
    ]);
    await first.session.stop();
    await second.session.reconnect();
    expect(second.joinStream.mock.calls[0][2]).toBe('other');
    expect(first.joinStream).not.toHaveBeenCalled();
  });

  it.each(['late', 'nested', 'projection'] as const)(
    'makes %s run identity capture unsafe without falling back to history',
    async (kind) => {
      const f = fixture();
      f.stream.mockImplementation(async function* (
        _a,
        _t,
        _input,
        _signal,
        options
      ) {
        const capture = options?.onRunCreated;
        if (kind === 'nested')
          capture?.({
            get run_id() {
              capture?.({ run_id: 'nested', thread_id: 't' });
              return 'outer';
            },
            thread_id: 't',
          });
        else if (kind === 'projection')
          capture?.({ run_id: 'first', thread_id: 't' });
        yield chunk('Partial', '1');
        if (kind === 'late') capture?.({ run_id: 'late', thread_id: 't' });
        if (kind === 'projection')
          yield {
            type: 'values',
            sseId: '2',
            data: {
              get stage() {
                capture?.({ run_id: 'conflicting', thread_id: 't' });
                return 'done';
              },
              messages: [{ type: 'ai', id: 'answer', content: 'Done' }],
            },
          };
      });
      await f.session.submit('Question');
      expect(f.session.getSnapshot().reconnect).toBeUndefined();
      expect(f.getHistory).not.toHaveBeenCalled();
      expect(f.getRunStatus).not.toHaveBeenCalled();
    }
  );

  it('executes finalized tools only after exact success and creates one newly owned follow-up', async () => {
    const handler = vi.fn(() => ({ done: true }));
    const f = fixture({
      tools: { work: { description: 'Work', handler } },
      events: [toolFrame('call')],
    });
    const runOptions = {
      config: { configurable: { user_id: 'user-42' } },
      context: { locale: 'en' },
      metadata: { source: 'ui' },
    };
    await f.session.submit('Question', runOptions);
    runOptions.context.locale = 'changed';
    expect(handler).not.toHaveBeenCalled();
    f.getRunStatus.mockResolvedValue('success');
    f.joinStream.mockImplementation(async function* () {
      yield toolFrame('call', 'new');
    });
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'follow-up', thread_id: 't' });
      yield terminal('Finished', 'follow-final');
    });
    expect(await f.session.reconnect()).toBe('success');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(2);
    for (const call of f.stream.mock.calls) {
      expect(call[4]).toMatchObject({
        config: { configurable: { user_id: 'user-42' } },
        context: { locale: 'en' },
        metadata: { source: 'ui' },
      });
    }
    expect(f.stream.mock.calls[1][2]).toMatchObject({
      messages: [{ type: 'tool', tool_call_id: 'call' }],
    });
    expect(f.getRunStatus.mock.calls.map((call) => call[1])).toEqual([
      'run-1',
      'run-1',
      'follow-up',
    ]);
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('retains the exact follow-up handoff across two joins, with no repeated claim or premature acknowledgment', async () => {
    const handler = vi.fn(() => 1);
    const claim = vi.fn<ToolExecutionStore['claim']>(async () => 'claimed');
    const record = vi.fn<ToolExecutionStore['record']>(async () => undefined);
    const f = fixture({
      tools: { work: { description: 'Work', handler } },
      executionStore: { claim, record },
    });
    let number = 0;
    let oldCallback: NonNullable<
      Parameters<AgentTransport['stream']>[4]
    >['onRunCreated'];
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      number += 1;
      options?.onRunCreated?.({ run_id: `run-${number}`, thread_id: 't' });
      if (number === 1) {
        oldCallback = options?.onRunCreated;
        yield toolFrame('call');
      } else {
        oldCallback?.({ run_id: 'stale' });
        yield chunk('Follow', 'follow-1');
      }
    });
    f.getRunStatus
      .mockResolvedValueOnce('success')
      .mockResolvedValue('running');
    expect(await f.session.submit('Question')).toBe('interrupted');
    const earlier = f.session
      .getSnapshot()
      .messages.find((message) => message.id === 'assistant-call');
    expect(f.session.getSnapshot().reconnect).toEqual({ runId: 'run-2' });
    f.joinStream.mockImplementationOnce(async function* () {
      yield chunk(' more', 'follow-2');
    });
    expect(await f.session.reconnect()).toBe('interrupted');
    await expect(f.session.load?.()).rejects.toThrow();
    f.getRunStatus.mockResolvedValue('success');
    f.joinStream.mockImplementationOnce(async function* () {
      yield terminal('Finished', 'follow-3');
    });
    expect(await f.session.reconnect()).toBe('success');
    expect(
      f.session
        .getSnapshot()
        .messages.find((message) => message.id === 'assistant-call')
    ).toBe(earlier);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.joinStream.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      ['run-2', 'follow-1'],
      ['run-2', 'follow-2'],
    ]);
    expect(f.updateState).not.toHaveBeenCalled();
    await f.session.load?.();
    expect(f.getHistory).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge an uncertain follow-up, leaving exact results for a later explicit submission', async () => {
    const f = fixture({
      tools: { work: { description: 'Work', handler: () => 1 } },
    });
    f.stream.mockImplementationOnce(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'tool' });
      yield toolFrame('call');
    });
    f.getRunStatus.mockResolvedValueOnce('success');
    await f.session.submit('Question');
    const handed = (f.stream.mock.calls[1][2] as { messages: unknown[] })
      .messages;
    expect(handed).toHaveLength(1);
    await f.session.stop();
    f.stream.mockImplementation(async function* () {
      yield terminal();
    });
    await f.session.submit('New');
    expect(
      (f.stream.mock.calls[2][2] as { messages: unknown[] }).messages[0]
    ).toEqual(handed[0]);
  });

  it('never resurrects a confirmed successful run when local tool persistence fails', async () => {
    const f = fixture({
      status: 'success',
      events: [toolFrame('call')],
      tools: {
        work: { description: 'Work', followUp: false, handler: () => 1 },
      },
    });
    f.updateState.mockRejectedValue(new Error('write failed'));
    expect(await f.session.submit('Question')).toBe('error');
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    await expect(f.session.reconnect()).rejects.toThrow();
  });

  it('joins a resumed physical run without resending null input or its resume command', async () => {
    const f = fixture({
      status: 'success',
      events: [terminal('Paused'), pause('pause')],
    });
    expect(await f.session.submit('Question')).toBe('paused');
    const user = f.session.getSnapshot().messages[0];
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'resume-run', thread_id: 't' });
      yield chunk('Resumed', 'resume-1');
    });
    f.getRunStatus.mockResolvedValue('running');
    expect(await f.session.resume({ approval: null })).toBe('interrupted');
    expect(f.stream.mock.calls[1][2]).toBeNull();
    expect(f.stream.mock.calls[1][4]?.command).toEqual({
      resume: { approval: null },
    });
    f.getRunStatus.mockResolvedValue('success');
    f.joinStream.mockImplementation(async function* () {
      yield chunk(' suffix', 'resume-2');
      yield terminal('Resumed final', 'resume-3');
    });
    expect(await f.session.reconnect()).toBe('success');
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.joinStream.mock.calls[0].slice(0, 3)).toEqual([
      't',
      'resume-run',
      'resume-1',
    ]);
    expect(f.session.getSnapshot().messages[0]).toBe(user);
    expect(f.session.getSnapshot().messages[1].content).toBe('Resumed final');
  });

  it('preserves the ten-group cap across a disconnected tool group', async () => {
    const handler = vi.fn(() => 1);
    const f = fixture({
      status: 'success',
      tools: { work: { description: 'Work', handler } },
    });
    let count = 0;
    f.stream.mockImplementation(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      count += 1;
      options?.onRunCreated?.({ run_id: `group-${count}` });
      yield toolFrame(`call-${count}`);
    });
    f.getRunStatus.mockImplementation(async (_t, run) =>
      run === 'group-5' ? 'running' : 'success'
    );
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(handler).toHaveBeenCalledTimes(4);
    f.joinStream.mockImplementation(async function* () {
      yield toolFrame('call-5', 'joined');
    });
    f.getRunStatus.mockResolvedValue('success');
    expect(await f.session.reconnect()).toBe('success');
    expect(handler).toHaveBeenCalledTimes(10);
    expect(f.stream).toHaveBeenCalledTimes(11);
    expect(f.session.getSnapshot().toolCalls.at(-1)).toMatchObject({
      id: 'call-11',
      status: 'error',
      error: 'Client tool continuation limit reached.',
    });
    expect(f.updateState).toHaveBeenCalledTimes(1);
  });

  it('blocks submit/reconnect during late guarded settlement and retains a failed write', async () => {
    const claimed =
      deferred<Awaited<ReturnType<ToolExecutionStore['claim']>>>();
    const recorded = deferred<void>();
    const written = deferred<void>();
    const claimStarted = deferred<void>();
    const recordStarted = deferred<void>();
    const writeStarted = deferred<void>();
    const claim = vi.fn<ToolExecutionStore['claim']>(() => {
      claimStarted.resolve();
      return claimed.promise;
    });
    const record = vi.fn<ToolExecutionStore['record']>(() => {
      recordStarted.resolve();
      return recorded.promise;
    });
    const handler = vi.fn(() => 1);
    const f = fixture({
      tools: { work: { description: 'Work', handler } },
      executionStore: { claim, record },
    });
    f.stream.mockImplementationOnce(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'old' });
      yield toolFrame('old-call');
    });
    f.getRunStatus.mockResolvedValueOnce('success');
    f.updateState.mockImplementation(() => {
      writeStarted.resolve();
      return written.promise;
    });
    const old = f.session.submit('Old');
    await claimStarted.promise;
    await f.session.stop();
    expect(await old).toBe('aborted');
    await expect(f.session.submit('New')).rejects.toThrow(/unsettled tool/);
    const retained = f.session.getSnapshot();
    await expect(f.session.reconnect()).rejects.toThrow();
    expect(f.session.getSnapshot()).toBe(retained);
    claimed.resolve('claimed');
    await recordStarted.promise;
    await expect(f.session.submit('New')).rejects.toThrow(/unsettled tool/);
    await expect(f.session.reconnect()).rejects.toThrow();
    recorded.resolve();
    await writeStarted.promise;
    await expect(f.session.reconnect()).rejects.toThrow();
    written.reject(new Error('write failed'));
    // Observe cleanup settlement; all effect promises are explicitly controlled.
    await written.promise.catch(() => undefined);
    for (let index = 0; index < 8; index++) await Promise.resolve();
    await expect(f.session.reconnect()).rejects.toThrow();
    expect(f.joinStream).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    await expect(f.session.submit('New')).resolves.toBe('interrupted');
    expect(f.stream.mock.calls[1][2]).toMatchObject({
      messages: [
        {
          tool_call_id: 'old-call',
          content: expect.stringContaining('cancelled'),
        },
        { type: 'human', content: 'New' },
      ],
    });
  });

  it('guards external abort registration reentrancy before issuing a joined GET', async () => {
    const f = fixture();
    await f.session.submit('Question');
    const external = new AbortController();
    const add = external.signal.addEventListener.bind(external.signal);
    vi.spyOn(external.signal, 'addEventListener').mockImplementation(
      (...args) => {
        add(...args);
        void f.session.stop();
      }
    );
    expect(await f.session.reconnect({ signal: external.signal })).toBe(
      'aborted'
    );
    expect(f.joinStream).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('rejects admission during active history reads and legacy checks without mutating their owner', async () => {
    for (const kind of ['load', 'check'] as const) {
      const f = fixture({ identify: () => undefined });
      if (kind === 'check') await f.session.submit('Question');
      const history = deferred<ThreadState[]>();
      const started = deferred<void>();
      f.getHistory.mockImplementationOnce(() => {
        started.resolve();
        return history.promise;
      });
      const reading =
        kind === 'load' ? f.session.load?.() : f.session.checkStatus?.();
      await started.promise;
      const snapshot = f.session.getSnapshot();
      await expect(f.session.reconnect()).rejects.toThrow();
      expect(f.session.getSnapshot()).toBe(snapshot);
      history.resolve([]);
      await reading;
      expect(f.joinStream).not.toHaveBeenCalled();
    }
  });

  it('observes late joined rejection after disposal without notification or further I/O', async () => {
    const f = fixture();
    await f.session.submit('Question');
    const next = deferred<IteratorResult<StreamEvent>>();
    const started = deferred<void>();
    f.joinStream.mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        started.resolve();
        return {
          next: () => next.promise,
          return: async () => {
            throw new Error('late cleanup');
          },
        };
      },
    }));
    const result = f.session.reconnect();
    await started.promise;
    await f.session.dispose();
    expect(await result).toBe('aborted');
    const snapshot = f.session.getSnapshot();
    next.reject(new Error('late joined failure'));
    await next.promise.catch(() => undefined);
    await Promise.resolve();
    expect(f.session.getSnapshot()).toBe(snapshot);
    expect(f.getRunStatus).toHaveBeenCalledTimes(1);
  });
});
