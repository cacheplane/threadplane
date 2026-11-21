import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal, type Signal } from '@angular/core';
import type { AgentClientTools } from '@threadplane/core';
import { z } from 'zod/v4';
import { action, view, tools } from './tools';
import { startClientToolExecutor } from './client-tool-executor';
import type { ClientToolResult } from './client-tools-capability';
import { stopAgent } from './stop-agent';
import { mockAgent } from '../testing/mock-agent';
import type {
  ClientToolExecutionGuard,
  ClientToolExecutionRecord,
  ClientToolExecutionStore,
} from './client-tool-execution-guard';
import type { Agent } from '../agent';
import type { ToolCall } from '../agent';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Drain the microtask queue a handful of times to let Promise chains settle.
 * The executor races each handler against its abort signal, so a settlement is
 * several ticks deep — keep this comfortably above the longest chain.
 */
async function drainMicrotasks(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// Minimal Angular component stand-in for view/ask (avoids needing full TestBed import)
class FakeComponent {}

// ── factory helpers ───────────────────────────────────────────────────────────

/** The calls each hand-built capability's agent lists in `pendingClientTools`. */
const pendingByCapability = new WeakMap<AgentClientTools, Signal<readonly ToolCall[]>>();

/**
 * A spied capability beside a pending list the test owns. A result does NOT
 * remove its call from the list, so a test sees exactly what the executor sent.
 */
function makeFakeCapability() {
  const pending = signal<readonly ToolCall[]>([]);
  // `resolve` is "record AND continue": the session starts a new run from it,
  // so a call to `resolve` IS a run submission.
  const resolve = vi.fn<[string, ClientToolResult], void>();
  const settle = vi.fn<[string, ClientToolResult], void>();
  const flush = vi.fn<[], void>();
  const capability: AgentClientTools = {
    setCatalog: vi.fn(),
    settle,
    flush,
    resolve,
  };
  pendingByCapability.set(capability, pending);
  return { pending, resolve, settle, flush, capability };
}

/**
 * Capability that mirrors a session's real contract: BOTH `settle()` and
 * `resolve()` take the call out of `pendingClientTools`. Needed to prove a
 * settled (incl. cancelled) call is never re-dispatched on a later effect pass.
 */
function makeResolvingCapability() {
  const raw = signal<readonly ToolCall[]>([]);
  const resolvedIds = signal<ReadonlySet<string>>(new Set<string>());
  const pending = computed(() => raw().filter((tc) => !resolvedIds().has(tc.id)));
  const markResolved = (id: string): void => {
    resolvedIds.update((s) => new Set(s).add(id));
  };
  const settle = vi.fn<[string, ClientToolResult], void>((id) => markResolved(id));
  const flush = vi.fn<[], void>();
  const resolve = vi.fn<[string, ClientToolResult], void>((id) => markResolved(id));
  const capability: AgentClientTools = {
    setCatalog: vi.fn(),
    settle,
    flush,
    resolve,
  };
  pendingByCapability.set(capability, pending);
  return { raw, resolve, settle, flush, capability };
}

/**
 * The mock agent with a hand-built capability in place of the fake session's,
 * and that capability's pending list as `pendingClientTools`. `submit` and
 * `stop` are spies, so a test can prove no run was started.
 */
function makeFakeAgent(capability: AgentClientTools | undefined) {
  return {
    ...mockAgent(),
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    clientTools: capability,
    pendingClientTools: (capability && pendingByCapability.get(capability)) ?? signal<readonly ToolCall[]>([]),
  } satisfies Agent;
}

function makeGuardStore(
  claimResult: 'claimed' | ClientToolExecutionRecord = 'claimed',
): ClientToolExecutionStore & {
  claim: ReturnType<typeof vi.fn<[Parameters<ClientToolExecutionStore['claim']>[0]], Promise<'claimed' | ClientToolExecutionRecord>>>;
  record: ReturnType<typeof vi.fn<Parameters<ClientToolExecutionStore['record']>, Promise<void>>>;
  lookup: ReturnType<typeof vi.fn<Parameters<ClientToolExecutionStore['lookup']>, Promise<Record<string, ClientToolExecutionRecord>>>>;
} {
  return {
    claim: vi.fn(async () => claimResult),
    record: vi.fn(async () => undefined),
    lookup: vi.fn(async () => ({})),
  };
}

function makeGuard(store: ClientToolExecutionStore): ClientToolExecutionGuard {
  return { threadId: 'thread-1', store };
}

// ── registry ──────────────────────────────────────────────────────────────────

const weatherRegistry = tools({
  get_weather: action(
    'Get the weather for a city',
    z.object({ city: z.string() }),
    async (a) => ({ temp: 70, city: a.city }),
  ),
  weather_card: view(
    'Show a weather card',
    z.object({ city: z.string() }),
    FakeComponent as never,
  ),
});

const failingRegistry = tools({
  explode: action(
    'Throw from the handler',
    z.object({ value: z.string() }),
    async () => {
      throw new Error('handler exploded');
    },
  ),
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('startClientToolExecutor()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('resolves a function tool call with ok:true', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, weatherRegistry);
    });

    // Regression: `pendingClientTools` is the authority on what waits for the
    // browser. The executor must NOT skip a listed call for its status, even
    // one a backend reports as 'complete' (only `inFlight` guards a dispatch).
    pending.set([{ id: 'c1', name: 'get_weather', args: { city: 'SF' }, status: 'complete' } as unknown as ToolCall]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('c1', { ok: true, value: { temp: 70, city: 'SF' } });
  });

  it('uses a custom settlement handler when provided', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const settleToolCall = vi.fn<[ToolCall, ClientToolResult], void>();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, weatherRegistry, { settleToolCall });
    });

    pending.set([{ id: 'c1', name: 'get_weather', args: { city: 'SF' }, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(settleToolCall).toHaveBeenCalledOnce();
    expect(settleToolCall).toHaveBeenCalledWith(
      { id: 'c1', name: 'get_weather', args: { city: 'SF' }, status: 'pending' },
      { ok: true, value: { temp: 70, city: 'SF' } },
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('normalizes handler throws to an error result', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, failingRegistry);
    });

    pending.set([{ id: 'e1', name: 'explode', args: { value: 'x' }, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledWith('e1', {
      ok: false,
      error: 'handler exploded',
    });
  });

  it('normalizes invalid arguments to an error result without calling the handler', async () => {
    const handler = vi.fn(async (a: { city: string }) => ({ temp: 70, city: a.city }));
    const registry = tools({
      get_weather: action(
        'Get the weather for a city',
        z.object({ city: z.string() }),
        handler,
      ),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'bad-args', name: 'get_weather', args: { city: 123 }, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0][0]).toBe('bad-args');
    expect(resolve.mock.calls[0][1].ok).toBe(false);
    expect((resolve.mock.calls[0][1] as { error: string }).error).toContain('invalid arguments:');
  });

  it('does not double-resolve the same call id (in-flight guard)', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, weatherRegistry);
    });

    const call: ToolCall = { id: 'c1', name: 'get_weather', args: { city: 'SF' }, status: 'running' };

    // Set pending, flush, then set the SAME pending again before the promise resolves
    pending.set([call]);
    TestBed.flushEffects();
    // Re-emit the same list — should NOT start a second execution
    pending.set([call]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledOnce();
  });

  it('passes a non-aborted signal to function tool handlers', async () => {
    const seen: AbortSignal[] = [];
    const registry = tools({
      read: action('read', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return 'done';
      }),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 's1', name: 'read', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(false);
  });

  it('aborts in-flight function tools on a plain agent.stop(), with no stopAgent call', async () => {
    const seen: AbortSignal[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return new Promise<string>(() => undefined);
      }),
    });
    const { pending, capability } = makeFakeCapability();
    // The mock's own stop, which tells its stop listeners as the real agent does.
    const agent = {
      ...mockAgent(),
      clientTools: capability,
      pendingClientTools: pending,
    } satisfies Agent;

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();
    expect(seen[0].aborted).toBe(false);

    // An app's own stop control calls the agent directly.
    await agent.stop();
    expect(seen[0].aborted).toBe(true);
  });

  it('aborts in-flight function tools on stop and settles them without continuing the run', async () => {
    let complete!: (value: string) => void;
    const completion = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const seen: AbortSignal[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return completion;
      }),
    });
    const { pending, resolve, settle, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    expect(seen[0].aborted).toBe(true);

    complete('late result');
    await drainMicrotasks();

    // The server thread must never hold a client tool call without a result, so
    // an aborted call settles rather than dangling — but it must settle through
    // settle()+flush(), NEVER resolve(): resolve submits a new run, which would
    // undo the stop the user just asked for.
    expect(resolve).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0]).toBe('slow-1');
    expect(settle.mock.calls[0][1].ok).toBe(false);
    expect((settle.mock.calls[0][1] as { error: string }).error).toContain('cancelled');
    expect(flush).toHaveBeenCalled();
  });

  it('submits no run when the user stops a client tool mid-flight', async () => {
    const submittedRuns: string[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    resolve.mockImplementation((id) => {
      submittedRuns.push(id);
    });
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-run', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks(8);

    expect(submittedRuns).toEqual([]);
    expect(agent.submit).not.toHaveBeenCalled();
  });

  it('settles an aborted handler through the non-continuing channel so it cannot re-execute', async () => {
    const continued: Array<[string, ClientToolResult]> = [];
    const cancelled: Array<[string, ClientToolResult]> = [];
    let release!: () => void;
    const registry = tools({
      slow: action('Slow', z.object({}), async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return 'done';
      }),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, {
        settleToolCall: (tc, result) => continued.push([tc.id, result]),
        settleWithoutContinuing: (tc, result) => cancelled.push([tc.id, result]),
      });
    });

    pending.set([{ id: 'slow-1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    release();
    await drainMicrotasks();

    expect(continued).toEqual([]);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0][0]).toBe('slow-1');
    expect(cancelled[0][1].ok).toBe(false);
  });

  it('settles on abort without waiting for a handler that ignores the signal', async () => {
    const cancelled: Array<[string, ClientToolResult]> = [];
    const registry = tools({
      // Never settles, and never looks at context.signal — the common case,
      // since honoring the signal is opt-in.
      stubborn: action('Stubborn', z.object({}), () => new Promise<string>(() => undefined)),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, {
        settleWithoutContinuing: (tc, result) => cancelled.push([tc.id, result]),
      });
    });

    pending.set([{ id: 'stubborn-1', name: 'stubborn', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks();

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0][0]).toBe('stubborn-1');
    expect(cancelled[0][1].ok).toBe(false);
  });

  it('does not double-settle when a handler finishes after the abort settled it', async () => {
    let release!: (value: string) => void;
    const registry = tools({
      slow: action('Slow', z.object({}), async () => {
        return new Promise<string>((r) => {
          release = r;
        });
      }),
    });
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-3', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks();
    expect(settle).toHaveBeenCalledOnce();

    // The real result arrives long after the cancelled settlement.
    release('late real result');
    await drainMicrotasks(8);

    expect(settle).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not re-dispatch an aborted client tool on a later effect pass', async () => {
    const handler = vi.fn(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return 'done';
    });
    let release!: () => void;
    const registry = tools({
      slow: action('Slow', z.object({}), handler),
    });
    const { raw, resolve, settle, capability } = makeResolvingCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    raw.set([{ id: 'slow-2', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    release();
    await drainMicrotasks();

    // The next run re-emits the same tool call list; the cancelled call is now
    // settled (and so out of pendingClientTools), so it must not be dispatched to the
    // handler a second time.
    raw.set([{ id: 'slow-2', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('aborts in-flight function tools when the injection context is destroyed', async () => {
    const seen: AbortSignal[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return new Promise(() => undefined);
      }),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-2', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    TestBed.resetTestingModule();

    expect(seen[0].aborted).toBe(true);
  });

  it('settles on teardown without submitting a run mid-destroy', async () => {
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'slow-4', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    TestBed.resetTestingModule();
    await drainMicrotasks();

    // Destroying the chat with a tool in flight must not submit a run.
    expect(resolve).not.toHaveBeenCalled();
    expect(agent.submit).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][1].ok).toBe(false);
  });

  it('claims before executing guarded function tools and records before resolving', async () => {
    const order: string[] = [];
    const handler = vi.fn(async () => {
      order.push('handler');
      return 'charged';
    });
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore('claimed');
    store.claim.mockImplementation(async () => {
      order.push('claim');
      return 'claimed';
    });
    store.record.mockImplementation(async () => {
      order.push('record');
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-1', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks(8);

    expect(store.claim).toHaveBeenCalledWith({ threadId: 'thread-1', toolCallId: 'charge-1' });
    expect(store.record).toHaveBeenCalledWith(
      { threadId: 'thread-1', toolCallId: 'charge-1' },
      { ok: true, value: 'charged' },
    );
    expect(resolve).toHaveBeenCalledWith('charge-1', { ok: true, value: 'charged' });
    expect(order).toEqual(['claim', 'handler', 'record']);
  });

  it('replays a prior done result without re-running the handler', async () => {
    const handler = vi.fn(async () => 'new-value');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const prior: ClientToolResult = { ok: true, value: 'stored-value' };
    const store = makeGuardStore({ status: 'done', result: prior });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-2', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith('charge-2', prior);
  });

  it('fails closed for stale executing records', async () => {
    const handler = vi.fn(async () => 'new-value');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore({ status: 'executing' });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-3', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(store.record).toHaveBeenCalledOnce();
    const result = store.record.mock.calls[0][1];
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('charge-3');
    expect(resolve).toHaveBeenCalledWith('charge-3', result);
  });

  it('fails closed for failed records without a stored result', async () => {
    const handler = vi.fn(async () => 'new-value');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore({ status: 'failed' });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-4', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(store.record).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0][1].ok).toBe(false);
  });

  it('fails closed when the guard claim fails', async () => {
    const handler = vi.fn(async () => 'new-value');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore('claimed');
    store.claim.mockRejectedValue(new Error('store unavailable'));
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-5', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
    expect(resolve.mock.calls[0][1].ok).toBe(false);
    expect((resolve.mock.calls[0][1] as { error: string }).error).toContain('guard failed');
  });

  it('bypasses the guard for idempotent function tools', async () => {
    const handler = vi.fn(async () => 'cached');
    const registry = tools({
      read: action('Read cached data', z.object({}), handler, { idempotent: true }),
    });
    const store = makeGuardStore('claimed');
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'read-1', name: 'read', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(store.claim).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('read-1', { ok: true, value: 'cached' });
  });

  it('records and settles without continuing when stopped before a delayed claim resolves', async () => {
    let resolveClaim!: (value: 'claimed') => void;
    const claim = new Promise<'claimed'>((resolve) => {
      resolveClaim = resolve;
    });
    const handler = vi.fn(async () => 'late');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore('claimed');
    store.claim.mockReturnValue(claim);
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-6', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    resolveClaim('claimed');
    await drainMicrotasks(8);

    expect(handler).not.toHaveBeenCalled();
    // The claim succeeded, so the durable row is now 'executing'. It must be
    // recorded or it stays that way forever and a later reload fails closed
    // with a misleading "interrupted" message.
    expect(store.record).toHaveBeenCalledOnce();
    expect(store.record.mock.calls[0][1].ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect((settle.mock.calls[0][1] as { error: string }).error).toContain('cancelled');
  });

  it('settles without continuing when the claim rejects after a stop', async () => {
    let rejectClaim!: (err: Error) => void;
    const claim = new Promise<'claimed'>((_res, rej) => {
      rejectClaim = rej;
    });
    const handler = vi.fn(async () => 'late');
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore('claimed');
    store.claim.mockReturnValue(claim);
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-8', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    rejectClaim(new Error('store unavailable'));
    await drainMicrotasks(8);

    expect(handler).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][1].ok).toBe(false);
  });

  it('records the cancelled result when stopped after claiming', async () => {
    let release!: () => void;
    const handler = vi.fn(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return 'charged';
    });
    const registry = tools({
      charge: action('Charge a card', z.object({}), handler),
    });
    const store = makeGuardStore('claimed');
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry, { executionGuard: makeGuard(store) });
    });

    pending.set([{ id: 'charge-7', name: 'charge', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    release();
    await drainMicrotasks(8);

    // The store must not be left at 'executing' — a later reload would then
    // fail closed with a misleading "interrupted" message.
    expect(store.record).toHaveBeenCalledOnce();
    expect(store.record.mock.calls[0][1].ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][1].ok).toBe(false);
  });

  it('never changes agent.stop, however many executors start', () => {
    const registry = tools({ noop: action('n', z.object({}), async () => 'x') });
    const { capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const original = agent.stop;
    const keys = Object.keys(agent);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
      startClientToolExecutor(agent, registry);
    });

    expect(agent.stop).toBe(original);
    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    expect(agent.stop).toBe(original);
    expect(Object.keys(agent)).toEqual(keys);
  });

  it('leaves agent.stop alone and releases its registration once every executor is destroyed', async () => {
    const seen: AbortSignal[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return new Promise<string>(() => undefined);
      }),
    });
    const { pending, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const original = agent.stop;

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
      startClientToolExecutor(agent, registry);
    });
    expect(agent.stop).toBe(original);

    TestBed.resetTestingModule();
    expect(agent.stop).toBe(original);

    // Nothing is registered any more: a later stop reaches only the agent,
    // and a call that becomes pending afterwards is run by nobody.
    pending.set([{ id: 'late', name: 'slow', args: {}, status: 'pending' }]);
    await drainMicrotasks();
    settle.mockClear();
    await stopAgent(agent);
    await drainMicrotasks();

    expect(seen).toHaveLength(0);
    expect(settle).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledOnce();
  });

  it('stopAgent calls agent.stop once, after aborting the running handlers', async () => {
    const order: string[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        context.signal.addEventListener('abort', () => order.push('abort'));
        return new Promise<string>(() => undefined);
      }),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    agent.stop.mockImplementation(async () => {
      order.push('stop');
    });

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    pending.set([{ id: 's1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);

    expect(order).toEqual(['abort', 'stop']);
    expect(agent.stop).toHaveBeenCalledOnce();
  });

  it('stopAgent only stops an agent no executor runs tools for', async () => {
    const agent = makeFakeAgent(undefined);
    await stopAgent(agent);
    expect(agent.stop).toHaveBeenCalledOnce();
  });

  it('does not send a result for a call the agent no longer lists as pending', async () => {
    let complete!: (value: string) => void;
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>((resolve) => { complete = resolve; })),
    });
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    pending.set([{ id: 'gone', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    // A thread switch replaced the session: the call is listed no more.
    pending.set([]);
    TestBed.flushEffects();
    complete('late');
    await drainMicrotasks();

    expect(resolve).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('does not record a cancelled result for a call the agent no longer lists as pending', async () => {
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const { pending, resolve, settle, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    pending.set([{ id: 'gone', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    pending.set([]);
    TestBed.flushEffects();
    await stopAgent(agent);
    await drainMicrotasks();

    expect(resolve).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('answers through whichever capability the agent holds when the handler finishes', async () => {
    let complete!: (value: string) => void;
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>((resolve) => { complete = resolve; })),
    });
    const first = makeFakeCapability();
    const second = makeFakeCapability();
    const agent = makeFakeAgent(first.capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    first.pending.set([{ id: 'c1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    // The session, and with it the capability object, is replaced while the
    // handler runs; the call is still listed.
    (agent as { clientTools: AgentClientTools }).clientTools = second.capability;
    complete('done');
    await drainMicrotasks();

    expect(first.resolve).not.toHaveBeenCalled();
    expect(second.resolve).toHaveBeenCalledWith('c1', { ok: true, value: 'done' });
  });

  it('runs and answers a call through the fake session the mock agent stands on', async () => {
    const agent = mockAgent({ commands: ['clientTools'] });
    const call: ToolCall = { id: 'c1', name: 'get_weather', args: { city: 'SF' }, status: 'pending' };

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, weatherRegistry);
    });
    agent.toolCalls.set([call]);
    agent.pendingClientTools.set([call]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(agent.fake.clientToolResults).toEqual([
      { kind: 'resolve', toolCallId: 'c1', result: { ok: true, value: { temp: 70, city: 'SF' } } },
    ]);
    expect(agent.pendingClientTools()).toEqual([]);
    expect(agent.toolCalls()[0]).toMatchObject({ status: 'complete', result: { temp: 70, city: 'SF' } });
  });

  it('records a stopped call as cancelled on the fake session without continuing', async () => {
    const registry = tools({
      slow: action('slow', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const agent = mockAgent({ commands: ['clientTools'] });
    const stop = agent.stop;
    const call: ToolCall = { id: 's1', name: 'slow', args: {}, status: 'pending' };

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
    });
    agent.toolCalls.set([call]);
    agent.pendingClientTools.set([call]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks();

    expect(agent.stop).toBe(stop);
    expect(agent.fake.stopCount).toBe(1);
    expect(agent.fake.clientToolResults).toHaveLength(1);
    expect(agent.fake.clientToolResults[0]).toMatchObject({ kind: 'settle', toolCallId: 's1', result: { ok: false } });
    expect(agent.fake.flushCount).toBe(1);
    expect(agent.submitCalls).toEqual([]);
  });

  it('aborts every live executor on the same agent when stop is called', async () => {
    const seen: AbortSignal[] = [];
    const registry = tools({
      slow: action('slow', z.object({}), async (_args, context) => {
        seen.push(context.signal);
        return new Promise<string>(() => undefined);
      }),
    });
    const { pending, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, registry);
      // A second coordinator wired to the same long-lived (root-provided) agent.
      startClientToolExecutor(agent, registry);
    });

    pending.set([{ id: 'a1', name: 'slow', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);

    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.aborted)).toEqual([true, true]);
  });

  it('ignores view/ask tool calls (only function tools are auto-executed)', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);

    TestBed.runInInjectionContext(() => {
      startClientToolExecutor(agent, weatherRegistry);
    });

    // weather_card is a view tool — executor must ignore it
    pending.set([
      { id: 'v1', name: 'weather_card', args: { city: 'Boston' }, status: 'running' },
    ]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).not.toHaveBeenCalled();
  });

  it('is a no-op when the agent does not have the clientTools capability', () => {
    const agent = makeFakeAgent(undefined);
    expect(agent.clientTools).toBeUndefined();

    // Must not throw
    expect(() => {
      TestBed.runInInjectionContext(() => {
        startClientToolExecutor(agent, weatherRegistry);
      });
    }).not.toThrow();
  });
});
