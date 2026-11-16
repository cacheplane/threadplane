import { describe, expect, it } from 'vitest';
import { createAgentSession } from './agent-session';
import { createSession } from './create-session';
import { bindingFixture } from './testing/binding-fixture';

/** Calls retry, failing the test instead of passing when the session has none. */
function retryOf<T>(session: { retry?(): Promise<T> }): Promise<T> {
  if (!session.retry) throw new Error('The session has no retry.');
  return session.retry();
}

const usage = [
  { provider: 'openai', model: 'small', inputTokens: 12, outputTokens: 3 },
];

describe('retry over the native owner', () => {
  it('sends a submission that ended in RUN_ERROR again without a second user message', async () => {
    const fixture = bindingFixture();
    const session = createAgentSession(fixture.session);
    try {
      const failed = session.submit('Plan a visit');
      const first = await fixture.started();
      first.emit({ type: 'TEXT_MESSAGE_START', messageId: 'partial', role: 'assistant' });
      first.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'partial', delta: 'Half' });
      first.emit({ type: 'TEXT_MESSAGE_END', messageId: 'partial' });
      first.emit({ type: 'RUN_ERROR', message: 'Model overloaded', usage });
      await expect(failed).resolves.toBe('error');
      expect(session.getSnapshot()).toMatchObject({
        status: 'error',
        error: {
          kind: 'server',
          message: 'Model overloaded',
          retryable: true,
          recovery: 'retry',
        },
        usage: { entries: usage },
      });

      const retried = retryOf(session);
      const second = await fixture.started(1);
      expect(fixture.exchanges).toHaveLength(2);
      // The same request history: one user message with the same identity.
      expect(second.body.messages).toEqual(first.body.messages);
      expect(
        second.body.messages.filter((message) => message.role === 'user')
      ).toHaveLength(1);
      expect(second.body.runId).not.toBe(first.body.runId);
      const running = session.getSnapshot();
      expect(running.status).toBe('running');
      expect(running.messages.map((message) => message.id)).toEqual([
        first.body.messages[0].id,
      ]);
      expect('usage' in running).toBe(false);
      expect('error' in running).toBe(false);

      second.emit({ type: 'TEXT_MESSAGE_START', messageId: 'answer', role: 'assistant' });
      second.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'Done' });
      second.emit({ type: 'TEXT_MESSAGE_END', messageId: 'answer' });
      second.emit({
        type: 'RUN_FINISHED',
        threadId: second.body.threadId,
        runId: second.body.runId,
        usage: [{ model: 'small', totalTokens: 9, ignored: 'x' }],
      });
      await retried;
      const done = session.getSnapshot();
      expect(done).toMatchObject({ status: 'idle' });
      expect(done.messages.map((message) => message.content)).toEqual([
        'Plan a visit',
        'Done',
      ]);
      expect(done.usage).toEqual({ entries: [{ model: 'small', totalTokens: 9 }] });
      expect(Object.isFrozen(done.usage?.entries[0])).toBe(true);
      // Nothing failed now, so another retry sends nothing.
      await retryOf(session);
      expect(fixture.exchanges).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses a stream that ended without a terminal and sends nothing', async () => {
    const fixture = bindingFixture();
    const session = createAgentSession(fixture.session);
    try {
      const failed = session.submit('Go');
      const first = await fixture.started();
      first.end();
      await expect(failed).resolves.toBe('interrupted');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'interrupted',
        retryable: false,
        recovery: 'none',
      });
      await expect(retryOf(session)).rejects.toThrow(/cannot be retried/);
      await expect(retryOf(fixture.session)).resolves.toBe('error');
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is a no-op with nothing saved and while a run is active', async () => {
    const fixture = bindingFixture();
    const session = createAgentSession(fixture.session);
    try {
      await retryOf(session);
      await expect(retryOf(fixture.session)).resolves.toBe('aborted');
      expect(fixture.exchanges).toHaveLength(0);
      const run = session.submit('Go');
      const first = await fixture.started();
      await retryOf(session);
      await expect(retryOf(fixture.session)).resolves.toBe('aborted');
      first.emit({ type: 'RUN_ERROR', message: 'Failed' });
      await run;
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps usage per run: a run that reports none clears the previous count', async () => {
    const fixture = bindingFixture();
    const session = createAgentSession(fixture.session);
    try {
      const first = session.submit('One');
      const one = await fixture.started();
      one.emit({
        type: 'RUN_FINISHED',
        threadId: one.body.threadId,
        runId: one.body.runId,
        usage,
      });
      await first;
      const reported = session.getSnapshot().usage;
      expect(reported).toEqual({ entries: usage });
      expect(session.getSnapshot().usage).toBe(reported);
      const second = session.submit('Two');
      const two = await fixture.started(1);
      expect('usage' in session.getSnapshot()).toBe(false);
      two.emit({
        type: 'RUN_FINISHED',
        threadId: two.body.threadId,
        runId: two.body.runId,
      });
      await second;
      expect('usage' in session.getSnapshot()).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is absent over the client-tool owner, which treats every sent failure as uncertain', () => {
    const native = createSession(
      { url: 'https://native-fixture.invalid/run', threadId: 't' },
      {
        lookup: {
          description: 'Look up',
          handler: () => 'found',
        },
      }
    );
    expect('retry' in native).toBe(false);
    expect(createAgentSession(native).retry).toBeUndefined();
  });
});
