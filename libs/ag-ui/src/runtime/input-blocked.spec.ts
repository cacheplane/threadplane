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
      expect(session.getSnapshot().inputBlocked?.reason).toBe('decision');
      // The refusal the field explains: nothing is sent.
      expect(await session.submit('Bypass')).toBe('error');
      expect(fixture.exchanges).toHaveLength(1);

      const answered = session.resume([
        { interruptId: 'i', status: 'resolved' },
      ]);
      const second = await fixture.started(1);
      expect(session.getSnapshot().inputBlocked?.reason).toBe('decision');
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

  it('rejects an answer aimed at an earlier pause whose interrupt ids repeat', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    const pauseOn = (exchange: Awaited<ReturnType<typeof fixture.started>>) =>
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'i', reason: 'approval' }],
        },
      });
    const yes = [{ interruptId: 'i', status: 'resolved' as const }];
    try {
      const paused = session.submit('Go');
      pauseOn(await fixture.started());
      await paused;
      const first = session.getSnapshot().decision;
      if (first?.kind !== 'native') throw new Error('No pause.');
      // The first control answers, and the backend pauses again on the same id.
      const answered = session.resume(yes, { pause: first.id });
      pauseOn(await fixture.started(1));
      expect(await answered).toBe('paused');
      const second = session.getSnapshot().decision;
      if (second?.kind !== 'native') throw new Error('No pause.');
      expect(second.id).not.toBe(first.id);

      await expect(session.resume(yes, { pause: first.id })).rejects.toThrow(
        'Stale pause'
      );
      expect(fixture.exchanges).toHaveLength(2);
      // The pause is untouched and its own control still answers it.
      expect(session.getSnapshot().decision).toBe(second);
      const again = session.resume(yes, { pause: second.id });
      const third = await fixture.started(2);
      third.emit({
        type: 'RUN_FINISHED',
        threadId: third.body.threadId,
        runId: third.body.runId,
      });
      expect(await again).toBe('success');
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
      expect(fixture.session.getSnapshot().inputBlocked?.reason).toBe('decision');
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
          new Response('', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
      { f: { description: 'f', handler: () => 1 } }
    );
    expect(session.getSnapshot().inputBlocked).toBeUndefined();
    expect(await session.submit('Go')).toBe('interrupted');
    expect(session.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
    expect(session.getSnapshot().inputBlocked?.reason).toBe('client-tools');
    await session.dispose();
  });
});
