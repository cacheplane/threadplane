import { expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import { createClientToolsApplication, type ClientToolsSession, type ClientToolCatalog } from './application';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function setup() {
  const creation = deferred<string>();
  let run = deferred<CompleteOutcome>();
  let state: ReturnType<ClientToolsSession['getSnapshot']> = Object.freeze({
    status: 'idle', messages: [], toolCalls: [], interrupts: [],
  });
  let catalog: ClientToolCatalog | undefined;
  const observers = new Set<() => void>();
  const release = vi.fn();
  const session: ClientToolsSession = {
    getSnapshot: () => state,
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => { observers.delete(notify); release(); };
    }),
    submit: vi.fn(() => run.promise),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn((_signal: AbortSignal) => creation.promise);
  const sessionFactory = vi.fn((_id: string, tools: ClientToolCatalog) => {
    catalog = tools;
    return session;
  });
  const application = createClientToolsApplication({ createThread, sessionFactory });
  function replace(update: Partial<typeof state>, notify = true) {
    state = Object.freeze({ ...state, ...update });
    if (notify) for (const observer of observers) observer();
  }
  async function start() {
    const pending = application.submit('Weather in Portland');
    creation.resolve('confirmed-thread');
    await Promise.resolve();
    return { pending };
  }
  return {
    application, session, creation, createThread, sessionFactory, replace, release, start,
    get tools() { return catalog!; },
    get run() { return run; },
    nextRun() { run = deferred<CompleteOutcome>(); },
  };
}

it('starts empty and ignores blank text', async () => {
  const h = setup();
  expect(h.application.getSnapshot()).toMatchObject({
    creation: 'idle', rows: [], weather: [], bookings: [], busy: false,
    canSubmit: true, outcome: null, error: null,
  });
  await h.application.submit('  ');
  expect(h.createThread).not.toHaveBeenCalled();
});

it('admits one command synchronously and confirms one catalog-bearing session', async () => {
  const h = setup();
  const pending = h.application.submit('Weather');
  expect(h.application.getSnapshot()).toMatchObject({ busy: true, canSubmit: false, creation: 'pending' });
  await h.application.submit('Duplicate');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  h.creation.resolve('confirmed-thread');
  await Promise.resolve();
  expect(h.sessionFactory).toHaveBeenCalledWith('confirmed-thread', expect.objectContaining({
    get_weather: expect.any(Object), confirm_booking: expect.any(Object),
    weather_snapshot: expect.objectContaining({ followUp: false }),
  }));
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({ busy: false, canSubmit: true, outcome: 'success' });
});

it('reuses the confirmed thread after successful turns', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve('success');
  await pending;
  h.nextRun();
  const second = h.application.submit('Another request');
  h.run.resolve('success');
  await second;
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).toHaveBeenCalledTimes(1);
  expect(h.session.submit).toHaveBeenCalledTimes(2);
});

it('projects incremental transcript and completed authored panels', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({ messages: [{ id: 'reply', role: 'assistant', content: 'Weather reply', delivery: { generation: 'run', phase: 'streaming' } }] });
  expect(h.application.getSnapshot().rows).toHaveLength(1);
  await h.tools.weather_card.handler({ location: 'Portland', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 }, { signal: new AbortController().signal });
  expect(h.application.getSnapshot().weather[0].location).toBe('Portland');
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot().weather).toHaveLength(1);
});

it('allows an owned booking decision while the command and composer remain busy', async () => {
  const h = setup();
  vi.mocked(h.session.submit).mockImplementation(async (_text, options) => {
    const result = await h.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: options!.signal! });
    expect(result).toEqual({ confirmed: true });
    return 'success';
  });
  const { pending } = await h.start();
  const row = h.application.getSnapshot().bookings[0];
  expect(h.application.getSnapshot()).toMatchObject({ busy: true, canSubmit: false });
  expect(h.application.decide(row, true)).toBe(true);
  expect(h.application.decide(row, false)).toBe(false);
  await pending;
  expect(h.application.getSnapshot().bookings[0].status).toBe('confirmed');
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});

it('Stop aborts a pending browser decision and requires a new conversation', async () => {
  const h = setup();
  vi.mocked(h.session.submit).mockImplementation(async (_text, options) => {
    await h.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: options!.signal! });
    return 'success';
  });
  const { pending } = await h.start();
  const row = h.application.getSnapshot().bookings[0];
  await h.application.stop();
  await pending;
  expect(h.application.decide(row, true)).toBe(false);
  expect(h.application.getSnapshot()).toMatchObject({ busy: false, canSubmit: false, outcome: 'aborted' });
  expect(h.application.getSnapshot().bookings[0].status).toBe('aborted');
  await h.application.submit('No replay');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('Stop during creation prevents a late confirmed session from dispatching', async () => {
  const h = setup();
  const pending = h.application.submit('Weather');
  await h.application.stop();
  h.creation.resolve('late-thread');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot()).toMatchObject({ creation: 'unconfirmed', outcome: 'aborted', canSubmit: false });
});

it('a failed creation remains unconfirmed and is not retried', async () => {
  const h = setup();
  const pending = h.application.submit('Weather');
  h.creation.reject(new Error('Ambiguous creation'));
  await pending;
  await h.application.submit('No retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot()).toMatchObject({ creation: 'unconfirmed', outcome: 'error', canSubmit: false });
});

it.each(['paused', 'error', 'aborted', 'interrupted'] as const)('requires reset after outcome %s', async (outcome) => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve(outcome);
  await pending;
  await h.application.submit('No replay');
  expect(h.application.getSnapshot()).toMatchObject({ busy: false, canSubmit: false, outcome });
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it.each([null, { kind: 'unknown' }, { kind: 'refund_approval' }])('blocks every root pause before command effects: %j', async (value) => {
  const h = setup();
  h.replace({ interrupts: [{ value }] });
  const { pending } = await h.start();
  await pending;
  expect(h.session.submit).not.toHaveBeenCalled();
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});

it.each([
  { id: 'x', name: 'get_weather', args: { location: 'city' }, status: 'pending' as const },
  { id: 'x', name: 'get_weather', args: { location: 'city' }, status: 'running' as const },
  { id: 'x', name: 'unknown', args: {}, status: 'complete' as const, result: {} },
  { id: 'x', name: 'constructor', args: {}, status: 'complete' as const, result: {} },
])('blocks unresolved or unknown tools even after nominal success: %j', async (tool) => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({ toolCalls: [tool] });
  h.run.resolve('success');
  await pending;
  await h.application.submit('No replay');
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('allows a new turn after a conclusive handled tool error and successful follow-up', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({ toolCalls: [{ id: 'x', name: 'get_weather', args: {}, status: 'error', error: 'Invalid arguments' }] });
  h.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});

it('blocks an assistant call reference omitted by the typed session observation', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({ messages: [{ id: 'unsupported', role: 'assistant', content: '', toolCallIds: ['server-unknown'], delivery: { generation: 'run', phase: 'complete', outcome: 'success' } }] });
  h.run.resolve('success'); await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  await h.application.submit('No replay');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('permits resolved authored call references retained in the transcript', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.replace({
    messages: [{ id: 'supported', role: 'assistant', content: '', toolCallIds: ['weather-owned'], delivery: { generation: 'run', phase: 'complete', outcome: 'success' } }],
    toolCalls: [{ id: 'weather-owned', name: 'get_weather', args: { location: 'city' }, status: 'complete', result: {} }],
  });
  h.run.resolve('success'); await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});

it('rechecks unresolved observations even when a notification was missed', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.run.resolve('success');
  await pending;
  h.replace({ toolCalls: [{ id: 'x', name: 'unknown', args: {}, status: 'pending' }] }, false);
  await h.application.submit('No replay');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});

it('rechecks root pause after confirmed publication before dispatch', async () => {
  const h = setup();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().creation === 'confirmed') h.replace({ interrupts: [{ value: null }] }, false);
  });
  const { pending } = await h.start();
  await pending;
  expect(h.session.submit).not.toHaveBeenCalled();
});

it('disposal during initial publication prevents thread creation', async () => {
  const h = setup();
  h.application.subscribe(() => void h.application.dispose());
  await h.application.submit('Weather');
  expect(h.createThread).not.toHaveBeenCalled();
});

it('disposal during creation fences its late completion', async () => {
  const h = setup();
  const pending = h.application.submit('Weather');
  await h.application.dispose();
  h.creation.resolve('late-thread');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
});

it('disposal during confirmed publication prevents session submission', async () => {
  const h = setup();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().creation === 'confirmed') void h.application.dispose();
  });
  const { pending } = await h.start();
  await pending;
  expect(h.session.submit).not.toHaveBeenCalled();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});

it('disposal releases observation and fences both rows and decisions before async session cleanup', async () => {
  const h = setup();
  const cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockImplementation(() => cleanup.promise);
  vi.mocked(h.session.submit).mockImplementation(async (_text, options) => {
    await h.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: options!.signal! });
    return 'success';
  });
  const { pending } = await h.start();
  const row = h.application.getSnapshot().bookings[0];
  const disposal = h.application.dispose();
  const snapshot = h.application.getSnapshot();
  expect(h.application.decide(row, true)).toBe(false);
  h.replace({ messages: [{ id: 'late', role: 'assistant', content: 'Late', delivery: { generation: 'old', phase: 'complete' } }] });
  expect(h.application.getSnapshot()).toBe(snapshot);
  expect(h.release).toHaveBeenCalledTimes(1);
  cleanup.resolve();
  await disposal;
  await pending;
});

it('releasing a UI subscriber is inert and cannot cancel execution', async () => {
  const h = setup();
  const release = h.application.subscribe(vi.fn());
  const { pending } = await h.start();
  release();
  expect(h.session.stop).not.toHaveBeenCalled();
  expect(h.session.dispose).not.toHaveBeenCalled();
  h.run.resolve('success');
  await pending;
});
