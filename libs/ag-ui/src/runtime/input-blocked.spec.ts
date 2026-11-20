import { describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { bindingFixture } from './testing/binding-fixture';

describe('inputBlocked', () => {
  it('is absent on an idle session and while a run is going', async () => {
    const fixture = bindingFixture();
    try {
      expect('inputBlocked' in fixture.session.getSnapshot()).toBe(false);
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      expect(fixture.session.getSnapshot().inputBlocked).toBeUndefined();
      first.emit({
        type: 'RUN_FINISHED',
        threadId: first.body.threadId,
        runId: first.body.runId,
      });
      await run;
      expect('inputBlocked' in fixture.session.getSnapshot()).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('names the waiting decision from the pause until its answer succeeds', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    try {
      const paused = session.submit('Go');
      const first = await fixture.started();
      first.emit({
        type: 'RUN_FINISHED',
        threadId: first.body.threadId,
        runId: first.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'i', reason: 'approval' }],
        },
      });
      expect(await paused).toBe('paused');
      expect(session.getSnapshot().inputBlocked).toBe('decision');
      // The refusal the field explains: nothing is sent.
      expect(await session.submit('Bypass')).toBe('error');
      expect(fixture.exchanges).toHaveLength(1);

      const answered = session.resume([{ interruptId: 'i', status: 'resolved' }]);
      const second = await fixture.started(1);
      expect(session.getSnapshot().inputBlocked).toBe('decision');
      second.emit({
        type: 'RUN_FINISHED',
        threadId: second.body.threadId,
        runId: second.body.runId,
      });
      expect(await answered).toBe('success');
      expect(session.getSnapshot().inputBlocked).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it('names a decision the session cannot answer', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      first.emit({ type: 'CUSTOM', name: 'on_interrupt', value: 'x' });
      await fixture.changed((snapshot) => snapshot.decision !== undefined);
      expect(fixture.session.getSnapshot().inputBlocked).toBe('decision');
      first.end();
      await run;
    } finally {
      await fixture.cleanup();
    }
  });

  it('names the client-tool blocker', async () => {
    const session = createSession(
      {
        threadId: 't',
        url: 'unused',
        fetch: async () =>
          new Response('', { headers: { 'content-type': 'text/event-stream' } }),
      },
      { f: { description: 'f', handler: () => 1 } }
    );
    expect(session.getSnapshot().inputBlocked).toBeUndefined();
    expect(await session.submit('Go')).toBe('interrupted');
    expect(session.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
    expect(session.getSnapshot().inputBlocked).toBe('client-tools');
    await session.dispose();
  });
});
