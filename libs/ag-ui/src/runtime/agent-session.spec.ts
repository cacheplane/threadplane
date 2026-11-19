import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@threadplane/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The shared wording is compared with its LangGraph source.
import { RECOVERY_COPY } from '../../../langgraph/src/runtime/stream-projection';
import { createPresenter, INTERRUPTED_COPY } from './agent-session';
import { initialObservation, type Observation } from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

type Records = NonNullable<Parameters<typeof initialObservation>[0]>;
const history: Records = [
  { id: 'u', role: 'user', content: 'Ask' },
  { id: 'a', role: 'assistant', content: 'Answer' },
];
/** A presenter over an observation the test replaces by hand. */
function controlled(first: Observation, canRetry = false) {
  const present = createPresenter(undefined, canRetry);
  let observation = first;
  return {
    getSnapshot: () => present(observation),
    publish(extra: Partial<Observation>) {
      observation = Object.freeze({ ...observation, ...extra });
    },
  };
}

describe('the published snapshot', () => {
  it('is the frozen core snapshot with the protocol evidence behind it', () => {
    const observation = initialObservation(history);
    const session = controlled(observation);
    const snapshot = session.getSnapshot();
    expect(snapshot).toEqual({
      status: 'idle',
      messages: [
        expect.objectContaining({ id: 'u', role: 'user', content: 'Ask' }),
        expect.objectContaining({ id: 'a', role: 'assistant', content: 'Answer' }),
      ],
      toolCalls: [],
      transcript: observation.transcript,
      subagents: [],
    });
    expect(snapshot.transcript).toBe(observation.transcript);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect('error' in snapshot).toBe(false);
    expect('plan' in snapshot).toBe(false);
    expect('state' in snapshot).toBe(false);
    expect(session.getSnapshot()).toBe(snapshot);
  });

  it('shares what did not change between observations', () => {
    const session = controlled(initialObservation(history));
    const before = session.getSnapshot();
    session.publish({ reasoningDurations: { missing: 5 } });
    const timed = session.getSnapshot();
    expect(timed).not.toBe(before);
    expect(timed.messages).toBe(before.messages);
    expect(timed.toolCalls).toBe(before.toolCalls);
    session.publish({ status: 'running' });
    const running = session.getSnapshot();
    expect(running.status).toBe('running');
    expect(running.messages[0]).toBe(before.messages[0]);
  });

  it('carries the declared plan by reference', () => {
    const plan = Object.freeze([
      Object.freeze({ id: '1', label: 'Search', status: 'pending' as const }),
    ]);
    const session = controlled(
      Object.freeze({ ...initialObservation(history), plan })
    );
    expect(session.getSnapshot().plan).toBe(plan);
  });

  it('reports the backend error text as a server failure with no recovery when the owner cannot retry', () => {
    const session = controlled(initialObservation(history));
    session.publish({
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
    session.publish({ state: { changed: true } });
    expect(session.getSnapshot().error).toBe(error);
  });

  it('reports a stream that ended without a terminal as interrupted', () => {
    const session = controlled(initialObservation(history));
    session.publish({ status: 'error', run: { id: 'run', outcome: 'interrupted' } });
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
    const session = controlled(initialObservation(history));
    session.publish({ status: 'error', run: { id: 'run', outcome: 'error' } });
    expect(session.getSnapshot().error).toEqual({
      kind: 'server',
      message: 'The agent request failed.',
      retryable: false,
      recovery: 'none',
    });
    session.publish({ status: 'running', run: { id: 'next' } });
    expect('error' in session.getSnapshot()).toBe(false);
  });
});

describe('the real session as a core session', () => {
  it('streams a turn, completes it and reports a backend error on the next', async () => {
    const fixture = bindingFixture();
    const session: AgentSession = fixture.session;
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
