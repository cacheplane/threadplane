import { describe, expect, it, vi } from 'vitest';
import type { Run, ThreadState } from '@langchain/langgraph-sdk';
import { createSession } from './create-session';
import { RECOVERY_COPY, failureProjection } from './stream-projection';
import type { AgentTransport, StreamEvent } from './transport.types';

const chunk = (content: string, sseId = '1'): StreamEvent => ({
  type: 'messages',
  sseId,
  messageMetadata: {},
  messages: [{ type: 'AIMessageChunk', id: 'answer', content }],
});
const committed = { id: 'answer', type: 'ai', content: 'finished remotely' };

function checkpoint(
  messages: unknown[],
  options: { paused?: boolean } = {}
): ThreadState {
  return {
    values: { messages } as ThreadState['values'],
    next: options.paused ? ['ask'] : [],
    tasks: options.paused
      ? [
          {
            id: 'task',
            name: 'ask',
            error: null,
            interrupts: [{ id: 'approval', value: 'Proceed?' }],
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

function fixture(
  options: {
    events?: StreamEvent[];
    status?: Run['status'];
    history?: boolean;
  } = {}
) {
  const stream = vi.fn<AgentTransport['stream']>(async function* (
    _a,
    _t,
    _input,
    _signal,
    settings
  ) {
    settings?.onRunCreated?.({ run_id: 'run-1', thread_id: 't' });
    for (const event of options.events ?? [chunk('Partial')]) yield event;
  });
  const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
    async function* () {
      yield* [];
    }
  );
  const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
    async () => options.status ?? 'running'
  );
  const getHistory = vi.fn(async (): Promise<ThreadState[]> => []);
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: {
      stream,
      joinStream,
      getRunStatus,
      ...(options.history === false ? {} : { getHistory }),
    },
  });
  /** The latest checkpoint for this session's own submitted turn. */
  const turn = (messages: unknown[], paused = false) =>
    checkpoint(
      [
        (stream.mock.calls.at(-1)?.[2] as { messages: unknown[] }).messages[0],
        ...messages,
      ],
      { paused }
    );
  return { session, stream, joinStream, getRunStatus, getHistory, turn };
}

describe('lost approval pause on a confirmed interrupted run', () => {
  it('settles as paused when history still carries this turn pending interrupt', async () => {
    const f = fixture({ status: 'interrupted' });
    f.getHistory.mockImplementation(async () => [f.turn([], true)]);
    expect(await f.session.submit('Question')).toBe('paused');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    expect(f.session.getSnapshot().interrupts).toEqual([
      { id: 'approval', value: 'Proceed?' },
    ]);
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it('settles as a failed run when history shows the run was cancelled with nothing pending', async () => {
    const f = fixture({ status: 'interrupted' });
    f.getHistory.mockImplementation(async () => [f.turn([])]);
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        kind: 'interrupted',
        retryable: false,
        recovery: 'none',
        message: 'The LangGraph run did not complete successfully.',
      },
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    expect(f.session.getSnapshot().interrupts).toEqual([]);
    await expect(f.session.reconnect()).rejects.toThrow();
  });

  it('keeps the failed-run reading when the disambiguating read itself fails', async () => {
    const f = fixture({ status: 'interrupted' });
    f.getHistory.mockRejectedValueOnce(new Error('history unavailable'));
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.session.getSnapshot().error).toMatchObject({
      recovery: 'none',
      message: 'The LangGraph run did not complete successfully.',
    });
  });

  it('cannot disambiguate without history and reports the failed run', async () => {
    const f = fixture({ status: 'interrupted', history: false });
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.getHistory).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().error).toMatchObject({
      recovery: 'none',
      message: 'The LangGraph run did not complete successfully.',
    });
  });
});

describe('read-only recovery for a dispatched run', () => {
  it('offers a status check while the exact run is still in flight and resolves it later', async () => {
    const f = fixture({ status: 'running' });
    expect(await f.session.submit('Question')).toBe('interrupted');
    // Exact status says the run is in flight: history is not conclusive yet.
    expect(f.getHistory).not.toHaveBeenCalled();
    const original = f.session.getSnapshot();
    expect(original).toMatchObject({
      status: 'error',
      reconnect: { runId: 'run-1' },
      error: {
        kind: 'interrupted',
        retryable: false,
        recovery: 'check',
        message: RECOVERY_COPY.messages.check,
        detail: RECOVERY_COPY.details.check,
      },
    });
    expect(f.session.checkStatus).toBeTypeOf('function');
    await f.session.checkStatus?.();
    expect(f.getRunStatus).toHaveBeenCalledTimes(2);
    expect(f.getHistory).not.toHaveBeenCalled();
    expect(f.session.getSnapshot()).toBe(original);
    f.getRunStatus.mockResolvedValue('success');
    f.getHistory.mockImplementation(async () => [f.turn([committed])]);
    await f.session.checkStatus?.();
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      content: committed.content,
      delivery: { outcome: 'success' },
    });
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.joinStream).not.toHaveBeenCalled();
    await expect(f.session.reconnect()).rejects.toThrow();
  });

  it('rescues a confirmed successful run whose final messages were lost from history at close', async () => {
    const f = fixture({ status: 'success' });
    f.getHistory.mockImplementation(async () => [f.turn([committed])]);
    expect(await f.session.submit('Question')).toBe('success');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      content: committed.content,
      delivery: { outcome: 'success' },
    });
  });

  it('keeps a confirmed successful run checkable when history is inconclusive at close', async () => {
    const f = fixture({ status: 'success' });
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      reconnect: { runId: 'run-1' },
      error: { recovery: 'check' },
    });
    f.getHistory.mockImplementation(async () => [f.turn([committed])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('still offers nothing without history even when the run is retained for reconnect', async () => {
    const f = fixture({ status: 'running', history: false });
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.session.checkStatus).toBeUndefined();
    expect(f.session.getSnapshot()).toMatchObject({
      reconnect: { runId: 'run-1' },
      error: {
        recovery: 'none',
        message: RECOVERY_COPY.messages.none,
        detail: RECOVERY_COPY.details.none,
      },
    });
  });

  it('reports a failed run and withdraws every recovery when an explicit check finds it failed', async () => {
    const f = fixture({ status: 'running' });
    expect(await f.session.submit('Question')).toBe('interrupted');
    f.getRunStatus.mockResolvedValue('error');
    await f.session.checkStatus?.();
    expect(f.getHistory).not.toHaveBeenCalled();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        kind: 'server',
        retryable: false,
        recovery: 'none',
        message: 'The LangGraph run did not complete successfully.',
      },
    });
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    await expect(f.session.reconnect()).rejects.toThrow();
    // A second check has nothing left to inspect.
    await f.session.checkStatus?.();
    expect(f.getRunStatus).toHaveBeenCalledTimes(2);
  });
});

describe('pre-response transport failures', () => {
  it.each([true, false])(
    'stay non-retryable interruptions with the shared copy (canCheck %s)',
    (canCheck) => {
      const error = failureProjection(
        new TypeError('fetch failed'),
        false,
        false,
        canCheck
      );
      expect(error).toEqual({
        kind: 'interrupted',
        retryable: false,
        recovery: canCheck ? 'check' : 'none',
        message: RECOVERY_COPY.messages[canCheck ? 'check' : 'none'],
        detail: RECOVERY_COPY.details[canCheck ? 'check' : 'none'],
      });
    }
  );
});

describe('read-only recovery for a resume attempt', () => {
  const user = { type: 'human', id: 'saved-user', content: 'Question' };
  const waiting = { type: 'ai', id: 'saved-answer', content: 'Waiting' };
  const answer = { type: 'ai', id: 'resumed-answer', content: 'Approved work' };
  const approve = { id: 'approve', value: 'Proceed?' };
  const again = { id: 'again', value: 'Once more?' };
  function paused(
    messages: unknown[],
    interrupts: readonly { id: string; value: string }[],
    next: string[] = interrupts.length ? ['approval'] : []
  ): ThreadState {
    return {
      ...checkpoint(messages),
      next,
      tasks: interrupts.length
        ? [
            {
              id: 'task',
              name: 'approval',
              error: null,
              interrupts: [...interrupts],
              checkpoint: null,
              state: null,
              result: null,
            },
          ]
        : [],
    };
  }
  async function resumeFixture(
    options: { status?: Run['status']; exact?: boolean; drop?: boolean } = {}
  ) {
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      _input,
      _signal,
      settings
    ) {
      if (options.exact !== false)
        settings?.onRunCreated?.({ run_id: 'run-1', thread_id: 't' });
      if (options.drop === false)
        yield { type: 'values', data: { messages: [user, waiting, answer] } };
    });
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      async function* () {
        yield* [];
      }
    );
    const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
      async () => options.status ?? 'running'
    );
    const getHistory = vi.fn(
      async (): Promise<ThreadState[]> => [paused([user, waiting], [approve])]
    );
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: {
        stream,
        getHistory,
        ...(options.exact === false ? {} : { joinStream, getRunStatus }),
      },
    });
    await session.load?.();
    expect(session.getSnapshot().interrupts).toEqual([approve]);
    getHistory.mockClear();
    return { session, stream, joinStream, getRunStatus, getHistory };
  }

  it('offers a status check for a dropped decision on a run still in flight and resolves it once the run ends', async () => {
    const f = await resumeFixture({ status: 'running' });
    expect(await f.session.resume(true)).toBe('interrupted');
    expect(f.getHistory).not.toHaveBeenCalled();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: { kind: 'interrupted', recovery: 'check', retryable: false },
    });
    // Sending the decision consumed the observed pause optimistically; an
    // uncertain outcome does not restore it and invite a second decision.
    expect(f.session.getSnapshot().interrupts).toEqual([]);
    await f.session.checkStatus?.();
    expect(f.getHistory).not.toHaveBeenCalled();
    f.getRunStatus.mockResolvedValue('success');
    f.getHistory.mockResolvedValue([paused([user, waiting, answer], [])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().interrupts).toEqual([]);
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'resumed-answer',
      content: 'Approved work',
      delivery: { outcome: 'success' },
    });
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it('treats the same pause with no new activity as inconclusive and lets the decision be sent again', async () => {
    const f = await resumeFixture({ exact: false });
    expect(await f.session.resume(true)).toBe('interrupted');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    const original = f.session.getSnapshot();
    expect(original.error).toMatchObject({ recovery: 'check' });
    expect(original.interrupts).toEqual([]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toBe(original);
    // The uncertain resume does not strand the user: reloading restores the
    // still-pending pause, and re-sending the decision withdraws the pending
    // check instead of racing it.
    await f.session.load?.();
    expect(f.session.getSnapshot().interrupts).toEqual([approve]);
    // The withdrawn check is gone for good: it cannot be re-run against the
    // reloaded history on behalf of the superseded attempt.
    const reads = f.getHistory.mock.calls.length;
    await f.session.checkStatus?.();
    expect(f.getHistory).toHaveBeenCalledTimes(reads);
    f.stream.mockImplementation(async function* () {
      yield { type: 'values', data: { messages: [user, waiting, answer] } };
    });
    expect(await f.session.resume(true)).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'resumed-answer',
      delivery: { outcome: 'success' },
    });
    expect(f.stream).toHaveBeenCalledTimes(2);
  });

  it('settles as paused on a different pending interrupt reached after the decision landed', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([paused([user, waiting, answer], [again])]);
    expect(await f.session.resume(true)).toBe('paused');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(f.session.getSnapshot().interrupts).toEqual([again]);
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'resumed-answer',
    });
  });

  it('settles as paused again when the same interrupt recurs after new activity', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([
      paused([user, waiting, answer], [approve]),
    ]);
    expect(await f.session.resume(true)).toBe('paused');
    expect(f.session.getSnapshot().interrupts).toEqual([approve]);
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'resumed-answer',
    });
  });

  it('treats the same interrupt id with a different question as a new pause', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([
      paused([user, waiting], [{ id: 'approve', value: 'Really proceed?' }]),
    ]);
    expect(await f.session.resume(true)).toBe('paused');
    expect(f.session.getSnapshot().interrupts).toEqual([
      { id: 'approve', value: 'Really proceed?' },
    ]);
  });

  it('lets a new pause observed before the drop be answered while its check is pending', async () => {
    const f = await resumeFixture({ status: 'running' });
    f.stream.mockImplementationOnce(async function* (
      _a,
      _t,
      _input,
      _signal,
      settings
    ) {
      settings?.onRunCreated?.({ run_id: 'run-1', thread_id: 't' });
      yield { type: 'updates', data: { __interrupt__: [again] } };
    });
    expect(await f.session.resume(true)).toBe('interrupted');
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: { recovery: 'check' },
    });
    expect(f.session.getSnapshot().interrupts).toEqual([again]);
    f.stream.mockImplementationOnce(async function* () {
      yield { type: 'values', data: { messages: [user, waiting, answer] } };
    });
    expect(await f.session.resume(false)).toBe('success');
    expect(f.session.getSnapshot().interrupts).toEqual([]);
    expect(f.stream).toHaveBeenCalledTimes(2);
  });

  it('keeps an idle thread with no pending interrupt and no new activity inconclusive', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([paused([user, waiting], [])]);
    expect(await f.session.resume(true)).toBe('interrupted');
    const original = f.session.getSnapshot();
    expect(original.error).toMatchObject({ recovery: 'check' });
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toBe(original);
  });

  it('keeps new activity on a run still writing checkpoints inconclusive until it ends', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([
      paused([user, waiting, answer], [], ['generate']),
    ]);
    expect(await f.session.resume(true)).toBe('interrupted');
    expect(f.session.getSnapshot().error).toMatchObject({ recovery: 'check' });
    f.getHistory.mockResolvedValue([paused([user, waiting, answer], [])]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
  });

  it('settles as success when a newer turn already follows the resumed one', async () => {
    const f = await resumeFixture({ exact: false });
    const newer = { type: 'human', id: 'newer-user', content: 'Next' };
    f.getHistory.mockResolvedValue([
      paused([user, waiting, answer, newer], [], ['analyze']),
    ]);
    expect(await f.session.resume(true)).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'resumed-answer',
      delivery: { outcome: 'success' },
    });
  });

  it('disambiguates an exact interrupted status on a resumed run through history', async () => {
    const f = await resumeFixture({ status: 'interrupted' });
    f.getHistory.mockResolvedValue([paused([user, waiting, answer], [again])]);
    expect(await f.session.resume(true)).toBe('paused');
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot().interrupts).toEqual([again]);
    expect(f.session.getSnapshot().reconnect).toBeUndefined();
  });

  it('does not correlate when the resumed turn user message is missing from history', async () => {
    const f = await resumeFixture({ exact: false });
    f.getHistory.mockResolvedValue([
      paused([{ ...user, id: 'other-user' }, answer], [again]),
    ]);
    expect(await f.session.resume(true)).toBe('interrupted');
    expect(f.session.getSnapshot().interrupts).toEqual([]);
    expect(f.session.getSnapshot().error).toMatchObject({ recovery: 'check' });
  });
});
