import { expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import { createMemoryApplication, type MemorySession } from './application';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Stubbed RED owners may not yet await the injected operation.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function setup() {
  const creation = deferred<string>();
  let run = deferred<CompleteOutcome>();
  let state: ReturnType<MemorySession['getSnapshot']> = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
  });
  const observers = new Set<() => void>();
  const release = vi.fn();
  const session: MemorySession = {
    getSnapshot: () => state,
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => {
        observers.delete(notify);
        release();
      };
    }),
    submit: vi.fn(() => run.promise),
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
  const application = createMemoryApplication({ createThread, sessionFactory });
  function replace(update: Partial<typeof state>, notify = true) {
    state = Object.freeze({ ...state, ...update });
    if (notify) for (const observer of observers) observer();
  }
  async function start() {
    const pending = application.submit('Remember my fictional name, Mira');
    creation.resolve('confirmed-thread');
    await Promise.resolve();
    return { pending };
  }
  return {
    application,
    session,
    creation,
    createThread,
    sessionFactory,
    replace,
    release,
    start,
    get run() {
      return run;
    },
    nextRun() {
      run = deferred<CompleteOutcome>();
    },
  };
}

it('starts with an empty, available conversation', () => {
  expect(setup().application.getSnapshot()).toMatchObject({
    creation: 'idle',
    rows: [],
    facts: [],
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
  });
});

it('shows a streamed reply before extracted facts arrive', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        content: 'Hello Mira',
        delivery: { generation: 'run', phase: 'streaming' },
      },
    ],
  });
  expect(h.application.getSnapshot().rows).toHaveLength(1);
  expect(h.application.getSnapshot().facts).toEqual([]);
  h.replace({ values: { memory: { user_name: 'Mira' } } });
  expect(h.application.getSnapshot().facts).toEqual([
    { key: 'user_name', value: 'Mira' },
  ]);
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: 'success',
  });
});

it('replaces authoritative facts rather than merging removed keys', async () => {
  const h = setup();
  await h.start();
  h.replace({ values: { memory: { name: 'Mira', favorite: 'tea' } } });
  h.replace({ values: { memory: { favorite: 'coffee' } } });
  expect(h.application.getSnapshot().facts).toEqual([
    { key: 'favorite', value: 'coffee' },
  ]);
  const facts = h.application.getSnapshot().facts;
  h.replace({ values: { memory: { favorite: 'coffee' } } });
  expect(h.application.getSnapshot().facts).toBe(facts);
  expect(Object.isFrozen(facts)).toBe(true);
  expect(Object.isFrozen(facts[0])).toBe(true);
});

it.each([
  undefined,
  {},
  { memory: null },
  { memory: [] },
  { memory: 'invalid' },
  { memory: Object.create({ inherited: 'not owned' }) },
])('clears facts for absent or malformed state %#', async (values) => {
  const h = setup();
  await h.start();
  h.replace({ values: { memory: { name: 'Mira' } } });
  expect(h.application.getSnapshot().facts).toHaveLength(1);
  h.replace({ values });
  expect(h.application.getSnapshot().facts).toEqual([]);
});

it('keeps literal keys and strings, skips nonstrings and never evaluates accessors', async () => {
  const h = setup();
  await h.start();
  const getter = vi.fn(() => 'unsafe');
  const memory = Object.assign(
    Object.create(null),
    JSON.parse(
      '{"__proto__":"literal","a.b":"<b>tea</b>","count":3,"nested":{}}'
    )
  );
  Object.defineProperty(memory, 'accessor', { enumerable: true, get: getter });
  h.replace({ values: { memory } });
  expect(h.application.getSnapshot().facts).toEqual([
    { key: '__proto__', value: 'literal' },
    { key: 'a.b', value: '<b>tea</b>' },
  ]);
  const root = Object.defineProperty({}, 'memory', { get: getter });
  h.replace({ values: root });
  expect(h.application.getSnapshot().facts).toEqual([]);
  expect(getter).not.toHaveBeenCalled();
});

it('reuses one confirmed thread and one session for successive turns', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve('success');
  await pending;
  h.nextRun();
  const next = h.application.submit('What do you remember?');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).toHaveBeenCalledExactlyOnceWith('confirmed-thread');
  expect(h.session.submit).toHaveBeenCalledTimes(2);
  h.run.resolve('success');
  await next;
});

it('admits one command synchronously and ignores blank input', async () => {
  const h = setup();
  await h.application.submit('  ');
  const first = h.application.submit('Remember Mira');
  const second = h.application.submit('Duplicate');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    creation: 'pending',
  });
  h.creation.resolve('confirmed-thread');
  await Promise.resolve();
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  h.run.resolve('success');
  await Promise.all([first, second]);
});

it('does not retry uncertain creation', async () => {
  const h = setup();
  const pending = h.application.submit('Mira');
  h.creation.reject(new Error('unknown creation'));
  await pending;
  await h.application.submit('Try again');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot()).toMatchObject({
    creation: 'unconfirmed',
    outcome: 'error',
    canSubmit: false,
  });
});

it.each(['error', 'aborted', 'interrupted', 'paused'] as const)(
  'requires a new conversation after %s',
  async (outcome) => {
    const h = setup();
    const { pending } = await h.start();
    h.run.resolve(outcome);
    await pending;
    await h.application.submit('Retry');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.application.getSnapshot()).toMatchObject({
      outcome,
      canSubmit: false,
      busy: false,
    });
  }
);

it('blocks every observed pause even when completion nominally succeeds', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({ interrupts: [{ value: { unknown: true } }] });
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  await h.application.submit('Retry');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('blocks an idle observed pause before another submission', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve('success');
  await pending;
  h.replace({ interrupts: [{ value: 'unknown' }] });
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  await h.application.submit('Retry');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('checks a missed pause notification before admitting a command', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve('success');
  await pending;
  h.replace({ interrupts: [{ value: 'unknown' }] }, false);
  await h.application.submit('Retry');
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('does not submit when confirmed publication reveals a pause', async () => {
  const h = setup();
  h.replace({ interrupts: [{ value: 'unknown' }] }, false);
  const { pending } = await h.start();
  expect(h.session.submit).not.toHaveBeenCalled();
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    outcome: 'paused',
    busy: false,
    canSubmit: false,
  });
});

it('contains rejected commands and prevents retries', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.reject(new Error('unknown run'));
  await pending;
  await h.application.submit('Retry');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot()).toMatchObject({
    outcome: 'error',
    canSubmit: false,
    error: 'The LangGraph request failed.',
  });
});

it('Stop aborts the current operation and ignores late completion', async () => {
  const h = setup();
  const { pending } = await h.start();
  await h.application.stop();
  expect(h.session.stop).toHaveBeenCalledTimes(1);
  const saved = h.application.getSnapshot();
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(saved);
  expect(saved).toMatchObject({
    outcome: 'aborted',
    busy: false,
    canSubmit: false,
  });
});

it('Stop during creation prevents late session construction', async () => {
  const h = setup();
  const pending = h.application.submit('Mira');
  await h.application.stop();
  expect(h.createThread.mock.calls[0]?.[0].aborted).toBe(true);
  h.creation.resolve('late-thread');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot()).toMatchObject({
    creation: 'unconfirmed',
    canSubmit: false,
  });
});

it.each(['admission', 'creation', 'confirmed'] as const)(
  'prevents effects after synchronous disposal at %s publication',
  async (when) => {
    const h = setup();
    let disposal: Promise<void> | undefined;
    h.application.subscribe(() => {
      const state = h.application.getSnapshot();
      if (
        (when === 'admission' && state.busy && state.creation === 'idle') ||
        (when === 'creation' && state.creation === 'pending') ||
        (when === 'confirmed' && state.creation === 'confirmed')
      )
        disposal = h.application.dispose();
    });
    const pending = h.application.submit('Mira');
    h.creation.resolve('confirmed-thread');
    await pending;
    await disposal;
    expect(h.createThread).toHaveBeenCalledTimes(when === 'confirmed' ? 1 : 0);
    expect(h.session.submit).not.toHaveBeenCalled();
    expect(h.session.dispose).toHaveBeenCalledTimes(
      when === 'confirmed' ? 1 : 0
    );
  }
);

it('disposes once, releases observation and ignores late state', async () => {
  const h = setup();
  const { pending } = await h.start();
  const notify = vi.fn();
  h.application.subscribe(notify);
  const disposal = h.application.dispose();
  expect(h.application.dispose()).toBe(disposal);
  await disposal;
  const saved = h.application.getSnapshot();
  h.replace({ values: { memory: { late: 'fact' } } });
  h.run.resolve('success');
  await pending;
  await h.application.submit('After disposal');
  expect(h.application.getSnapshot()).toBe(saved);
  expect(notify).not.toHaveBeenCalled();
  expect(h.release).toHaveBeenCalledTimes(1);
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});
