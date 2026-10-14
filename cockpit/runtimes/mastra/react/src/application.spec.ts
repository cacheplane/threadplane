import { expect, it, vi } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import { createMastraApplication } from './application';
import { EventType as E } from '@ag-ui/client';
type Snapshot = ReturnType<Session['getSnapshot']>;
const human = {
  id: 'human',
  role: 'user' as const,
  content: 'Reserve North Pines for 2 nights.',
};
const notice = () => ({
  type: 'mastra_suspend',
  toolName: 'reserve_campsite',
  runId: 'source',
  toolCallId: 'call',
  suspendPayload: { site: 'North Pines', nights: 2, total_usd: 90 },
  args: { site: 'North Pines', nights: 2 },
});
const interrupt = () => ({
  id: 'opaque-interrupt',
  reason: 'mastra:tool_suspend',
  toolCallId: 'call',
  metadata: { mastra: notice() },
});
const running = (): Snapshot => ({
  status: 'running',
  state: {},
  transcript: [human],
  subagents: [],
  run: { id: 'source' },
});
const paused = (): Snapshot => ({
  ...running(),
  status: 'idle',
  decision: {
    kind: 'native',
    id: 'opaque-pause' as Parameters<Session['resume']>[0],
    sourceRunId: 'source',
    interrupts: [interrupt()],
  },
  run: {
    id: 'source',
    outcome: 'paused',
    legacyInterrupt: {
      type: E.CUSTOM,
      name: 'on_interrupt',
      value: JSON.stringify(notice()),
    },
    terminal: {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'source',
      outcome: { type: 'interrupt', interrupts: [interrupt()] },
    },
  },
});
const expected = (approved: boolean) =>
  JSON.stringify(
    approved
      ? 'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.'
      : 'Reservation for North Pines was declined by the user. Nothing was booked.'
  );
const completed = (approved = true): Snapshot => ({
  ...running(),
  status: 'idle',
  transcript: [
    human,
    {
      id: 'result',
      role: 'tool',
      toolCallId: 'call',
      content: expected(approved),
    },
    {
      id: 'answer',
      role: 'assistant',
      content: approved ? 'Booked.' : 'Declined.',
    },
  ],
  run: {
    id: 'resume',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'resume' },
  },
});

function harness() {
  let native: Snapshot = {
    status: 'idle',
    transcript: [],
    state: {},
    subagents: [],
  };
  let notify: () => void = () => undefined;
  let settle!: (outcome: CompleteOutcome) => void;
  let thread = '';
  const session: Session = {
    getSnapshot: vi.fn(() => native),
    subscribe: vi.fn((listener) => {
      notify = listener;
      return vi.fn();
    }),
    submit: vi.fn(() => {
      native = running();
      notify();
      return new Promise<CompleteOutcome>((resolve) => {
        settle = resolve;
      });
    }),
    resume: vi.fn(() => {
      const p = paused();
      native = {
        ...p,
        status: 'running',
        run: { id: 'resume' },
        decision: {
          ...p.decision!,
          attempt: { runId: 'resume', responses: [] },
        },
      } as Snapshot;
      notify();
      return new Promise<CompleteOutcome>((resolve) => {
        settle = resolve;
      });
    }),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const factory = vi.fn((id: string) => {
    thread = id;
    return session;
  });
  const app: ReturnType<typeof createMastraApplication> =
    createMastraApplication({ sessionFactory: factory });
  const update = (s: Snapshot) => {
    const terminal = s.run?.terminal;
    native =
      terminal?.type === 'RUN_FINISHED'
        ? {
            ...s,
            run: { ...s.run!, terminal: { ...terminal, threadId: thread } },
          }
        : s;
    notify();
  };
  const finish = (s: Snapshot, outcome: CompleteOutcome) => {
    expect(settle).toBeTypeOf('function');
    update(s);
    settle(outcome);
  };
  const pause = async () => {
    const pending = app.submit('Reserve North Pines for 2 nights.');
    finish(paused(), 'paused');
    await pending;
    return app.getSnapshot().approval!;
  };
  return { app, session, factory, update, finish, pause };
}
it('is inert before Send and creates a UUID thread lazily; concurrent submit and pending ordinary input never invoke', async () => {
  const h = harness();
  expect(h.factory).not.toHaveBeenCalled();
  await h.app.submit('   ');
  expect(h.factory).not.toHaveBeenCalled();
  const first = h.app.submit('Reserve');
  await h.app.submit('duplicate');
  expect(h.factory.mock.calls[0][0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  h.finish(paused(), 'paused');
  await first;
  await h.app.submit('bypass');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});
it.each(['approve', 'decline'] as const)(
  'first %s wins and emits exact top-level native response; literal correlated result confirms',
  async (action) => {
    const h = harness();
    const approval = await h.pause();
    const pending = h.app.decide(approval, action);
    await h.app.decide(approval, action === 'approve' ? 'decline' : 'approve');
    expect(h.session.resume).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.session.resume).mock.calls[0].slice(0, 2)).toEqual([
      'opaque-pause',
      [
        {
          interruptId: 'opaque-interrupt',
          status: 'resolved',
          payload: { approved: action === 'approve' },
        },
      ],
    ]);
    h.finish(completed(action === 'approve'), 'success');
    await pending;
    expect(h.app.getSnapshot()).toMatchObject({
      reservation: action === 'approve' ? 'approved' : 'declined',
      canSubmit: true,
      requiresNew: false,
    });
    await h.app.decide(approval, action);
    expect(h.session.resume).toHaveBeenCalledTimes(1);
  }
);
it.each(['terminal', 'result', 'mismatch', 'interrupted'] as const)(
  'accepted resume with lost %s requires New and never replays',
  async (loss) => {
    const h = harness();
    const a = await h.pause();
    const pending = h.app.decide(a, 'approve');
    const s = completed(loss !== 'mismatch');
    h.finish(
      loss === 'terminal'
        ? { ...s, run: { ...s.run!, terminal: undefined } }
        : loss === 'result'
        ? { ...s, transcript: s.transcript.filter((m) => m.role !== 'tool') }
        : s,
      loss === 'interrupted' ? 'interrupted' : 'success'
    );
    await pending;
    expect(h.app.getSnapshot()).toMatchObject({
      requiresNew: true,
      canSubmit: false,
      reservation: 'unconfirmed',
    });
    await h.app.decide(a, 'approve');
    await h.app.submit('retry');
    expect(h.session.resume).toHaveBeenCalledTimes(1);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
  }
);
it('New revokes active execution before cleanup and stale view callbacks never create a new session', async () => {
  const h = harness();
  const generation = h.app.getSnapshot().viewGeneration;
  const old = h.app.submit('Reserve');
  let release!: () => void;
  vi.mocked(h.session.dispose).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const replacing = h.app.newConversation();
  await Promise.resolve();
  await h.app.submit('early');
  expect(h.factory).toHaveBeenCalledTimes(1);
  h.finish(paused(), 'paused');
  await old;
  expect(h.app.getSnapshot().approval).toBeUndefined();
  release();
  await replacing;
  await h.app.submit('stale', generation);
  expect(h.factory).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot()).toMatchObject({
    threadId: null,
    canSubmit: true,
  });
});
it('Stop revokes a settled pause and dispose is idempotent', async () => {
  const h = harness();
  const a = await h.pause();
  await h.app.stop();
  await h.app.decide(a, 'approve');
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().requiresNew).toBe(true);
  await h.app.dispose();
  await h.app.dispose();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});
it('publication and session factory reentrancy revoke before native submission', async () => {
  const h = harness();
  h.app.subscribe(() => {
    if (h.app.getSnapshot().busy) void h.app.stop();
  });
  await h.app.submit('Reserve');
  expect(h.session.submit).not.toHaveBeenCalled();
  const factory = vi.fn(() => {
    void app.newConversation();
    return h.session;
  });
  const app: ReturnType<typeof createMastraApplication> =
    createMastraApplication({ sessionFactory: factory });
  await app.submit('Reserve');
  expect(h.session.submit).not.toHaveBeenCalled();
  await app.dispose();
});
it('method getter reentrancy makes zero resume calls and getter errors require New', async () => {
  const h = harness();
  const a = await h.pause();
  const resume = vi.fn(async () => 'success' as const);
  Object.defineProperty(h.session, 'resume', {
    get() {
      void h.app.stop();
      return resume;
    },
  });
  await h.app.decide(a, 'approve');
  expect(resume).not.toHaveBeenCalled();
  const next = harness();
  await next.pause();
  vi.mocked(next.session.getSnapshot).mockImplementation(() => {
    throw new Error('read failed');
  });
  await next.app.decide(next.app.getSnapshot().approval!, 'approve');
  expect(next.app.getSnapshot().requiresNew).toBe(true);
  expect(next.session.resume).not.toHaveBeenCalled();
});
it('cleanup errors cannot retain controls or prevent replacement', async () => {
  const h = harness();
  const a = await h.pause();
  vi.mocked(h.session.dispose).mockRejectedValue(new Error('cleanup'));
  vi.mocked(h.session.stop).mockRejectedValue(new Error('stop'));
  await h.app.newConversation();
  await h.app.decide(a, 'approve');
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('informational notice while running has no controls and does not poison the later native pause', async () => {
  const h = harness();
  const pending = h.app.submit('Reserve');
  const p = paused();
  h.update({
    ...p,
    status: 'running',
    decision: { kind: 'unsupported', sourceRunId: 'source' },
    run: { ...p.run!, outcome: undefined, terminal: undefined },
  });
  expect(h.app.getSnapshot()).toMatchObject({
    approval: undefined,
    canRespond: false,
    requiresNew: false,
  });
  h.finish(paused(), 'paused');
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    canRespond: true,
    reservation: 'pending',
    requiresNew: false,
  });
});
it('a backend result observed before terminal is never presented as confirmed', async () => {
  const h = harness();
  const a = await h.pause();
  const pending = h.app.decide(a, 'approve');
  const s = completed();
  h.update({ ...s, status: 'running', run: { id: 'resume' } });
  expect(h.app.getSnapshot()).toMatchObject({
    reservation: 'pending',
    result: null,
    canSubmit: false,
    canRespond: false,
  });
  h.finish(
    { ...s, status: 'error', run: { id: 'resume', outcome: 'interrupted' } },
    'interrupted'
  );
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    reservation: 'unconfirmed',
    requiresNew: true,
    result: null,
  });
});
it.each(['factory', 'subscription', 'submit', 'resume'] as const)(
  'thrown %s requires New without replay',
  async (kind) => {
    const h = harness();
    if (kind === 'factory')
      h.factory.mockImplementation(() => {
        throw new Error('factory');
      });
    if (kind === 'subscription')
      vi.mocked(h.session.subscribe).mockImplementation(() => {
        throw new Error('subscribe');
      });
    if (kind === 'submit')
      vi.mocked(h.session.submit).mockImplementation(() => {
        throw new Error('submit');
      });
    if (kind === 'resume') {
      const a = await h.pause();
      vi.mocked(h.session.resume).mockImplementation(() => {
        throw new Error('resume');
      });
      await h.app.decide(a, 'approve');
    } else await h.app.submit('Reserve');
    expect(h.app.getSnapshot()).toMatchObject({
      canRespond: false,
      canSubmit: false,
      requiresNew: true,
    });
    await h.app.submit('retry');
    await h.app.dispose();
  }
);
it('subscription reentrancy revokes the just-created owner before native methods run', async () => {
  const h = harness();
  vi.mocked(h.session.subscribe).mockImplementation(() => {
    void h.app.newConversation();
    return vi.fn();
  });
  await h.app.submit('Reserve');
  expect(h.session.submit).not.toHaveBeenCalled();
  await h.app.dispose();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});
it('reentrant resume decision during a snapshot getter cannot beat the synchronous first claim', async () => {
  const h = harness();
  const a = await h.pause();
  vi.mocked(h.session.getSnapshot).mockImplementation(() => {
    void h.app.decide(a, 'decline');
    return pausedForThread();
  });
  function pausedForThread(): Snapshot {
    const s = paused();
    const t = s.run!.terminal!;
    if (t.type !== E.RUN_FINISHED) throw new Error('fixture');
    return {
      ...s,
      run: {
        ...s.run!,
        terminal: { ...t, threadId: h.app.getSnapshot().threadId! },
      },
    };
  }
  const pending = h.app.decide(a, 'approve');
  expect(h.session.resume).toHaveBeenCalledTimes(1);
  h.finish(completed(), 'success');
  await pending;
});
it('dispose during native work revokes publication and rejects old callbacks', async () => {
  const h = harness();
  const pending = h.app.submit('Reserve');
  const before = h.app.getSnapshot();
  await h.app.dispose();
  h.finish(paused(), 'paused');
  await pending;
  expect(h.app.getSnapshot()).toBe(before);
  await h.app.submit('after dispose');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});
it('a changed or expired settled approval revokes displayed authority immediately', async () => {
  const h = harness();
  const a = await h.pause();
  const s = paused();
  h.update({
    ...s,
    decision: {
      ...s.decision!,
      interrupts: [{ ...interrupt(), expiresAt: '2020-01-01' }],
    },
  } as Snapshot);
  expect(h.app.getSnapshot()).toMatchObject({
    approval: undefined,
    canRespond: false,
    requiresNew: true,
  });
  await h.app.decide(a, 'approve');
  expect(h.session.resume).not.toHaveBeenCalled();
});
it('reentrant New during uncertain settlement cannot inherit the previous outcome', async () => {
  const h = harness();
  const a = await h.pause();
  h.app.subscribe(() => {
    if (h.app.getSnapshot().requiresNew) void h.app.newConversation();
  });
  const pending = h.app.decide(a, 'approve');
  h.finish(
    { ...completed(), run: { id: 'resume', outcome: 'interrupted' } },
    'interrupted'
  );
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    threadId: null,
    outcome: null,
    reservation: 'none',
  });
  await h.app.dispose();
});
it('the next Send clears prior reservation evidence before native execution begins', async () => {
  const h = harness();
  const a = await h.pause();
  const resume = h.app.decide(a, 'approve');
  h.finish(completed(), 'success');
  await resume;
  expect(h.app.getSnapshot().result).not.toBeNull();
  const next = h.app.submit('Reserve a different campsite');
  expect(h.app.getSnapshot()).toMatchObject({
    reservation: 'none',
    result: null,
    canRespond: false,
  });
  h.finish(paused(), 'paused');
  await next;
});
it('Stop during native work aborts the owned signal and late settlement cannot publish', async () => {
  const h = harness();
  const pending = h.app.submit('Reserve');
  const signal = vi.mocked(h.session.submit).mock.calls[0][1]?.signal;
  await h.app.stop();
  expect(signal?.aborted).toBe(true);
  expect(h.session.stop).toHaveBeenCalledTimes(1);
  const stopped = h.app.getSnapshot();
  h.finish(paused(), 'paused');
  await pending;
  expect(h.app.getSnapshot()).toBe(stopped);
});
it('a throwing release callback cannot keep a revoked owner current', async () => {
  const h = harness();
  vi.mocked(h.session.subscribe).mockImplementation(() => () => {
    throw new Error('release');
  });
  const pending = h.app.submit('Reserve');
  h.finish(paused(), 'paused');
  await pending;
  const a = h.app.getSnapshot().approval!;
  await h.app.newConversation();
  await h.app.decide(a, 'approve');
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});

it.each(['newConversation', 'stop'] as const)(
  '%s blocks release-callback submission from confirmed idle state before cleanup runs',
  async (action) => {
    const h = harness();
    const subscribe = vi.mocked(h.session.subscribe).getMockImplementation();
    if (!subscribe) throw new Error('Expected session subscription fixture');
    const reentrant = vi.fn(() => {
      void h.app.submit('REENTRANT unwanted request');
    });
    vi.mocked(h.session.subscribe).mockImplementation((listener) => {
      const release = subscribe(listener);
      return () => {
        reentrant();
        release();
      };
    });
    const approval = await h.pause();
    const resumed = h.app.decide(approval, 'approve');
    h.finish(completed(), 'success');
    await resumed;
    expect(h.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: true,
      reservation: 'approved',
    });
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.session.submit).toHaveBeenCalledTimes(1);

    await h.app[action]();

    expect(reentrant).toHaveBeenCalledTimes(1);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.session.resume).toHaveBeenCalledTimes(1);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: action === 'newConversation',
      canRespond: false,
      approval: undefined,
      requiresNew: action === 'stop',
    });
    // Disposal must find no replacement owner left outside the revoked cleanup.
    await h.app.dispose();
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
  }
);

it.each([
  'getSnapshot',
  'subscribe',
  'submit',
  'resume',
  'stop',
  'dispose',
] as const)(
  'rejects a non-callable %s candidate before native execution or approval',
  async (method) => {
    const h = harness();
    const submit = h.session.submit;
    const resume = h.session.resume;
    const dispose = h.session.dispose;
    const stop = h.session.stop;
    Object.defineProperty(h.session, method, { value: undefined });

    const pending = h.app.submit('Reserve North Pines for 2 nights.');

    expect(submit).not.toHaveBeenCalled();
    await pending;
    expect(resume).not.toHaveBeenCalled();
    expect(h.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: false,
      canRespond: false,
      approval: undefined,
      requiresNew: true,
    });
    await h.app.newConversation();
    await h.app.dispose();
    if (method === 'dispose') expect(stop).toHaveBeenCalledTimes(1);
    else expect(dispose).toHaveBeenCalledTimes(1);
    expect(h.factory).toHaveBeenCalledTimes(1);
  }
);

it('rejects a non-callable subscription release and detaches its candidate before native execution', async () => {
  const h = harness();
  vi.mocked(h.session.subscribe).mockImplementation(
    () => 42 as unknown as () => void
  );
  const pending = h.app.submit('Reserve North Pines for 2 nights.');
  expect(h.session.submit).not.toHaveBeenCalled();
  await pending;
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.app.getSnapshot()).toMatchObject({
    busy: false,
    canRespond: false,
    approval: undefined,
    requiresNew: true,
  });
  await h.app.newConversation();
  await h.app.dispose();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.factory).toHaveBeenCalledTimes(1);
});

it.each([
  'getSnapshot',
  'subscribe',
  'submit',
  'resume',
  'stop',
  'dispose',
] as const)(
  'revokes installation when candidate %s getter reenters Stop',
  async (method) => {
    const h = harness();
    const original = h.session[method];
    const submit = h.session.submit;
    const resume = h.session.resume;
    let first = true;
    Object.defineProperty(h.session, method, {
      get() {
        if (first) {
          first = false;
          void h.app.stop();
        }
        return original;
      },
    });
    const pending = h.app.submit('Reserve North Pines for 2 nights.');
    expect(submit).not.toHaveBeenCalled();
    await pending;
    await h.app.dispose();
    expect(resume).not.toHaveBeenCalled();
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
  }
);
