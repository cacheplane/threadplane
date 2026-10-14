import { expect, it, vi } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import { EventType as E } from '@ag-ui/client';
import { createMafApplication } from './application';
import {
  running,
  paused,
  completed,
  type Snapshot,
  literal,
  human,
} from './fixtures.spec-helper';
function harness() {
  let native: Snapshot = {
    status: 'idle',
    state: {},
    transcript: [],
    subagents: [],
  };
  let notify = () => undefined as void;
  let settle!: (value: CompleteOutcome) => void;
  const session: Session = {
    getSnapshot: vi.fn(() => native),
    subscribe: vi.fn((fn) => {
      notify = fn;
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
  const factory = vi.fn(() => session),
    uuid = vi.fn(() => 'thread');
  const app = createMafApplication({
    sessionFactory: factory,
    threadIdFactory: uuid,
  });
  return {
    app,
    session,
    factory,
    uuid,
    notify: () => notify(),
    update(s: Snapshot) {
      native = s;
      notify();
    },
    settle: (v: CompleteOutcome) => settle(v),
    async pause() {
      const pending = app.submit('File', 0);
      await vi.waitFor(() => expect(session.submit).toHaveBeenCalledTimes(1));
      this.update(paused());
      this.settle('paused');
      await pending;
      return app.getSnapshot().approval!;
    },
  };
}
it.each(['error', 'undefined', 'throw'])(
  'revokes and cleans a failed initial %s snapshot before retained callbacks can publish',
  async (mode) => {
    const h = harness(),
      release = vi.fn();
    let retained = () => undefined as void;
    vi.mocked(h.session.subscribe).mockImplementation((callback) => {
      retained = callback;
      return release;
    });
    vi.mocked(h.session.getSnapshot).mockImplementation(() => {
      if (mode === 'throw') throw Error('Initial read failed');
      return mode === 'error'
        ? { status: 'error', state: {}, transcript: [], subagents: [] }
        : (undefined as never);
    });
    await h.app.submit('File', 0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.session.submit).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().status).toBe('unconfirmed');
    const failed = h.app.getSnapshot();
    vi.mocked(h.session.getSnapshot).mockReturnValue({
      ...running(),
      state: { expense: { vendor: 'Late candidate' } },
    });
    retained();
    expect(h.app.getSnapshot()).toBe(failed);
    await h.app.submit('Attempt after failure', 0);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.session.submit).not.toHaveBeenCalled();
  }
);
it.each(['listener', 'release', 'cleanup'])(
  'failed bootstrap %s reentrancy shares the held cleanup barrier',
  async (source) => {
    const h = harness();
    let retained = () => undefined as void,
      disposal: Promise<void> | undefined,
      releaseCleanup!: () => void;
    function reenter() {
      const view = h.app.getSnapshot();
      expect(view.approval).toBeUndefined();
      expect(view.result).toBeNull();
      expect(view.canRespond).toBe(false);
      expect(view.canSend).toBe(false);
      retained();
      void h.app.submit('Reentrant', view.generation);
      disposal ??= h.app.dispose();
    }
    const release = vi.fn(() => {
      if (source === 'release') reenter();
    });
    vi.mocked(h.session.subscribe).mockImplementation((callback) => {
      retained = callback;
      return release;
    });
    vi.mocked(h.session.getSnapshot).mockReturnValue({
      status: 'error',
      state: {},
      transcript: [],
      subagents: [],
    });
    vi.mocked(h.session.dispose).mockImplementation(() => {
      if (source === 'cleanup') reenter();
      return new Promise((resolve) => {
        releaseCleanup = resolve;
      });
    });
    h.app.subscribe(() => {
      if (source === 'listener' && h.app.getSnapshot().status === 'unconfirmed')
        reenter();
    });
    const submission = h.app.submit('File', 0);
    await vi.waitFor(() => expect(releaseCleanup).toBeTypeOf('function'));
    expect(disposal).toBeDefined();
    let settled = false;
    void disposal!.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(h.session.submit).not.toHaveBeenCalled();
    releaseCleanup();
    await disposal;
    await submission;
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().status).toBe('disposed');
  }
);
it('keeps canonical approval while prediction and unrelated child observations change', async () => {
  const h = harness(),
    a = await h.pause();
  h.update({
    ...paused(),
    state: { expense: { vendor: 'Altered', amount_usd: 1 } },
    subagents: [
      {
        started: {
          type: E.SUBAGENT_STARTED,
          subagentRunId: 'child',
          name: 'Optional child',
        },
      },
    ],
    transcript: [
      ...paused().transcript,
      {
        id: 'child-row',
        role: 'assistant',
        content: 'Child says approved',
        subagentRunId: 'child',
      },
    ],
  });
  expect(h.app.getSnapshot().approval).toBe(a);
  expect(h.app.getSnapshot().draft?.vendor).toBe('Altered');
  const pending = h.app.decide(a, 'approve', 0);
  expect(h.session.resume).toHaveBeenCalledTimes(1);
  h.update(completed());
  h.settle('success');
  await pending;
  expect(h.app.getSnapshot().result).toBe(literal(true));
});
it('release inspects cleared controls and reentrant dispose shares the complete barrier', async () => {
  const h = harness();
  let nested: Promise<void> | undefined, releaseDisposal!: () => void;
  vi.mocked(h.session.subscribe).mockImplementation(() => () => {
    expect(h.app.getSnapshot().approval).toBeUndefined();
    expect(h.app.getSnapshot().result).toBeNull();
    nested = h.app.dispose();
    void h.app.submit('spoof', 1);
  });
  await h.pause();
  vi.mocked(h.session.dispose).mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseDisposal = resolve;
      })
  );
  const outer = h.app.dispose();
  expect(nested).toBe(outer);
  let done = false;
  void outer.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(done).toBe(false);
  releaseDisposal();
  await outer;
  expect(h.factory).toHaveBeenCalledTimes(1);
});
it.each(['new', 'stop'])(
  'observer dispose during %s awaits detached cleanup',
  async (command) => {
    const h = harness();
    await h.pause();
    let releaseCleanup!: () => void, disposal: Promise<void> | undefined;
    vi.mocked(h.session.dispose).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCleanup = resolve;
        })
    );
    h.app.subscribe(() => {
      disposal ??= h.app.dispose();
    });
    const revocation =
      command === 'new' ? h.app.newConversation() : h.app.stop();
    let settled = false;
    void disposal!.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(releaseCleanup).toBeTypeOf('function'));
    expect(settled).toBe(false);
    releaseCleanup();
    await disposal;
    await revocation;
  }
);
it('revocation inside thread-id getter prevents invoking the returned allocator', async () => {
  const allocate = vi.fn(() => 'thread'),
    factory = vi.fn();
  const app: ReturnType<typeof createMafApplication> = createMafApplication({
    sessionFactory: factory,
    get threadIdFactory() {
      void app.newConversation();
      return allocate;
    },
  });
  await app.submit('File', 0);
  expect(allocate).not.toHaveBeenCalled();
  expect(factory).not.toHaveBeenCalled();
});
it.each(['new', 'stop', 'dispose'])(
  'late factory is cleaned without authority after %s',
  async (command) => {
    const h = harness();
    let resolveCandidate!: (session: Session) => void;
    const app = createMafApplication({
      threadIdFactory: () => 'thread',
      sessionFactory: () =>
        new Promise((resolve) => {
          resolveCandidate = resolve;
        }),
    });
    const pending = app.submit('File', 0);
    await vi.waitFor(() => expect(resolveCandidate).toBeTypeOf('function'));
    const cleanup =
      command === 'new'
        ? app.newConversation()
        : command === 'stop'
        ? app.stop()
        : app.dispose();
    let cleaned = false;
    void cleanup.then(() => {
      cleaned = true;
    });
    await Promise.resolve();
    expect(cleaned).toBe(false);
    resolveCandidate(h.session);
    await pending;
    await cleanup;
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.session.submit).not.toHaveBeenCalled();
    expect(h.session.subscribe).not.toHaveBeenCalled();
  }
);
it('revocation during subscribe releases candidate before any submit', async () => {
  const h = harness(),
    release = vi.fn();
  vi.mocked(h.session.subscribe).mockImplementation((callback) => {
    callback();
    void app.newConversation();
    return release;
  });
  const app: ReturnType<typeof createMafApplication> = createMafApplication({
    sessionFactory: () => h.session,
    threadIdFactory: () => 'thread',
  });
  await app.submit('File', 0);
  await vi.waitFor(() => expect(h.session.dispose).toHaveBeenCalled());
  expect(release).toHaveBeenCalledTimes(1);
  expect(h.session.submit).not.toHaveBeenCalled();
});
it('observer-triggered New during Send claim cannot allocate or execute', async () => {
  const h = harness();
  let once = false;
  h.app.subscribe(() => {
    if (!once && h.app.getSnapshot().busy) {
      once = true;
      void h.app.newConversation();
    }
  });
  await h.app.submit('File', 0);
  expect(h.factory).not.toHaveBeenCalled();
});
it('observer-triggered double decision is claimed before notification', async () => {
  const h = harness(),
    a = await h.pause();
  h.app.subscribe(() => {
    void h.app.decide(a, 'decline', 0);
  });
  const pending = h.app.decide(a, 'approve', 0);
  expect(h.session.resume).toHaveBeenCalledTimes(1);
  h.update(completed());
  h.settle('success');
  await pending;
});
it('Stop synchronously clears a previously confirmed result', async () => {
  const h = harness(),
    a = await h.pause(),
    pending = h.app.decide(a, 'approve', 0);
  h.update(completed());
  h.settle('success');
  await pending;
  const stopped = h.app.stop();
  expect(h.app.getSnapshot().result).toBeNull();
  expect(h.app.getSnapshot().canSend).toBe(false);
  await stopped;
});
it('cleanup throws without restoring authority or blocking a fresh conversation', async () => {
  const h = harness();
  vi.mocked(h.session.subscribe).mockImplementation(() => () => {
    throw Error('release');
  });
  await h.pause();
  vi.mocked(h.session.dispose).mockRejectedValue(Error('dispose'));
  vi.mocked(h.session.stop).mockRejectedValue(Error('stop'));
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSend).toBe(true);
  expect(h.session.stop).toHaveBeenCalledTimes(1);
});
it('a stale approval object, generation or expired occurrence never resumes', async () => {
  const h = harness(),
    a = await h.pause();
  await h.app.decide({ ...a }, 'approve', 0);
  await h.app.decide(a, 'approve', 9);
  expect(h.session.resume).not.toHaveBeenCalled();
  const stale = paused() as any;
  stale.decision.id = 'different-occurrence';
  h.update(stale);
  await h.app.decide(a, 'approve', 0);
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().status).toBe('unconfirmed');
});
it('rejects a reused historical root run even with fresh call and pause identifiers', async () => {
  const h = harness(),
    a = await h.pause(),
    first = h.app.decide(a, 'approve', 0);
  h.update(completed());
  h.settle('success');
  await first;
  const transcript = [...completed().transcript, { ...human, id: 'human2' }];
  vi.mocked(h.session.submit).mockImplementation(async () => {
    h.update({ ...running(), transcript });
    const reused = JSON.parse(
      JSON.stringify(paused()).replaceAll('"call"', '"call2"')
    ) as Snapshot;
    h.update({
      ...reused,
      transcript,
      decision: { ...reused.decision!, id: 'new-pause' } as never,
    });
    return 'paused';
  });
  await h.app.submit('Again', 0);
  expect(h.app.getSnapshot().approval).toBeUndefined();
  expect(h.app.getSnapshot().status).toBe('unconfirmed');
});
it.each([true, false])(
  'resumes original occurrence once and confirms settled raw result (%s)',
  async (approved) => {
    const h = harness();
    expect(h.factory).not.toHaveBeenCalled();
    const a = await h.pause();
    expect(a).toBeDefined();
    const pending = h.app.decide(a, approved ? 'approve' : 'decline', 0);
    void h.app.decide(a, 'approve', 0);
    expect(h.session.resume).toHaveBeenCalledTimes(1);
    expect(h.session.resume).toHaveBeenCalledWith(
      a.pause,
      [{ interruptId: 'call', status: 'resolved', payload: { approved } }],
      expect.anything()
    );
    h.update(completed(approved));
    expect(h.app.getSnapshot().result).toBeNull();
    h.settle('success');
    await pending;
    expect(h.app.getSnapshot().result).toBe(literal(approved));
    expect(h.app.getSnapshot().canSend).toBe(true);
  }
);
it('requires New after missing terminal even if settled success', async () => {
  const h = harness(),
    a = await h.pause(),
    pending = h.app.decide(a, 'approve', 0);
  const done = completed();
  h.update({ ...done, run: { id: 'resume', outcome: 'success' } });
  h.settle('success');
  await pending;
  expect(h.app.getSnapshot().status).toBe('unconfirmed');
  expect(h.app.getSnapshot().result).toBeNull();
});
it('lazily rejects invalid or stale Send without allocation', async () => {
  const h = harness();
  await h.app.submit(' ', 0);
  await h.app.submit('File', 5);
  expect(h.uuid).not.toHaveBeenCalled();
  expect(h.factory).not.toHaveBeenCalled();
});
it('revokes before observer and cleanup reentrancy, and ignores late subscription', async () => {
  const h = harness();
  await h.pause();
  const a = h.app.getSnapshot().approval!;
  vi.mocked(h.session.dispose).mockImplementation(async () => {
    void h.app.decide(a, 'approve', 0);
    void h.app.submit('spoof', 1);
  });
  const next = h.app.newConversation();
  expect(h.app.getSnapshot().approval).toBeUndefined();
  expect(h.app.getSnapshot().result).toBeNull();
  h.update(completed());
  await next;
  expect(h.app.getSnapshot().threadId).toBeNull();
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.factory).toHaveBeenCalledTimes(1);
});
it('rejects incomplete candidate and noncallable release before submit authority', async () => {
  for (const invalid of [true, false]) {
    const h = harness();
    if (invalid) h.session.resume = undefined as never;
    else h.session.subscribe = vi.fn(() => undefined as never);
    await h.app.submit('File', 0);
    expect(h.session.submit).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSend).toBe(false);
    await h.app.dispose();
    expect(h.session.dispose).toHaveBeenCalled();
  }
});
it('New waits for replacement cleanup and disposed application never revives', async () => {
  const h = harness();
  await h.pause();
  let release!: () => void;
  vi.mocked(h.session.dispose).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const pending = h.app.newConversation();
  await Promise.resolve();
  await h.app.submit('File', 1);
  expect(h.factory).toHaveBeenCalledTimes(1);
  release();
  await pending;
  expect(h.app.getSnapshot().canSend).toBe(true);
  await h.app.dispose();
  await h.app.submit('File', 1);
  expect(h.factory).toHaveBeenCalledTimes(1);
});
