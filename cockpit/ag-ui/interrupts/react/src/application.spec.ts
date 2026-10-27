import { EventType as E } from '@ag-ui/client';
import { expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import type { Session } from '@threadplane/ag-ui';
import { createInterruptsApplication } from './application';
type Snapshot = ReturnType<Session['getSnapshot']>;
function fakeSession(threadId: string) {
  let snapshot: Snapshot = {
    status: 'idle',
    transcript: [],
    state: {},
    subagents: [],
  };
  let count = 0,
    settle: ((outcome: CompleteOutcome) => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (update: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...update };
    for (const notify of listeners) notify();
  };
  function pending() {
    return new Promise<CompleteOutcome>((resolve) => {
      settle = resolve;
    });
  }
  const submit = vi.fn((text: string) => {
    const done = pending();
    count++;
    publish({
      status: 'running',
      transcript: [
        ...snapshot.transcript,
        { id: 'human-' + count, role: 'user', content: text },
      ],
      run: { id: 'run-' + count },
    });
    return done;
  });
  const resume = vi.fn(
    (
      _pause: Parameters<Session['resume']>[0],
      responses: Parameters<Session['resume']>[1]
    ) => {
      const done = pending();
      count++;
      const decision = snapshot.decision;
      if (decision?.kind !== 'native')
        throw new Error('Fixture has no native pause');
      publish({
        status: 'running',
        run: { id: 'run-' + count },
        decision: {
          ...decision,
          attempt: { runId: 'run-' + count, responses },
        },
      });
      return done;
    }
  );
  const session = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit,
    resume,
    stop: vi.fn(async () => {
      settle?.('aborted');
    }),
    dispose: vi.fn(async () => {
      settle?.('aborted');
    }),
    publish,
    pause(update: Partial<Snapshot> = {}) {
      const interrupt = {
        id: 'interrupt-' + count,
        reason: 'approval',
        metadata: {
          langgraph: {
            raw: {
              kind: 'refund_approval',
              amount: 25,
              customer_id: 'cus_demo',
              reason: 'Fictional damaged item',
            },
          },
        },
      };
      publish({
        status: 'idle',
        transcript: [
          ...snapshot.transcript,
          { id: 'draft-' + count, role: 'assistant', content: 'Draft ready.' },
        ],
        decision: {
          kind: 'native',
          id: ('opaque-' + count) as Parameters<Session['resume']>[0],
          sourceRunId: snapshot.run!.id,
          interrupts: [interrupt],
        },
        run: {
          id: snapshot.run!.id,
          outcome: 'paused',
          terminal: {
            type: E.RUN_FINISHED,
            threadId,
            runId: snapshot.run!.id,
            outcome: { type: 'interrupt', interrupts: [interrupt] },
          },
        },
        ...update,
      });
      settle?.('paused');
    },
    finish(
      update: Partial<Snapshot> = {},
      outcome: CompleteOutcome = 'success'
    ) {
      publish({
        status: 'idle',
        decision: undefined,
        transcript: [
          ...snapshot.transcript,
          {
            id: 'answer-' + count,
            role: 'assistant',
            content: 'Refund result.',
          },
        ],
        run: {
          id: snapshot.run!.id,
          outcome,
          terminal: { type: E.RUN_FINISHED, threadId, runId: snapshot.run!.id },
        },
        ...update,
      });
      settle?.(outcome);
    },
  };
  return session satisfies Session;
}
function fixture() {
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const factory = vi.fn((id: string) => {
    const session = fakeSession(id);
    sessions.push(session);
    return session;
  });
  const app = createInterruptsApplication({ sessionFactory: factory });
  return { app, sessions, factory };
}
async function waiting(f: ReturnType<typeof fixture>) {
  const pending = f.app.submit('  Fictional refund  ');
  f.sessions.at(-1)!.pause();
  await pending;
  return f.app.getSnapshot().approval!;
}
it.each(['approve', 'edit', 'cancel'] as const)(
  'lazily owns a single draft then exact native %s response',
  async (action) => {
    const f = fixture();
    expect(f.factory).not.toHaveBeenCalled();
    const approval = await waiting(f),
      session = f.sessions[0],
      id = f.app.getSnapshot().threadId;
    expect(session.submit).toHaveBeenCalledWith('  Fictional refund  ', {
      signal: expect.any(AbortSignal),
    });
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: false,
      canRespond: true,
      rows: expect.any(Array),
    });
    await f.app.submit('Cannot send while paused');
    const resumed = f.app.respond(
      approval,
      action,
      action === 'edit' ? 20 : undefined
    );
    expect(session.resume).toHaveBeenCalledWith(
      approval.pause,
      [
        {
          interruptId: approval.interruptId,
          status: 'resolved',
          payload:
            action === 'cancel'
              ? { approved: false }
              : action === 'edit'
              ? { approved: true, amount: 20 }
              : { approved: true },
        },
      ],
      { signal: expect.any(AbortSignal) }
    );
    session.finish();
    await resumed;
    expect(f.app.getSnapshot()).toMatchObject({
      threadId: id,
      canSubmit: true,
      canRespond: false,
      approval: undefined,
      outcome: 'success',
    });
    expect(f.app.getSnapshot().rows).toHaveLength(3);
    const next = f.app.submit('Next refund');
    session.pause();
    await next;
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.app.getSnapshot().rows).toHaveLength(5);
    await f.app.dispose();
  }
);
it('admits synchronously before subscribers, double clicks and Send', async () => {
  const f = fixture(),
    approval = await waiting(f);
  let entered = false;
  f.app.subscribe(() => {
    if (!entered && f.app.getSnapshot().busy) {
      entered = true;
      void f.app.respond(approval, 'cancel');
      void f.app.submit('Reentrant');
      void f.app.newConversation();
    }
  });
  const done = f.app.respond(approval, 'approve');
  await f.app.respond(approval, 'approve');
  expect(f.sessions[0].resume).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].submit).toHaveBeenCalledTimes(1);
  f.sessions[0].finish();
  await done;
  await f.app.dispose();
});
it.each([-1, NaN, Infinity])(
  'rejects unsafe edited amount %s without claiming the native pause',
  async (amount) => {
    const f = fixture(),
      approval = await waiting(f);
    await f.app.respond(approval, 'edit', amount);
    expect(f.sessions[0].resume).not.toHaveBeenCalled();
    expect(f.app.getSnapshot().canRespond).toBe(true);
    await f.app.dispose();
  }
);
it('New clears lazily and stale card callbacks cannot address a new pause', async () => {
  const f = fixture(),
    old = await waiting(f);
  await f.app.newConversation();
  expect(f.factory).toHaveBeenCalledTimes(1);
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    approval: undefined,
    canRespond: false,
    canSubmit: true,
  });
  const fresh = await waiting(f);
  await f.app.respond(old, 'approve');
  expect(f.sessions[1].resume).not.toHaveBeenCalled();
  expect(f.app.getSnapshot().approval).toBe(fresh);
  await f.app.dispose();
});
it('rechecks the current native pause before native resume', async () => {
  const f = fixture(),
    approval = await waiting(f),
    session = f.sessions[0];
  const root = session.getSnapshot();
  session.getSnapshot = () => ({
    ...root,
    decision: { ...root.decision!, sourceRunId: 'stale' },
  });
  await f.app.respond(approval, 'approve');
  expect(session.resume).not.toHaveBeenCalled();
  await f.app.dispose();
});
it.each(['error', 'interrupted', 'paused', 'aborted'] as const)(
  'requires New after uncertain native resume %s and never replays',
  async (outcome) => {
    const f = fixture(),
      approval = await waiting(f),
      session = f.sessions[0];
    const done = f.app.respond(approval, 'approve');
    session.finish({}, outcome);
    await done;
    await f.app.respond(approval, 'approve');
    await f.app.submit('Replay');
    expect(session.resume).toHaveBeenCalledTimes(1);
    expect(session.submit).toHaveBeenCalledTimes(1);
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      canRespond: false,
    });
    await f.app.dispose();
  }
);
it('Stop revokes before abort and fences late resume evidence', async () => {
  const f = fixture(),
    approval = await waiting(f),
    session = f.sessions[0];
  const done = f.app.respond(approval, 'approve');
  await f.app.stop();
  await done;
  const stopped = f.app.getSnapshot();
  session.finish();
  expect(f.app.getSnapshot()).toBe(stopped);
  expect(session.stop).toHaveBeenCalledTimes(1);
  expect(session.dispose).toHaveBeenCalledTimes(1);
  await f.app.newConversation();
  expect(f.factory).toHaveBeenCalledTimes(1);
  await f.app.dispose();
});
it('dispose while paused synchronously revokes stale card commands and is idempotent', async () => {
  const f = fixture(),
    approval = await waiting(f);
  const before = f.app.getSnapshot(),
    one = f.app.dispose(),
    two = f.app.dispose();
  expect(one).toBe(two);
  await one;
  await f.app.respond(approval, 'approve');
  expect(f.app.getSnapshot()).toBe(before);
  expect(f.sessions[0].resume).not.toHaveBeenCalled();
});
it('throwing observers and cleanup cannot break an owned cycle', async () => {
  const f = fixture();
  f.app.subscribe(() => {
    throw new Error('View');
  });
  const approval = await waiting(f),
    session = f.sessions[0];
  const done = f.app.respond(approval, 'approve');
  session.finish();
  await done;
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  session.dispose.mockRejectedValue(new Error('Cleanup'));
  await f.app.newConversation();
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  await f.app.dispose();
});
it('reentrant factory disposal never dispatches its returned session', async () => {
  const session = fakeSession('candidate');
  const app = createInterruptsApplication({
    sessionFactory: () => {
      void app.dispose();
      return session;
    },
  });
  await app.submit('Refund');
  await app.dispose();
  expect(session.submit).not.toHaveBeenCalled();
  expect(session.dispose).toHaveBeenCalledTimes(1);
});
it.each(['legacy', 'tool', 'child'] as const)(
  'unsupported %s evidence stays blocked even if later removed',
  async (kind) => {
    const f = fixture(),
      approval = await waiting(f),
      session = f.sessions[0],
      root = session.getSnapshot();
    if (kind === 'legacy')
      session.publish({
        run: {
          ...root.run!,
          legacyInterrupt: { type: E.CUSTOM, name: 'on_interrupt', value: {} },
        },
      });
    if (kind === 'tool')
      session.publish({
        transcript: [
          ...root.transcript,
          {
            id: 'tool',
            role: 'tool',
            toolCallId: 'call',
            content: 'Private tool',
          },
        ],
      });
    if (kind === 'child')
      session.publish({
        subagents: [
          {
            started: {
              type: E.SUBAGENT_STARTED,
              subagentRunId: 'child',
              name: 'worker',
            },
          },
        ],
      });
    expect(f.app.getSnapshot().canRespond).toBe(false);
    session.publish(root);
    await f.app.respond(approval, 'approve');
    expect(session.resume).not.toHaveBeenCalled();
    await f.app.dispose();
  }
);
it('borrowed getSnapshot revocation cannot authorize resume', async () => {
  const f = fixture(),
    approval = await waiting(f),
    session = f.sessions[0],
    read = session.getSnapshot;
  session.getSnapshot = () => {
    void f.app.dispose();
    return read();
  };
  await f.app.respond(approval, 'approve');
  await f.app.dispose();
  expect(session.resume).not.toHaveBeenCalled();
});
it('rechecks sticky unsafe evidence introduced by the busy publication before resume', async () => {
  const f = fixture(),
    approval = await waiting(f),
    session = f.sessions[0],
    root = session.getSnapshot();
  let entered = false;
  f.app.subscribe(() => {
    if (!entered && f.app.getSnapshot().busy) {
      entered = true;
      session.publish({
        subagents: [
          {
            started: {
              type: E.SUBAGENT_STARTED,
              subagentRunId: 'child',
              name: 'worker',
            },
          },
        ],
      });
      session.publish(root);
    }
  });
  const done = f.app.respond(approval, 'approve');
  expect(session.resume).not.toHaveBeenCalled();
  await done;
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    canRespond: false,
  });
  await f.app.dispose();
});
it.each([
  'wrong-terminal',
  'changed-prefix',
  'no-terminal',
  'old-state',
] as const)('resume cannot succeed on %s evidence', async (kind) => {
  const f = fixture(),
    approval = await waiting(f),
    session = f.sessions[0];
  const done = f.app.respond(approval, 'approve'),
    root = session.getSnapshot();
  let update: Partial<Snapshot> = {};
  if (kind === 'wrong-terminal')
    update = {
      run: {
        id: root.run!.id,
        outcome: 'success',
        terminal: {
          type: E.RUN_FINISHED,
          threadId: 'wrong',
          runId: root.run!.id,
        },
      },
    };
  if (kind === 'changed-prefix')
    update = {
      transcript: [
        { id: root.transcript[0].id, role: 'user', content: 'Changed' },
        ...root.transcript.slice(1),
        { id: 'answer', role: 'assistant', content: 'Result' },
      ],
    };
  if (kind === 'no-terminal')
    update = { run: { id: root.run!.id, outcome: 'success' } };
  if (kind === 'old-state')
    update = {
      state: { refund_id: 'old', decision_approved: true },
      transcript: root.transcript,
    };
  session.finish(update);
  await done;
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    canRespond: false,
  });
  await f.app.respond(approval, 'approve');
  expect(session.resume).toHaveBeenCalledTimes(1);
  await f.app.dispose();
});
it('a constructor failure is private and cannot retry until New', async () => {
  const factory = vi.fn(() => {
    throw new Error('PRIVATE key');
  });
  const app = createInterruptsApplication({ sessionFactory: factory });
  await app.submit('Refund');
  await app.submit('Replay');
  expect(factory).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(app.getSnapshot())).not.toContain('PRIVATE');
  await app.newConversation();
  await app.submit('Fresh');
  expect(factory).toHaveBeenCalledTimes(2);
  await app.dispose();
});
