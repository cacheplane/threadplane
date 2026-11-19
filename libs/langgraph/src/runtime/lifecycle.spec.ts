import type { ThreadState } from '@langchain/langgraph-sdk';
import type { AgentError } from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLifecycleRecorder } from './lifecycle';
import type { StreamEvent } from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { saved } from './testing/checkpoint-fixture';

const failure = (message: string, kind: AgentError['kind'] = 'server') =>
  ({ kind, message, retryable: false }) satisfies AgentError;
const quiet = { interrupts: [], toolCalls: [] };

function recorder() {
  let at = 0;
  const r = createLifecycleRecorder(() => at);
  return { ...r, at: (time: number) => (at = time) };
}

describe('lifecycle recorder', () => {
  it('starts with every milestone null in a frozen, stable snapshot', () => {
    const r = recorder();
    const first = r.source.getSnapshot();
    expect(first).toEqual({
      streamStartedAt: null,
      streamErrorAt: null,
      interruptReceivedAt: null,
      interruptResolvedAt: null,
      threadPersistedAt: null,
      toolCallStartedAt: null,
      toolCallCompletedAt: null,
    });
    expect(Object.isFrozen(first)).toBe(true);
    r.observe(quiet);
    expect(r.source.getSnapshot()).toBe(first);
  });

  it('keeps the first stream start and history read, and the latest resume', () => {
    const r = recorder();
    for (const time of [100, 200]) {
      r.at(time);
      r.mark('streamStartedAt');
      r.mark('threadPersistedAt');
      r.mark('interruptResolvedAt');
    }
    expect(r.source.getSnapshot()).toMatchObject({
      streamStartedAt: 100,
      threadPersistedAt: 100,
      interruptResolvedAt: 200,
    });
  });

  it('stamps a failure once, and again when it changes or returns', () => {
    const r = recorder();
    r.at(10);
    r.observe({ ...quiet, error: failure('Down') });
    const first = r.source.getSnapshot();
    expect(first.streamErrorAt).toEqual({ at: 10, kind: 'server' });
    r.at(20);
    r.observe({ ...quiet, error: failure('Down') });
    expect(r.source.getSnapshot()).toBe(first);
    r.observe({ ...quiet, error: failure('Offline', 'connection') });
    expect(r.source.getSnapshot().streamErrorAt).toEqual({
      at: 20,
      kind: 'connection',
    });
    // The time of the last failure stays after it clears.
    r.at(30);
    r.observe(quiet);
    expect(r.source.getSnapshot().streamErrorAt?.at).toBe(20);
    r.at(40);
    r.observe({ ...quiet, error: failure('Offline', 'connection') });
    expect(r.source.getSnapshot().streamErrorAt?.at).toBe(40);
  });

  it('stamps the first interrupt and the first tool call start and finish', () => {
    const r = recorder();
    r.at(1);
    r.observe({ interrupts: [{}], toolCalls: [{ status: 'pending' }] });
    expect(r.source.getSnapshot()).toMatchObject({
      interruptReceivedAt: 1,
      toolCallStartedAt: 1,
      toolCallCompletedAt: null,
    });
    r.at(2);
    r.observe({ interrupts: [{}], toolCalls: [{ status: 'error' }] });
    r.at(3);
    r.observe({ interrupts: [], toolCalls: [{ status: 'complete' }] });
    r.observe({ interrupts: [{}], toolCalls: [{ status: 'pending' }] });
    expect(r.source.getSnapshot()).toMatchObject({
      interruptReceivedAt: 1,
      toolCallStartedAt: 1,
      toolCallCompletedAt: 2,
    });
  });

  it('notifies once per flush with changes, survives a throwing listener, and stops on unsubscribe', () => {
    const r = recorder();
    const seen = vi.fn();
    r.source.subscribe(() => {
      throw new Error('listener');
    });
    const stop = r.source.subscribe(seen);
    r.flush();
    expect(seen).not.toHaveBeenCalled();
    r.mark('streamStartedAt');
    r.observe({ interrupts: [{}], toolCalls: [] });
    r.flush();
    r.flush();
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    r.mark('interruptResolvedAt');
    r.flush();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

const ai = (id: string, content: string, extra: object = {}) => ({
  type: 'ai',
  id,
  content,
  ...extra,
});
const frame = (data: Record<string, unknown>): StreamEvent => ({
  type: 'values',
  data,
});
const paused = (): ThreadState =>
  saved('paused', [{ type: 'human', id: 'u', content: 'Go' }, ai('a', 'Wait')], {
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
  } as Partial<ThreadState>);

const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const f = controlledSession();
  cleanups.push(() => f.session.dispose());
  const clock = vi.spyOn(Date, 'now');
  return {
    ...f,
    at: (time: number) => clock.mockReturnValue(time),
    lifecycle: () => f.session.lifecycle.getSnapshot(),
  };
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

describe('lifecycle through the session', () => {
  it('stamps the stream start at the first event, not at submit', async () => {
    const f = fixture();
    const notified = vi.fn();
    f.session.lifecycle.subscribe(notified);
    f.at(1_000);
    const run = f.session.submit('Go');
    await f.started();
    expect(f.lifecycle().streamStartedAt).toBeNull();
    expect(notified).not.toHaveBeenCalled();
    f.at(2_000);
    await f.emit(frame({ messages: [ai('answer', 'Hel')] }));
    expect(f.lifecycle().streamStartedAt).toBe(2_000);
    expect(notified).toHaveBeenCalledTimes(1);
    f.at(3_000);
    await f.emit(frame({ messages: [ai('answer', 'Hello')] }));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.lifecycle().streamStartedAt).toBe(2_000);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('stamps tool calls as they start and finish', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    f.at(100);
    const call = { id: 'call', name: 'lookup', args: {} };
    await f.emit(frame({ messages: [ai('answer', '', { tool_calls: [call] })] }));
    expect(f.lifecycle()).toMatchObject({
      toolCallStartedAt: 100,
      toolCallCompletedAt: null,
    });
    f.at(250);
    await f.emit(
      frame({
        messages: [
          ai('answer', '', { tool_calls: [call] }),
          { type: 'tool', id: 'result', tool_call_id: 'call', content: 'ok' },
        ],
      })
    );
    expect(f.lifecycle()).toMatchObject({
      toolCallStartedAt: 100,
      toolCallCompletedAt: 250,
    });
    f.streams[0].finish();
    await run;
  });

  it('stamps saved history, its pending interrupt, and the resume that answers it', async () => {
    const f = fixture();
    f.at(10);
    await f.session.load!();
    // An empty thread has nothing saved.
    expect(f.lifecycle().threadPersistedAt).toBeNull();
    f.at(20);
    f.getHistory.mockResolvedValueOnce([paused()]);
    await f.session.load!();
    expect(f.lifecycle()).toMatchObject({
      threadPersistedAt: 20,
      interruptReceivedAt: 20,
      interruptResolvedAt: null,
      streamStartedAt: null,
    });
    f.at(30);
    f.getHistory.mockResolvedValueOnce([paused()]);
    const run = f.session.resume(true);
    await f.started();
    expect(f.lifecycle().interruptResolvedAt).toBe(30);
    f.at(40);
    await f.emit(frame({ messages: [ai('a', 'Done')] }));
    f.streams[0].finish();
    await run;
    expect(f.lifecycle()).toMatchObject({
      threadPersistedAt: 20,
      interruptReceivedAt: 20,
      interruptResolvedAt: 30,
      streamStartedAt: 40,
    });
  });

  it('stamps a failed run with its error kind', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    f.at(500);
    await f.emit({ type: 'error', data: { message: 'Unavailable' } });
    await run;
    const error = f.session.getSnapshot().error;
    expect(error).toBeDefined();
    expect(f.lifecycle().streamErrorAt).toEqual({ at: 500, kind: error!.kind });
  });

  it('stops notifying after dispose and ignores later subscribers', async () => {
    const f = fixture();
    const notified = vi.fn();
    f.session.lifecycle.subscribe(notified);
    await f.session.dispose();
    f.session.lifecycle.subscribe(notified)();
    expect(notified).not.toHaveBeenCalled();
    expect(Object.isFrozen(f.lifecycle())).toBe(true);
  });
});
