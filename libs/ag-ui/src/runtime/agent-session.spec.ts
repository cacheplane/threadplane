import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@threadplane/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The shared wording is compared with its LangGraph source.
import { RECOVERY_COPY } from '../../../langgraph/src/runtime/stream-projection';
import {
  createAgentSession,
  INTERRUPTED_COPY,
  type NativeSession,
} from './agent-session';
import {
  initialObservation,
  type SessionSnapshot,
} from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

type Records = NonNullable<Parameters<typeof initialObservation>[0]>;
const history: Records = [
  { id: 'u', role: 'user', content: 'Ask' },
  { id: 'a', role: 'assistant', content: 'Answer' },
];
/** A native session whose snapshot the test replaces by hand. */
function controlled(first: SessionSnapshot) {
  let snapshot = first;
  const listeners = new Set<() => void>();
  const native = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } satisfies NativeSession;
  return {
    native,
    listeners,
    publish(extra: Partial<SessionSnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...extra });
      for (const notify of [...listeners]) notify();
    },
  };
}

describe('createAgentSession', () => {
  it('publishes the native conversation as a frozen core snapshot', () => {
    const { native } = controlled(initialObservation(history));
    const session: AgentSession = createAgentSession(native);
    const snapshot = session.getSnapshot();
    expect(snapshot).toEqual({
      status: 'idle',
      messages: [
        expect.objectContaining({ id: 'u', role: 'user', content: 'Ask' }),
        expect.objectContaining({ id: 'a', role: 'assistant', content: 'Answer' }),
      ],
      toolCalls: [],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect('error' in snapshot).toBe(false);
    expect('plan' in snapshot).toBe(false);
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.checkStatus).toBeUndefined();
  });

  it('keeps its snapshot and stays silent when only native fields change', () => {
    const source = controlled(initialObservation(history));
    const session = createAgentSession(source.native);
    const before = session.getSnapshot();
    const notify = vi.fn();
    session.subscribe(notify);
    source.publish({ state: { model: 'small' } });
    source.publish({ reasoningDurations: { missing: 5 } });
    expect(notify).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toBe(before);
    source.publish({ status: 'running' });
    expect(notify).toHaveBeenCalledTimes(1);
    const running = session.getSnapshot();
    expect(running.status).toBe('running');
    expect(running.messages[0]).toBe(before.messages[0]);
  });

  it('tells each subscriber once per change and stops after release', () => {
    const source = controlled(initialObservation(history));
    const session = createAgentSession(source.native);
    const first = vi.fn();
    const second = vi.fn(() => void session.getSnapshot());
    const release = session.subscribe(first);
    session.subscribe(second);
    source.publish({ status: 'running' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    release();
    release();
    source.publish({ status: 'idle' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(source.listeners.size).toBe(1);
  });

  it('carries the declared plan by reference', () => {
    const plan = Object.freeze([
      Object.freeze({ id: '1', label: 'Search', status: 'pending' as const }),
    ]);
    const source = controlled(
      Object.freeze({ ...initialObservation(history), plan })
    );
    const session = createAgentSession(source.native);
    expect(session.getSnapshot().plan).toBe(plan);
    source.publish({ plan: undefined });
    expect('plan' in session.getSnapshot()).toBe(false);
  });

  it('reports the backend error text as a server failure with no recovery when the owner cannot retry', () => {
    const source = controlled(initialObservation(history));
    const session = createAgentSession(source.native);
    source.publish({
      status: 'error',
      run: {
        id: 'run',
        outcome: 'error',
        terminal: { type: 'RUN_ERROR', message: 'Model overloaded' } as never,
      },
    });
    const error = session.getSnapshot().error;
    expect(error).toEqual({
      kind: 'server',
      message: 'Model overloaded',
      retryable: false,
      recovery: 'none',
    });
    expect(Object.isFrozen(error)).toBe(true);
    source.publish({ state: { changed: true } });
    expect(session.getSnapshot().error).toBe(error);
  });

  it('reports a stream that ended without a terminal as interrupted', () => {
    const source = controlled(initialObservation(history));
    const session = createAgentSession(source.native);
    source.publish({ status: 'error', run: { id: 'run', outcome: 'interrupted' } });
    expect(session.getSnapshot().error).toEqual({
      kind: 'interrupted',
      message: INTERRUPTED_COPY.message,
      detail: INTERRUPTED_COPY.detail,
      retryable: false,
      recovery: 'none',
    });
    expect(INTERRUPTED_COPY).toEqual({
      message: RECOVERY_COPY.messages.none,
      detail: RECOVERY_COPY.details.none,
    });
  });

  it('reports a failure it cannot name generically and clears it on the next run', () => {
    const source = controlled(initialObservation(history));
    const session = createAgentSession(source.native);
    source.publish({ status: 'error', run: { id: 'run', outcome: 'error' } });
    expect(session.getSnapshot().error).toEqual({
      kind: 'server',
      message: 'The agent request failed.',
      retryable: false,
      recovery: 'none',
    });
    source.publish({ status: 'running', run: { id: 'next' } });
    expect('error' in session.getSnapshot()).toBe(false);
  });

  it('sends commands straight to the native session', async () => {
    const { native } = controlled(initialObservation());
    const session = createAgentSession(native);
    const signal = new AbortController().signal;
    await expect(session.submit('Hello', { signal })).resolves.toBe('success');
    expect(native.submit).toHaveBeenCalledWith('Hello', { signal });
    await session.stop();
    await session.dispose();
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('createAgentSession over the real owner', () => {
  it('streams a turn, completes it and reports a backend error on the next', async () => {
    const fixture = bindingFixture();
    const session = createAgentSession(fixture.session);
    const seen: string[] = [];
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      seen.push(`${snapshot.status}:${snapshot.messages.length}`);
    });
    try {
      const run = session.submit('Go');
      const exchange = await fixture.started();
      exchange.emit({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' });
      exchange.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Hi' });
      await fixture.changed((snapshot) =>
        snapshot.transcript.some((record) => record.content === 'Hi')
      );
      expect(session.getSnapshot()).toMatchObject({
        status: 'running',
        messages: [
          { role: 'user', content: 'Go' },
          { id: 'a1', content: 'Hi', delivery: { phase: 'streaming' } },
        ],
      });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'a1' });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      await expect(run).resolves.toBe('success');
      const done = session.getSnapshot();
      expect(done.status).toBe('idle');
      expect(done.messages[1].delivery).toMatchObject({
        phase: 'complete',
        outcome: 'success',
      });
      expect(new Set(seen).size).toBe(seen.length);

      const failed = session.submit('Again');
      const next = await fixture.started(1);
      next.emit({ type: 'RUN_ERROR', message: 'Quota exceeded' });
      await expect(failed).resolves.toBe('error');
      expect(session.getSnapshot()).toMatchObject({
        status: 'error',
        // The backend settled the outcome, and this owner can send it again.
        error: {
          kind: 'server',
          message: 'Quota exceeded',
          retryable: true,
          recovery: 'retry',
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
