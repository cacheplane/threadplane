import { describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot, CompleteOutcome } from '@threadplane/core';
import {
  createInterruptsApplication,
  type InterruptSession,
  type RefundDecision,
} from './application';

function required(decision: RefundDecision | null) {
  if (!decision) throw new Error('Expected a validated refund decision');
  return decision;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const refund = {
  kind: 'refund_approval',
  amount: 47.5,
  customer_id: 'cus_a8x2k',
  reason: 'Duplicate charge',
};
function batch(value: unknown = refund) {
  return Object.freeze([Object.freeze({ id: 'reused-id', value })]);
}
function setup() {
  const creation = deferred<string>();
  const run = deferred<CompleteOutcome>();
  const resumed = deferred<CompleteOutcome>();
  let snapshot: AgentSnapshot & { interrupts: readonly { value?: unknown }[] } =
    Object.freeze({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: Object.freeze([]),
    });
  const observers = new Set<() => void>();
  const release = vi.fn();
  const session: InterruptSession = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => {
        observers.delete(notify);
        release();
      };
    }),
    submit: vi.fn(() => run.promise),
    resume: vi.fn(() => resumed.promise),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn((signal: AbortSignal) => {
    void signal;
    return creation.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    void id;
    return session;
  });
  const application = createInterruptsApplication({
    createThread,
    sessionFactory,
  });
  function replace(interrupts: typeof snapshot.interrupts, notify = true) {
    snapshot = Object.freeze({ ...snapshot, interrupts });
    if (notify) for (const observer of observers) observer();
  }
  async function pause(
    interrupts: ReturnType<
      InterruptSession['getSnapshot']
    >['interrupts'] = batch()
  ) {
    const pending = application.submit('Refund request');
    creation.resolve('confirmed-thread');
    await Promise.resolve();
    replace(interrupts);
    run.resolve('paused');
    await pending;
    return application.getSnapshot().decision;
  }
  return {
    application,
    creation,
    run,
    resumed,
    session,
    release,
    createThread,
    sessionFactory,
    replace,
    pause,
  };
}

describe('public interrupts owner', () => {
  it('creates lazily once and blocks duplicate text until confirmed completion', async () => {
    const s = setup();
    expect(s.createThread).not.toHaveBeenCalled();
    await s.application.submit('  ');
    const pending = s.application.submit('First');
    await s.application.submit('Duplicate');
    expect(s.createThread).toHaveBeenCalledTimes(1);
    expect(s.session.submit).not.toHaveBeenCalled();
    s.creation.resolve('confirmed-thread');
    await Promise.resolve();
    expect(s.sessionFactory).toHaveBeenCalledWith('confirmed-thread');
    s.run.resolve('success');
    await pending;
    await s.application.submit('Second');
    expect(s.createThread).toHaveBeenCalledTimes(1);
    expect(s.session.submit).toHaveBeenCalledTimes(2);
  });

  it('projects the sole complete refund and blocks text while paused', async () => {
    const s = setup();
    const decision = await s.pause();
    expect(decision?.refund).toEqual(refund);
    expect(Object.isFrozen(decision)).toBe(true);
    await s.application.submit('Bypass pause');
    expect(s.session.submit).toHaveBeenCalledTimes(1);
    expect(s.application.getSnapshot().canSubmit).toBe(false);
  });

  it.each([
    { approved: true },
    { approved: false },
    { approved: true, amount: 0 },
    { approved: true, amount: 12.25 },
  ])(
    'resumes exactly the authored response %j without new text',
    async (response) => {
      const s = setup();
      const decision = await s.pause();
      const pending = s.application.decide(required(decision), response);
      await s.application.decide(required(decision), response);
      await s.application.submit('Duplicate text');
      expect(s.session.resume).toHaveBeenCalledTimes(1);
      expect(s.session.resume).toHaveBeenCalledWith(response, {
        signal: expect.any(AbortSignal),
      });
      expect(s.application.getSnapshot().busy).toBe(true);
      expect(s.application.getSnapshot().decision).toBeNull();
      expect(s.session.submit).toHaveBeenCalledTimes(1);
      s.replace(Object.freeze([]));
      s.resumed.resolve('success');
      await pending;
      expect(s.application.getSnapshot().canSubmit).toBe(true);
    }
  );

  it.each([
    null,
    [],
    { ...refund, kind: 'unknown' },
    { ...refund, amount: -1 },
    { ...refund, amount: Infinity },
    { ...refund, customer_id: 3 },
    { ...refund, reason: null },
    Object.create(refund),
    new Date(),
  ])('protects malformed or unknown payload %j', async (value) => {
    const s = setup();
    await s.pause(batch(value));
    expect(s.application.getSnapshot().decision).toBeNull();
    expect(s.application.getSnapshot().canSubmit).toBe(false);
    await s.application.submit('Bypass');
    expect(s.session.submit).toHaveBeenCalledTimes(1);
    expect(s.session.resume).not.toHaveBeenCalled();
  });

  it('accepts own plain null-prototype data without reading accessors', async () => {
    const getter = vi.fn(() => 47.5);
    const payload = Object.defineProperty({ ...refund }, 'amount', {
      get: getter,
    });
    const s = setup();
    await s.pause(batch(payload));
    expect(getter).not.toHaveBeenCalled();
    expect(s.application.getSnapshot().decision).toBeNull();
    const valid = setup();
    expect(
      (await valid.pause(batch(Object.assign(Object.create(null), refund))))
        ?.refund
    ).toEqual(refund);
  });

  it('rejects multiple root interrupts instead of choosing one', async () => {
    const s = setup();
    await s.pause(Object.freeze([...batch(), ...batch()]));
    expect(s.application.getSnapshot().decision).toBeNull();
    await s.application.submit('Bypass');
    expect(s.session.submit).toHaveBeenCalledTimes(1);
  });

  it('invalidates callbacks on batch replacement even with reused IDs and identical values', async () => {
    const s = setup();
    const old = await s.pause();
    s.replace(batch());
    const current = s.application.getSnapshot().decision;
    expect(current).not.toBe(old);
    await s.application.decide(required(old), { approved: true });
    expect(s.session.resume).not.toHaveBeenCalled();
    const pending = s.application.decide(required(current), {
      approved: false,
    });
    s.resumed.resolve('success');
    await pending;
    expect(s.session.resume).toHaveBeenCalledTimes(1);
  });

  it('checks current batch at admission even without an observer notification', async () => {
    const s = setup();
    const old = await s.pause();
    s.replace(batch({ ...refund, amount: 99 }), false);
    await s.application.decide(required(old), { approved: true });
    expect(s.session.resume).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1])(
    'rejects invalid edited amount %s before resume',
    async (amount) => {
      const s = setup();
      const decision = await s.pause();
      await s.application.decide(required(decision), {
        approved: true,
        amount,
      });
      expect(s.session.resume).not.toHaveBeenCalled();
      expect(s.application.getSnapshot().decision).toBe(decision);
    }
  );

  it('captures the response before dispatch and never replays an uncertain resume', async () => {
    const s = setup();
    const decision = await s.pause();
    const response = { approved: true, amount: 25 };
    const pending = s.application.decide(required(decision), response);
    response.amount = 100;
    expect(s.session.resume).toHaveBeenCalledWith(
      { approved: true, amount: 25 },
      expect.any(Object)
    );
    s.resumed.reject(new Error('PRIVATE credential'));
    await pending;
    await s.application.decide(required(decision), response);
    await s.application.submit('Replay');
    expect(s.session.resume).toHaveBeenCalledTimes(1);
    expect(s.application.getSnapshot().canSubmit).toBe(false);
    expect(JSON.stringify(s.application.getSnapshot())).not.toContain(
      'PRIVATE'
    );
  });

  it('does not dispatch if response capture disposes the owner', async () => {
    const s = setup();
    const decision = required(await s.pause());
    s.resumed.resolve('success');
    const response = new Proxy(
      { approved: true as const },
      {
        getPrototypeOf(target) {
          void s.application.dispose();
          return Object.getPrototypeOf(target);
        },
      }
    );
    await s.application.decide(decision, response);
    expect(s.session.resume).not.toHaveBeenCalled();
  });
  it('does not dispatch if a pending-state subscriber disposes the owner', async () => {
    const s = setup();
    const decision = required(await s.pause());
    s.resumed.resolve('success');
    s.application.subscribe(() => {
      if (s.application.getSnapshot().activity === 'decision')
        void s.application.dispose();
    });
    await s.application.decide(decision, { approved: true });
    expect(s.session.resume).not.toHaveBeenCalled();
  });
  it('reprojects instead of dispatching if pending publication replaces the batch', async () => {
    const s = setup();
    const decision = required(await s.pause());
    s.resumed.resolve('success');
    let changed = false;
    s.application.subscribe(() => {
      if (!changed && s.application.getSnapshot().activity === 'decision') {
        changed = true;
        s.replace(batch({ ...refund, amount: 99 }));
      }
    });
    await s.application.decide(decision, { approved: true });
    expect(s.session.resume).not.toHaveBeenCalled();
    expect(s.application.getSnapshot().decision?.refund.amount).toBe(99);
    expect(s.application.getSnapshot().canSubmit).toBe(false);
  });

  it('does not dispatch if response capture replaces the authoritative batch', async () => {
    const s = setup();
    const decision = required(await s.pause());
    s.resumed.resolve('success');
    const response = new Proxy(
      { approved: true as const },
      {
        getOwnPropertyDescriptor(target, key) {
          s.replace(batch());
          return Object.getOwnPropertyDescriptor(target, key);
        },
      }
    );
    await s.application.decide(decision, response);
    expect(s.session.resume).not.toHaveBeenCalled();
    expect(s.application.getSnapshot().decision).not.toBe(decision);
  });

  it('does not install a late session after Stop during thread creation', async () => {
    const s = setup();
    const pending = s.application.submit('First');
    await s.application.stop();
    expect(s.createThread.mock.calls[0][0].aborted).toBe(true);
    s.creation.resolve('late-thread');
    await pending;
    expect(s.sessionFactory).not.toHaveBeenCalled();
    expect(s.application.getSnapshot().creation).toBe('unconfirmed');
  });

  it('stops a held decision and fences its late successful result', async () => {
    const s = setup();
    const decision = await s.pause();
    const pending = s.application.decide(required(decision), {
      approved: true,
    });
    await s.application.stop();
    expect(vi.mocked(s.session.resume).mock.calls[0][1]?.signal?.aborted).toBe(
      true
    );
    s.resumed.resolve('success');
    await pending;
    expect(s.application.getSnapshot().outcome).toBe('aborted');
    expect(s.application.getSnapshot().canSubmit).toBe(false);
    expect(s.session.stop).toHaveBeenCalledTimes(1);
  });

  it('does not replay unconfirmed creation', async () => {
    const s = setup();
    const pending = s.application.submit('First');
    s.creation.reject(new Error('PRIVATE'));
    await pending;
    await s.application.submit('Retry');
    expect(s.createThread).toHaveBeenCalledTimes(1);
    expect(s.sessionFactory).not.toHaveBeenCalled();
    expect(s.application.getSnapshot().creation).toBe('unconfirmed');
  });

  it.each(['error', 'interrupted', 'aborted'] as const)(
    'requires replacement after terminal %s',
    async (outcome) => {
      const s = setup();
      const pending = s.application.submit('First');
      s.creation.resolve('thread');
      await Promise.resolve();
      s.run.resolve(outcome);
      await pending;
      await s.application.submit('Replay');
      expect(s.session.submit).toHaveBeenCalledTimes(1);
      expect(s.application.getSnapshot().canSubmit).toBe(false);
    }
  );

  it('keeps an empty paused root batch protected', async () => {
    const s = setup();
    await s.pause(Object.freeze([]));
    expect(s.application.getSnapshot().decision).toBeNull();
    await s.application.submit('Bypass');
    expect(s.session.submit).toHaveBeenCalledTimes(1);
  });

  it('keeps a payload-free breakpoint pause protected', async () => {
    const s = setup();
    await s.pause(Object.freeze([Object.freeze({})]));
    expect(s.application.getSnapshot().decision).toBeNull();
    await s.application.submit('Bypass');
    expect(s.session.submit).toHaveBeenCalledTimes(1);
  });

  it('requires an empty root batch as well as success before accepting text', async () => {
    const s = setup();
    const pending = s.application.submit('First');
    s.creation.resolve('thread');
    await Promise.resolve();
    s.replace(batch());
    s.run.resolve('success');
    await pending;
    await s.application.submit('Bypass');
    expect(s.application.getSnapshot().decision).toBeNull();
    expect(s.session.submit).toHaveBeenCalledTimes(1);
  });

  it('disposes before creation without installing a late session', async () => {
    const s = setup();
    const pending = s.application.submit('First');
    await s.application.dispose();
    s.creation.resolve('late-thread');
    await pending;
    expect(s.sessionFactory).not.toHaveBeenCalled();
  });

  it('disposes once and never publishes a held decision result', async () => {
    const s = setup();
    const decision = await s.pause();
    const notify = vi.fn();
    s.application.subscribe(notify);
    const pending = s.application.decide(required(decision), {
      approved: true,
    });
    await s.application.dispose();
    await s.application.dispose();
    const count = notify.mock.calls.length;
    s.resumed.resolve('success');
    await pending;
    await s.application.decide(required(decision), { approved: true });
    expect(notify).toHaveBeenCalledTimes(count);
    expect(s.session.dispose).toHaveBeenCalledTimes(1);
    expect(s.release).toHaveBeenCalledTimes(1);
  });
});
