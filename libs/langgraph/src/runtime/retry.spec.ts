import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@langchain/langgraph-sdk';
import { createSession } from './create-session';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

const partial: StreamEvent = {
  type: 'messages',
  sseId: '1',
  messageMetadata: {},
  messages: [{ type: 'AIMessageChunk', id: 'partial', content: 'Half' }],
};
const pause: StreamEvent = {
  type: 'updates',
  data: { __interrupt__: [{ id: 'approval', value: 'Proceed?' }] },
};

/** Calls retry, failing the test instead of passing when the session has none. */
function retryOf<T>(session: { retry?(): Promise<T> }): Promise<T> {
  if (!session.retry) throw new Error('The session has no retry.');
  return session.retry();
}

type Payload = { messages?: { id: string; type: string; content: string }[] };
type Script = (payload: Payload | null) => StreamEvent[] | Promise<never>;

/** Each stream call plays the next script; each run's exact status is scripted by id. */
function fixture(
  scripts: Script[],
  statuses: Run['status'][],
  options: { runStatus?: boolean } = {}
) {
  let calls = 0;
  const stream = vi.fn<AgentTransport['stream']>(async function* (
    _assistant,
    _thread,
    payload,
    _signal,
    settings
  ) {
    const index = calls++;
    settings?.onRunCreated?.({ run_id: `run-${index}`, thread_id: 't' });
    const events = scripts[index](payload as Payload | null);
    for (const event of await events) yield event;
  });
  const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
    async (_thread, runId) => statuses[Number(runId.slice(4))] ?? 'running'
  );
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: {
      stream,
      joinStream: async function* () {
        yield* [];
      },
      ...(options.runStatus === false ? {} : { getRunStatus }),
      getHistory,
    },
  });
  return { session, stream, getRunStatus };
}

/** A completed run that echoes the submitted user message and answers it. */
const answer =
  (content: string): Script =>
  (payload) => [
    {
      type: 'values',
      data: {
        messages: [
          ...(payload?.messages ?? []),
          { type: 'ai', id: 'answer', content },
        ],
      },
    },
  ];

describe('retry', () => {
  it('sends a submission the backend reported failed again, with the same user message', async () => {
    const f = fixture(
      [() => [partial], answer('Done')],
      ['error', 'success']
    );
    expect(await f.session.submit('Question')).toBe('error');
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        kind: 'server',
        retryable: true,
        recovery: 'retry',
        message: 'The LangGraph run did not complete successfully.',
      },
    });
    expect(await retryOf(f.session)).toBe('success');
    expect(f.stream).toHaveBeenCalledTimes(2);
    const first = f.stream.mock.calls[0][2] as Payload;
    const second = f.stream.mock.calls[1][2] as Payload;
    // The same message identity, so the thread replaces rather than appends it.
    expect(second.messages).toEqual(first.messages);
    const snapshot = f.session.getSnapshot();
    expect(snapshot).toMatchObject({ status: 'idle' });
    expect(snapshot.error).toBeUndefined();
    expect(
      snapshot.messages.map(({ role, content }) => [role, content])
    ).toEqual([
      ['user', 'Question'],
      ['assistant', 'Done'],
    ]);
    // Nothing failed now: a second retry sends nothing.
    expect(await retryOf(f.session)).toBe('aborted');
    expect(f.stream).toHaveBeenCalledTimes(2);
  });

  it('refuses an uncertain failure until a status check settles it', async () => {
    const f = fixture(
      [() => [partial], answer('Done')],
      ['running', 'success']
    );
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.session.getSnapshot().error).toMatchObject({
      retryable: false,
      recovery: 'check',
    });
    await expect(retryOf(f.session)).rejects.toThrow(/cannot be retried/);
    expect(f.stream).toHaveBeenCalledTimes(1);
    f.getRunStatus.mockResolvedValueOnce('error');
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot().error).toMatchObject({
      kind: 'server',
      retryable: true,
      recovery: 'retry',
    });
    expect(await retryOf(f.session)).toBe('success');
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      content: 'Done',
    });
  });

  it('offers nothing for a run the backend reports interrupted, which may have lost a pause', async () => {
    const f = fixture([() => [partial]], ['interrupted']);
    expect(await f.session.submit('Question')).toBe('interrupted');
    expect(f.session.getSnapshot().error).toMatchObject({
      retryable: false,
      recovery: 'none',
    });
    await expect(retryOf(f.session)).rejects.toThrow(/cannot be retried/);
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with nothing saved and while a request runs', async () => {
    const gate = deferred<never>();
    const f = fixture([() => gate.promise], []);
    expect(await retryOf(f.session)).toBe('aborted');
    expect(f.stream).not.toHaveBeenCalled();
    const run = f.session.submit('Question');
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalledTimes(1));
    expect(await retryOf(f.session)).toBe('aborted');
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(
      f.session.getSnapshot().messages.filter(({ role }) => role === 'user')
    ).toHaveLength(1);
    await f.session.stop();
    await run;
  });

  it('sends a failed resume again with the same response and no user message', async () => {
    // Each run is scripted below; run-1, the resume, is the one that fails.
    const f = fixture([], ['interrupted', 'error', 'success']);
    f.stream.mockImplementationOnce(async function* (_a, _t, payload, _s, settings) {
      settings?.onRunCreated?.({ run_id: 'run-0', thread_id: 't' });
      yield* answer('Waiting')(payload as Payload) as StreamEvent[];
      yield pause;
    });
    expect(await f.session.submit('Question')).toBe('paused');
    expect(f.session.getSnapshot().interrupts).toHaveLength(1);
    f.stream.mockImplementationOnce(async function* (_a, _t, _p, _s, settings) {
      settings?.onRunCreated?.({ run_id: 'run-1', thread_id: 't' });
      yield partial;
    });
    expect(await f.session.resume({ approved: true })).toBe('error');
    expect(f.session.getSnapshot().error).toMatchObject({ recovery: 'retry' });
    f.stream.mockImplementationOnce(async function* (_a, _t, _p, _s, settings) {
      settings?.onRunCreated?.({ run_id: 'run-2', thread_id: 't' });
      yield {
        type: 'values',
        data: {
          messages: [
            ...f.session
              .getSnapshot()
              .messages.filter(({ role }) => role === 'user')
              .map(({ id, content }) => ({ type: 'human', id, content })),
            { type: 'ai', id: 'answer', content: 'Approved' },
          ],
        },
      };
    });
    expect(await retryOf(f.session)).toBe('success');
    expect(f.stream).toHaveBeenCalledTimes(3);
    expect(f.stream.mock.calls[2][2]).toBeNull();
    expect(f.stream.mock.calls[2][4]).toMatchObject({
      command: { resume: { approved: true } },
    });
    expect(f.stream.mock.calls[2][4]).toEqual(
      expect.objectContaining({ command: f.stream.mock.calls[1][4]?.command })
    );
    const snapshot = f.session.getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.messages.filter(({ role }) => role === 'user')).toHaveLength(1);
    expect(snapshot.messages.some(({ id }) => id === 'partial')).toBe(false);
  });

  it('is absent when the transport cannot read a run status', () => {
    const f = fixture([], [], { runStatus: false });
    expect(f.session.retry).toBeUndefined();
  });
});
