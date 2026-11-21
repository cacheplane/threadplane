import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal, type Signal } from '@angular/core';
import type { AgentClientTools } from '@threadplane/core';
import { z } from 'zod/v4';
import { action, view, ask, tools } from './tools';
import { toClientToolSpecs, createClientToolsCoordinator } from './client-tools-coordinator';
import type { ClientToolResult } from './client-tools-capability';
import { stopAgent } from './stop-agent';
import { mockAgent } from '../testing/mock-agent';
import type {
  ClientToolExecutionGuard,
  ClientToolExecutionRecord,
  ClientToolExecutionStore,
} from './client-tool-execution-guard';
import type { Agent } from '../agent';
import type { Message } from '../agent';
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

// Minimal Angular component stand-in (avoids needing full TestBed import)
class FakeViewComponent {}
class FakeAskComponent {}

// ── factory helpers ───────────────────────────────────────────────────────────

/** A session takes a call out of `pendingClientTools` inside settle()/resolve(),
 *  so a settled call can never be re-presented to the executor effect. The
 *  fakes below mirror that, otherwise they invite guards against hazards a
 *  real session cannot produce. Tests drive the raw list; the agent's
 *  `pendingClientTools` is the filtered view. */
function pendingView(
  raw: ReturnType<typeof signal<readonly ToolCall[]>>,
  resolvedIds: ReturnType<typeof signal<ReadonlySet<string>>>,
) {
  return computed<readonly ToolCall[]>(() => raw().filter((tc) => !resolvedIds().has(tc.id)));
}

/** The calls each hand-built capability's agent lists in `pendingClientTools`. */
const pendingByCapability = new WeakMap<AgentClientTools, Signal<readonly ToolCall[]>>();

function makeFakeCapability() {
  const pending = signal<readonly ToolCall[]>([]);
  const resolvedIds = signal<ReadonlySet<string>>(new Set());
  const drop = (id: string): void => resolvedIds.update((s) => new Set(s).add(id));
  const settle = vi.fn<[string, ClientToolResult], void>((id) => drop(id));
  const flush = vi.fn<[], void>();
  const resolve = vi.fn<[string, ClientToolResult], void>((id) => drop(id));
  const setCatalog = vi.fn<[readonly unknown[]], void>();
  const capability: AgentClientTools = {
    setCatalog,
    settle,
    flush,
    resolve,
  };
  pendingByCapability.set(capability, pendingView(pending, resolvedIds));
  return { pending, settle, flush, resolve, setCatalog, capability };
}

function makeFakeCapabilityWithoutSettle() {
  const pending = signal<readonly ToolCall[]>([]);
  const resolvedIds = signal<ReadonlySet<string>>(new Set());
  const resolve = vi.fn<[string, ClientToolResult], void>((id) =>
    resolvedIds.update((s) => new Set(s).add(id)),
  );
  const setCatalog = vi.fn<[readonly unknown[]], void>();
  const capability: AgentClientTools = {
    setCatalog,
    resolve,
  };
  pendingByCapability.set(capability, pendingView(pending, resolvedIds));
  return { pending, resolve, setCatalog, capability };
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

function makeGuardStore(): ClientToolExecutionStore & {
  claim: ReturnType<typeof vi.fn<[Parameters<ClientToolExecutionStore['claim']>[0]], Promise<'claimed' | ClientToolExecutionRecord>>>;
  record: ReturnType<typeof vi.fn<Parameters<ClientToolExecutionStore['record']>, Promise<void>>>;
  lookup: ReturnType<typeof vi.fn<Parameters<ClientToolExecutionStore['lookup']>, Promise<Record<string, ClientToolExecutionRecord>>>>;
} {
  return {
    claim: vi.fn(async () => 'claimed'),
    record: vi.fn(async () => undefined),
    lookup: vi.fn(async () => ({})),
  };
}

function makeGuard(store: ClientToolExecutionStore): ClientToolExecutionGuard {
  return { threadId: 'thread-1', store };
}

// ── registry ──────────────────────────────────────────────────────────────────

const testRegistry = tools({
  get_weather: action(
    'Get the weather for a city',
    z.object({ city: z.string() }),
    async (a) => ({ temp: 72, city: a.city }),
  ),
  weather_card: view(
    'Show a weather card',
    z.object({ city: z.string() }),
    FakeViewComponent as never,
  ),
  confirm_booking: ask(
    'Ask user to confirm a booking',
    z.object({ flight: z.string() }),
    FakeAskComponent as never,
  ),
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('toClientToolSpecs()', () => {
  it('returns one spec per tool with name, description, and parameters', () => {
    const specs = toClientToolSpecs(testRegistry);
    expect(specs).toHaveLength(3);

    const weatherSpec = specs.find((s) => s.name === 'get_weather');
    expect(weatherSpec).toBeDefined();
    expect(weatherSpec!.name).toBe('get_weather');
    expect(weatherSpec!.description).toBe('Get the weather for a city');
    expect(weatherSpec!.parameters).toBeDefined();
    expect(weatherSpec!.parameters['type']).toBe('object');

    const cardSpec = specs.find((s) => s.name === 'weather_card');
    expect(cardSpec).toBeDefined();
    expect(cardSpec!.name).toBe('weather_card');
    expect(cardSpec!.description).toBe('Show a weather card');
    expect(cardSpec!.parameters['type']).toBe('object');

    const askSpec = specs.find((s) => s.name === 'confirm_booking');
    expect(askSpec).toBeDefined();
    expect(askSpec!.name).toBe('confirm_booking');
    expect(askSpec!.description).toBe('Ask user to confirm a booking');
    expect(askSpec!.parameters['type']).toBe('object');
  });
});

describe('createClientToolsCoordinator()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('viewRegistry contains view and ask components but not function tools', () => {
    const coordinator = createClientToolsCoordinator(testRegistry);
    const reg = coordinator.viewRegistry;
    // ViewRegistry is a record of component entries — view/ask tools are present
    expect(reg['weather_card']).toBeDefined();
    expect(reg['confirm_booking']).toBeDefined();
    // function tools should NOT be in the view registry
    expect(reg['get_weather']).toBeUndefined();
  });

  it('connect() calls setCatalog once with all specs', () => {
    const { capability, setCatalog } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    expect(setCatalog).toHaveBeenCalledOnce();
    const calledWith = setCatalog.mock.calls[0][0] as readonly unknown[];
    expect(calledWith).toHaveLength(3);
    const names = (calledWith as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('get_weather');
    expect(names).toContain('weather_card');
    expect(names).toContain('confirm_booking');
  });

  it('sends the catalog again when the agent holds another capability object (a thread switch)', () => {
    const first = makeFakeCapability();
    const second = makeFakeCapability();
    const messages = signal<Message[]>([]);
    const agent = { ...makeFakeAgent(first.capability), messages };
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });
    TestBed.flushEffects();
    expect(first.setCatalog).toHaveBeenCalledOnce();

    // A snapshot change on the same session sends nothing.
    messages.set([{ id: 'u1', role: 'user', content: 'hi', delivery: { generation: 'u1', phase: 'complete', outcome: 'success' } }]);
    TestBed.flushEffects();
    expect(first.setCatalog).toHaveBeenCalledOnce();

    // A thread switch replaces the session: another capability, another snapshot.
    (agent as { clientTools: AgentClientTools }).clientTools = second.capability;
    messages.set([]);
    TestBed.flushEffects();

    expect(first.setCatalog).toHaveBeenCalledOnce();
    expect(second.setCatalog).toHaveBeenCalledOnce();
    expect(second.setCatalog.mock.calls[0][0]).toEqual(first.setCatalog.mock.calls[0][0]);

    // And only once for that session.
    messages.set([{ id: 'u2', role: 'user', content: 'again', delivery: { generation: 'u2', phase: 'complete', outcome: 'success' } }]);
    TestBed.flushEffects();
    expect(second.setCatalog).toHaveBeenCalledOnce();
  });

  it('does not send an ask result for a call the agent no longer lists as pending', () => {
    const { pending, resolve, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });
    const call: ToolCall = { id: 'a1', name: 'confirm_booking', args: { flight: 'UA1' }, status: 'pending' };
    pending.set([call]);
    TestBed.flushEffects();
    // The session that asked is gone before the person answers.
    pending.set([]);
    TestBed.flushEffects();

    coordinator.handleRenderEvent(agent, { type: 'result', elementKey: 'confirm_booking', value: { ok: true } } as never);

    expect(resolve).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('ships the catalog and answers calls through the fake session the mock agent stands on', async () => {
    const agent = mockAgent({ commands: ['clientTools'] });
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });
    expect(agent.fake.catalogs).toHaveLength(1);
    expect(agent.fake.catalogs[0].map((spec) => spec.name)).toEqual(['get_weather', 'weather_card', 'confirm_booking']);

    const calls: ToolCall[] = [
      { id: 'f1', name: 'get_weather', args: { city: 'SF' }, status: 'pending' },
      { id: 'v1', name: 'weather_card', args: { city: 'SF' }, status: 'pending' },
    ];
    agent.toolCalls.set(calls);
    agent.pendingClientTools.set(calls);
    TestBed.flushEffects();
    await drainMicrotasks();
    TestBed.flushEffects();

    // One group: the first result is recorded, the last one continues the run.
    expect(agent.fake.clientToolResults).toEqual([
      { kind: 'settle', toolCallId: 'v1', result: { ok: true, value: { shown: true } } },
      { kind: 'resolve', toolCallId: 'f1', result: { ok: true, value: { temp: 72, city: 'SF' } } },
    ]);
    expect(agent.pendingClientTools()).toEqual([]);
    expect(agent.fake.catalogs).toHaveLength(1);
  });

  it('connect() is a no-op when the agent lacks the clientTools capability', () => {
    const agent = makeFakeAgent(undefined);
    const coordinator = createClientToolsCoordinator(testRegistry);

    expect(() => {
      TestBed.runInInjectionContext(() => {
        coordinator.connect(agent);
      });
    }).not.toThrow();
  });

  it('after connect(), view tool calls are auto-acked with { ok:true, value:{shown:true} }', () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'v1', name: 'weather_card', args: { city: 'LA' }, status: 'running' }]);
    TestBed.flushEffects();

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('v1', { ok: true, value: { shown: true } });
  });

  it('view auto-ack is idempotent — second flush does not double-resolve', () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    const call: ToolCall = { id: 'v1', name: 'weather_card', args: { city: 'LA' }, status: 'running' };
    pending.set([call]);
    TestBed.flushEffects();
    // Re-emit the same list — should NOT double-resolve
    pending.set([call]);
    TestBed.flushEffects();

    expect(resolve).toHaveBeenCalledOnce();
  });

  it('after connect(), function tool calls are resolved by the executor', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'f1', name: 'get_weather', args: { city: 'SF' }, status: 'running' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledWith('f1', { ok: true, value: { temp: 72, city: 'SF' } });
  });

  it('batches two pending function tools into one group flush', async () => {
    const registry = tools({
      weather_a: action('Get weather A', z.object({ city: z.string() }), async (a) => `A:${a.city}`),
      weather_b: action('Get weather B', z.object({ city: z.string() }), async (a) => `B:${a.city}`),
    });
    const { pending, settle, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([
      { id: 'f1', name: 'weather_a', args: { city: 'SF' }, status: 'running' },
      { id: 'f2', name: 'weather_b', args: { city: 'LA' }, status: 'running' },
    ]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith('f1', { ok: true, value: 'A:SF' });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('f2', { ok: true, value: 'B:LA' });
  });

  it('settles cancelled function tools without submitting a follow-up run', async () => {
    const registry = tools({
      slow: action('Slow', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const { pending, settle, flush, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'c1', name: 'slow', args: {}, status: 'running' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks();

    // A single-call group with default followUp would normally resolve(), which
    // submits a new run. A cancelled call must never take that path.
    expect(resolve).not.toHaveBeenCalled();
    expect(agent.submit).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0]).toBe('c1');
    expect(settle.mock.calls[0][1].ok).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  });

  it('flushes a cancelled two-call group exactly once', async () => {
    const registry = tools({
      slow_a: action('Slow A', z.object({}), async () => new Promise<string>(() => undefined)),
      slow_b: action('Slow B', z.object({}), async () => new Promise<string>(() => undefined)),
    });
    const { pending, settle, flush, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([
      { id: 'c1', name: 'slow_a', args: {}, status: 'running' },
      { id: 'c2', name: 'slow_b', args: {}, status: 'running' },
    ]);
    TestBed.flushEffects();
    await drainMicrotasks();

    await stopAgent(agent);
    await drainMicrotasks();

    expect(resolve).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(2);
    // Adapters coalesce concurrent flushes, so a per-call flush would strand
    // every batch after the first: flush ONCE, when the last call settles.
    expect(flush).toHaveBeenCalledOnce();
  });

  it('settles terminal tools and flushes once when a mixed group completes', async () => {
    const registry = tools({
      terminal_card: view(
        'Show terminal card',
        z.object({ city: z.string() }),
        FakeViewComponent as never,
        { followUp: false },
      ),
      get_weather: action(
        'Get weather',
        z.object({ city: z.string() }),
        async (a) => ({ temp: 72, city: a.city }),
      ),
    });
    const { pending, settle, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([
      { id: 'v1', name: 'terminal_card', args: { city: 'LA' }, status: 'running' },
      { id: 'f1', name: 'get_weather', args: { city: 'SF' }, status: 'running' },
    ]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(settle).toHaveBeenCalledWith('v1', { ok: true, value: { shown: true } });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('f1', { ok: true, value: { temp: 72, city: 'SF' } });
  });

  it('settles a fully-terminal group and flushes once, without resolving', () => {
    const registry = tools({
      terminal_card: view(
        'Show terminal card',
        z.object({ city: z.string() }),
        FakeViewComponent as never,
        { followUp: false },
      ),
    });
    const { pending, settle, resolve, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'v1', name: 'terminal_card', args: { city: 'LA' }, status: 'running' }]);
    TestBed.flushEffects();

    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith('v1', { ok: true, value: { shown: true } });
    // Nothing continues the run, so the coordinator must make the results durable.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('flushes a multi-call terminal group exactly once', () => {
    const registry = tools({
      card_a: view('Card A', z.object({ city: z.string() }), FakeViewComponent as never, {
        followUp: false,
      }),
      card_b: view('Card B', z.object({ city: z.string() }), FakeViewComponent as never, {
        followUp: false,
      }),
      card_c: view('Card C', z.object({ city: z.string() }), FakeViewComponent as never, {
        followUp: false,
      }),
    });
    const { pending, settle, resolve, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([
      { id: 't1', name: 'card_a', args: { city: 'LA' }, status: 'running' },
      { id: 't2', name: 'card_b', args: { city: 'SF' }, status: 'running' },
      { id: 't3', name: 'card_c', args: { city: 'NY' }, status: 'running' },
    ]);
    TestBed.flushEffects();

    expect(settle.mock.calls.map((c) => c[0])).toEqual(['t1', 't2', 't3']);
    // One flush for the whole group: adapters coalesce concurrent flushes, so a
    // per-call flush would strand every batch after the first.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('falls back to resolve when followUp:false cannot be honored without settle', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = tools({
      terminal_card: view(
        'Show terminal card',
        z.object({ city: z.string() }),
        FakeViewComponent as never,
        { followUp: false },
      ),
    });
    const { pending, resolve, capability } = makeFakeCapabilityWithoutSettle();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'v1', name: 'terminal_card', args: { city: 'LA' }, status: 'running' }]);
    TestBed.flushEffects();

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('v1', { ok: true, value: { shown: true } });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('passes an execution guard to function-tool execution', async () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const store = makeGuardStore();
    const coordinator = createClientToolsCoordinator(testRegistry, {
      executionGuard: makeGuard(store),
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'f2', name: 'get_weather', args: { city: 'SF' }, status: 'running' }]);
    TestBed.flushEffects();
    await drainMicrotasks(8);

    expect(store.claim).toHaveBeenCalledWith({ threadId: 'thread-1', toolCallId: 'f2' });
    expect(store.record).toHaveBeenCalledWith(
      { threadId: 'thread-1', toolCallId: 'f2' },
      { ok: true, value: { temp: 72, city: 'SF' } },
    );
    expect(resolve).toHaveBeenCalledWith('f2', { ok: true, value: { temp: 72, city: 'SF' } });
  });

  it('stops settling pending tools after the configured max continuation turn count is hit', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onLimit = vi.fn();
    const handler = vi.fn(async () => 'again');
    const registry = tools({
      loop: action('Loop', z.object({}), handler),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 2, onLimit },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();
    pending.set([{ id: 'c2', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();
    pending.set([{ id: 'c3', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(onLimit).toHaveBeenCalledOnce();
    expect(onLimit).toHaveBeenCalledWith({
      maxTurns: 2,
      attemptedTurn: 3,
      toolCallIds: ['c3'],
      toolNames: ['loop'],
    });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('uses a default max of 10 continuation turns when no policy is provided', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      loop: action('Loop', z.object({}), async () => 'again'),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    for (let i = 1; i <= 11; i++) {
      pending.set([{ id: `c${i}`, name: 'loop', args: {}, status: 'pending' }]);
      TestBed.flushEffects();
      await drainMicrotasks();
    }

    expect(resolve).toHaveBeenCalledTimes(10);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('treats maxTurns 0 as an explicit unlimited continuation policy', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      loop: action('Loop', z.object({}), async () => 'again'),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 0 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    for (let i = 1; i <= 12; i++) {
      pending.set([{ id: `c${i}`, name: 'loop', args: {}, status: 'pending' }]);
      TestBed.flushEffects();
      await drainMicrotasks();
    }

    expect(resolve).toHaveBeenCalledTimes(12);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('resets the continuation turn count when a new user turn appears', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      loop: action('Loop', z.object({}), async () => 'again'),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const messages = signal<Message[]>([{ id: 'u1', role: 'user', content: 'start' }]);
    const agent: Agent = { ...makeFakeAgent(capability), messages };
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    messages.set([{ id: 'u1', role: 'user', content: 'start' }, { id: 'u2', role: 'user', content: 'next' }]);
    pending.set([{ id: 'c2', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not reset the continuation turn count only because pending tools become empty', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      loop: action('Loop', z.object({}), async () => 'again'),
    });
    const { pending, resolve, capability } = makeFakeCapability();
    const messages = signal<Message[]>([{ id: 'u1', role: 'user', content: 'start' }]);
    const agent: Agent = { ...makeFakeAgent(capability), messages };
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    pending.set([]);
    TestBed.flushEffects();
    await drainMicrotasks();

    pending.set([{ id: 'c2', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('settles blocked calls with a limit error and preserves real ask results', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      confirm: ask('Confirm', z.object({ q: z.string() }), FakeAskComponent as never),
    });
    const { pending, settle, resolve, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    // Turn 1 consumes the single allowed continuation.
    pending.set([{ id: 'a1', name: 'confirm', args: { q: 'x' }, status: 'running' }]);
    TestBed.flushEffects();
    coordinator.handleRenderEvent(agent, {
      type: 'result',
      elementKey: 'confirm',
      value: { confirmed: true },
    } as never);

    settle.mockClear();
    resolve.mockClear();
    flush.mockClear();

    // Turn 2 exceeds maxTurns: the user's answer must still be recorded.
    pending.set([{ id: 'a2', name: 'confirm', args: { q: 'y' }, status: 'running' }]);
    TestBed.flushEffects();
    coordinator.handleRenderEvent(agent, {
      type: 'result',
      elementKey: 'confirm',
      value: { confirmed: false },
    } as never);

    expect(settle).toHaveBeenCalledWith('a2', { ok: true, value: { confirmed: false } });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('flushes a two-call blocked group once, after both calls settle', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = tools({
      loop_a: action('Loop A', z.object({}), async () => 'a'),
      loop_b: action('Loop B', z.object({}), async () => 'b'),
    });
    const { pending, settle, resolve, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    // Turn 1 consumes the single allowed continuation.
    pending.set([{ id: 'a1', name: 'loop_a', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    settle.mockClear();
    resolve.mockClear();
    flush.mockClear();

    // Turn 2 trips the limit with TWO calls. Both must be settled, and the
    // group must flush exactly once — adapters coalesce concurrent flushes, so
    // a per-call flush strands b2's batch and leaves it unanswered on reload.
    pending.set([
      { id: 'b1', name: 'loop_a', args: {}, status: 'pending' },
      { id: 'b2', name: 'loop_b', args: {}, status: 'pending' },
    ]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(settle.mock.calls.map((c) => c[0])).toEqual(['b1', 'b2']);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('warns instead of silently discarding a blocked call when settle() is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = tools({
      loop: action('Loop', z.object({}), async () => 'again'),
    });
    const { pending, resolve, capability } = makeFakeCapabilityWithoutSettle();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();
    resolve.mockClear();

    pending.set([{ id: 'c2', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    // Cannot record the result without settle(), and must not continue the run —
    // but the operator gets told, rather than the result vanishing silently.
    expect(resolve).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    error.mockRestore();
  });

  it('settles a blocked function tool exactly once across effect re-runs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(async () => 'again');
    const registry = tools({
      loop: action('Loop', z.object({}), handler),
    });
    const { pending, settle, resolve, flush, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    // Turn 1 consumes the single allowed continuation.
    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    settle.mockClear();
    resolve.mockClear();
    flush.mockClear();
    handler.mockClear();

    // Turn 2 is blocked. Re-emitting the same pending call must not re-settle it:
    // the predicate that records the block runs on every effect pass.
    const blocked: ToolCall = { id: 'c2', name: 'loop', args: {}, status: 'pending' };
    pending.set([blocked]);
    TestBed.flushEffects();
    await drainMicrotasks();
    pending.set([{ ...blocked }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('c2', {
      ok: false,
      error: 'client tool continuation limit reached; loop was not executed',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not re-settle a blocked call when a later call reforms the group', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(async () => 'again');
    const registry = tools({ loop: action('Loop', z.object({}), handler) });
    const { pending, settle, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry, {
      continuationPolicy: { maxTurns: 1 },
    });
    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });
    pending.set([{ id: 'c1', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();
    settle.mockClear();

    // c2 is blocked and settled with a limit error.
    pending.set([{ id: 'c2', name: 'loop', args: {}, status: 'pending' }]);
    TestBed.flushEffects();
    await drainMicrotasks();

    // A new call joins while c2 is still in the raw list. The group reforms with
    // empty settle bookkeeping, but settle() already dropped c2 from pending(),
    // so the effect never sees it again and it is not re-settled.
    const reformed: readonly ToolCall[] = [
      { id: 'c2', name: 'loop', args: {}, status: 'pending' },
      { id: 'c9', name: 'loop', args: {}, status: 'pending' },
    ];
    pending.set(reformed);
    TestBed.flushEffects();
    await drainMicrotasks();
    pending.set(reformed.map((tc) => ({ ...tc })));
    TestBed.flushEffects();
    await drainMicrotasks();
    error.mockRestore();

    const limitError = {
      ok: false,
      error: 'client tool continuation limit reached; loop was not executed',
    };
    expect(settle.mock.calls).toEqual([
      ['c2', limitError],
      ['c9', limitError],
    ]);
  });

  it('handleRenderEvent() resolves pending ask tool call by elementKey (tool name)', () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'a1', name: 'confirm_booking', args: { flight: 'UA1' }, status: 'running' }]);

    coordinator.handleRenderEvent(agent, {
      type: 'result',
      value: { picked: 2 },
      elementKey: 'confirm_booking',
    });

    expect(resolve).toHaveBeenCalledWith('a1', { ok: true, value: { picked: 2 } });
  });

  it('batches ask results with the pending group before flushing', async () => {
    const registry = tools({
      confirm_booking: ask(
        'Ask user to confirm a booking',
        z.object({ flight: z.string() }),
        FakeAskComponent as never,
      ),
      get_weather: action(
        'Get weather',
        z.object({ city: z.string() }),
        async (a) => ({ temp: 72, city: a.city }),
      ),
    });
    const { pending, settle, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(registry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([
      { id: 'a1', name: 'confirm_booking', args: { flight: 'UA1' }, status: 'running' },
      { id: 'f1', name: 'get_weather', args: { city: 'SF' }, status: 'running' },
    ]);
    TestBed.flushEffects();
    coordinator.handleRenderEvent(agent, {
      type: 'result',
      value: { confirmed: true },
      elementKey: 'confirm_booking',
    });
    await drainMicrotasks();

    expect(settle).toHaveBeenCalledWith('a1', { ok: true, value: { confirmed: true } });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('f1', { ok: true, value: { temp: 72, city: 'SF' } });
  });

  it('handleRenderEvent() does NOT resolve a view tool via handleRenderEvent (views auto-ack separately)', () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    // Only view tool in pending — no auto-ack yet (effect not flushed)
    // Reset resolve mock so we isolate just the handleRenderEvent call
    pending.set([{ id: 'v2', name: 'weather_card', args: { city: 'Boston' }, status: 'running' }]);
    resolve.mockClear();

    // Emit a result event with the view tool name — should NOT trigger resolution via handleRenderEvent
    coordinator.handleRenderEvent(agent, {
      type: 'result',
      value: { anything: true },
      elementKey: 'weather_card',
    });

    // resolve was NOT called from handleRenderEvent (view tools are kind:'view', not kind:'ask')
    expect(resolve).not.toHaveBeenCalled();
  });

  it('handleRenderEvent() ignores non-result events', () => {
    const { pending, resolve, capability } = makeFakeCapability();
    const agent = makeFakeAgent(capability);
    const coordinator = createClientToolsCoordinator(testRegistry);

    TestBed.runInInjectionContext(() => {
      coordinator.connect(agent);
    });

    pending.set([{ id: 'a2', name: 'confirm_booking', args: { flight: 'DL9' }, status: 'running' }]);
    resolve.mockClear();

    coordinator.handleRenderEvent(agent, {
      type: 'handler',
      action: 'click',
      params: {},
    });

    expect(resolve).not.toHaveBeenCalled();
  });

  it('handleRenderEvent() is a no-op when the agent lacks clientTools capability', () => {
    const agent = makeFakeAgent(undefined);
    const coordinator = createClientToolsCoordinator(testRegistry);

    expect(() => {
      coordinator.handleRenderEvent(agent, {
        type: 'result',
        value: 'hello',
        elementKey: 'confirm_booking',
      });
    }).not.toThrow();
  });
});

describe('viewRegistry carries each view/ask tool schema (render mount-readiness gate)', () => {
  it('attaches the Standard Schema to view and ask registry entries', () => {
    const viewSchema = z.object({ day: z.number(), places: z.array(z.string()) });
    const askSchema = z.object({ day: z.number() });
    const registry = tools({
      get_it: action('read', z.object({}), async () => ({})),
      day_card: view('show a day', viewSchema, FakeViewComponent),
      clear_day: ask('confirm clear', askSchema, FakeAskComponent),
    });
    const { viewRegistry } = createClientToolsCoordinator(registry);
    // Entries are RenderViewEntry objects { component, schema } — the schema must
    // survive so the render lib can gate the real mount until streamed props validate.
    expect((viewRegistry['day_card'] as { component: unknown }).component).toBe(FakeViewComponent);
    expect((viewRegistry['day_card'] as { schema: unknown }).schema).toBe(viewSchema);
    expect((viewRegistry['clear_day'] as { schema: unknown }).schema).toBe(askSchema);
    // function (non-view/ask) tools are not in the view registry.
    expect(viewRegistry['get_it']).toBeUndefined();
  });
});
