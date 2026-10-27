import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { type AgentError } from '@threadplane/chat';
import type { AgentEvent, AgentStatus, AgentUsage, Message, ToolCall } from '@threadplane/chat';
import type { ReducerStore, CustomStreamEvent } from './reducer';
import { createClientToolsCapability as createCapability } from './client-tools';

/** Build a minimal ReducerStore backed by writable signals — mirrors reducer.spec.ts. */
function makeStore(): ReducerStore {
  return {
    messages:     signal<Message[]>([]),
    status:       signal<AgentStatus>('idle'),
    isLoading:    signal<boolean>(false),
    error:        signal<AgentError | undefined>(undefined),
    toolCalls:    signal<ToolCall[]>([]),
    state:        signal<Record<string, unknown>>({}),
    interrupt:    signal(undefined),
    events$:      new Subject<AgentEvent>(),
    customEvents: signal<CustomStreamEvent[]>([]),
    usage: signal<AgentUsage | undefined>(undefined),
    pendingClientToolCallIds: signal<ReadonlySet<string> | undefined>(undefined),
  };
}

/** Fake source that records calls made against it. */
function makeSource() {
  return {
    addMessage: vi.fn(),
    continueRun: vi.fn(async () => undefined),
  };
}

function createClientToolsCapability(
  source: ReturnType<typeof makeSource>,
  store: ReducerStore,
) {
  return createCapability(source, store, source.continueRun);
}

const WEATHER_SPEC = {
  name:        'get_weather',
  description: 'Returns current weather for a location.',
  parameters:  { type: 'object', properties: { location: { type: 'string' } } },
} as const;

describe('createClientToolsCapability', () => {
  // ---- setCatalog + runAgent threading ----------------------------------------

  it('catalogAsAgUiTools returns [] before setCatalog is called', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    expect(cap.catalogAsAgUiTools()).toEqual([]);
  });

  it('catalogAsAgUiTools returns AG-UI Tool[] after setCatalog', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    const tools = cap.catalogAsAgUiTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name:        'get_weather',
      description: 'Returns current weather for a location.',
      parameters:  { type: 'object', properties: { location: { type: 'string' } } },
    });
  });

  // ---- pending signal ----------------------------------------------------------

  it('pending() is [] when isLoading=true even if tool calls are present', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(true);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);
    expect(cap.pending()).toEqual([]);
  });

  it('pending() includes a tool call whose name is in the catalog with no result', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);
    const pending = cap.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('c1');
  });

  it('pending() excludes a tool call whose name is NOT in the catalog', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c2', name: 'some_backend_tool', args: {}, status: 'complete' }]);
    expect(cap.pending()).toEqual([]);
  });

  it('pending() excludes a tool call that already has a result', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([
      { id: 'c3', name: 'get_weather', args: {}, status: 'complete', result: { temp: 72 } },
    ]);
    expect(cap.pending()).toEqual([]);
  });

  it('limits pending to the ids the run outcome declared', () => {
    const source = makeSource();
    const store  = makeStore();
    store.toolCalls.set([
      { id: 'a', name: 'get_weather', args: {}, status: 'complete' },
      { id: 'b', name: 'get_weather', args: {}, status: 'complete' },
    ]);
    store.pendingClientToolCallIds.set(new Set(['b']));
    const cap = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    expect(cap.pending().map((tc) => tc.id)).toEqual(['b']);
  });

  it('an empty authoritative set leaves nothing pending for a result-less catalog call', () => {
    const source = makeSource();
    const store  = makeStore();
    store.toolCalls.set([{ id: 'a', name: 'get_weather', args: {}, status: 'complete' }]);
    store.pendingClientToolCallIds.set(new Set());
    const cap = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    expect(cap.pending()).toEqual([]);
  });

  it('pending() is [] when no catalog is set', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c4', name: 'get_weather', args: {}, status: 'complete' }]);
    expect(cap.pending()).toEqual([]);
  });

  // ---- resolve — ok result ---------------------------------------------------

  it('resolve(ok) calls source.addMessage with the serialized value', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);

    cap.resolve('c1', { ok: true, value: { temp: 70 } });

    expect(source.addMessage).toHaveBeenCalledOnce();
    const msg = source.addMessage.mock.calls[0][0] as {
      role: string; toolCallId: string; content: string;
    };
    expect(msg.role).toBe('tool');
    expect(msg.toolCallId).toBe('c1');
    expect(msg.content).toBe(JSON.stringify({ temp: 70 }));
  });

  it('resolve(ok, string value) does not double-stringify the content', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);

    cap.resolve('cx', { ok: true, value: 'plain string' });

    const msg = source.addMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toBe('plain string');
  });

  it('resolve(ok) requests continuation through the injected port', async () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);

    cap.resolve('c1', { ok: true, value: { temp: 70 } });

    // Allow the void promise to flush
    await Promise.resolve();

    expect(source.continueRun).toHaveBeenCalledOnce();
  });

  it('resolve(ok) drops the id from pending() and writes the result onto the store tool call', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);

    expect(cap.pending()).toHaveLength(1);
    cap.resolve('c1', { ok: true, value: { cleared: true } });
    // resolvedIds guard drops it, AND the result is now written onto the store
    // tool call (belt-and-braces: the result write alone also excludes it).
    expect(cap.pending()).toHaveLength(0);
    const tc = store.toolCalls().find((t) => t.id === 'c1');
    expect(tc?.result).toEqual({ cleared: true });
    expect(tc?.status).toBe('complete');
    expect(tc?.error).toBeUndefined();
  });

  it('resolve(ok) does not affect other pending calls', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([
      { id: 'c1', name: 'get_weather', args: {}, status: 'complete' },
      { id: 'c2', name: 'get_weather', args: {}, status: 'complete' },
    ]);

    expect(cap.pending().map((tc) => tc.id)).toEqual(['c1', 'c2']);
    cap.resolve('c1', { ok: true, value: { temp: 70 } });

    expect(cap.pending().map((tc) => tc.id)).toEqual(['c2']);
    expect(store.toolCalls().find((tc) => tc.id === 'c2')?.result).toBeUndefined();
  });

  it('settle(ok) drops the id from pending and records the result without running', async () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);

    cap.settle?.('c1', { ok: true, value: { temp: 70 } });
    await Promise.resolve();

    expect(cap.pending()).toHaveLength(0);
    expect(store.toolCalls().find((tc) => tc.id === 'c1')?.result).toEqual({ temp: 70 });
    expect(source.addMessage).toHaveBeenCalledOnce();
    expect(source.continueRun).not.toHaveBeenCalled();
  });

  it('settle plus resolve flushes multiple pending results in one run', async () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([
      { id: 'c1', name: 'get_weather', args: {}, status: 'complete' },
      { id: 'c2', name: 'get_weather', args: {}, status: 'complete' },
    ]);

    cap.settle?.('c1', { ok: true, value: { temp: 70 } });
    cap.resolve('c2', { ok: true, value: { temp: 71 } });
    await Promise.resolve();

    expect(source.addMessage).toHaveBeenCalledTimes(2);
    expect(source.continueRun).toHaveBeenCalledTimes(1);
    expect(source.addMessage.mock.calls.map(([message]) => (
      message as { toolCallId: string }
    ).toolCallId)).toEqual(['c1', 'c2']);
  });

  // ---- flush -----------------------------------------------------------------

  it('exposes a no-op flush that does not start a run', async () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);

    // Assert presence explicitly: `cap.flush?.()` short-circuits when the
    // member is missing, so the optional call alone cannot fail the test.
    expect(typeof cap.flush).toBe('function');

    cap.settle?.('t1', { ok: true, value: 'sunny' });
    await cap.flush?.();

    expect(source.addMessage).toHaveBeenCalledTimes(1);
    expect(source.continueRun).not.toHaveBeenCalled();
  });

  // ---- resolve — error result ------------------------------------------------

  it('resolve(error) writes { error } result + error + status=error onto the store tool call', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);
    store.isLoading.set(false);
    store.toolCalls.set([{ id: 'c1', name: 'get_weather', args: {}, status: 'complete' }]);

    cap.resolve('c1', { ok: false, error: 'boom' });

    const tc = store.toolCalls().find((t) => t.id === 'c1');
    expect(tc?.result).toEqual({ error: 'boom' });
    expect(tc?.error).toBe('boom');
    expect(tc?.status).toBe('error');
  });

  it('resolve(error) adds message whose content contains the error string', () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);

    cap.resolve('c2', { ok: false, error: 'boom' });

    const msg = source.addMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain('boom');
  });

  it('resolve(error) still requests continuation', async () => {
    const source = makeSource();
    const store  = makeStore();
    const cap    = createClientToolsCapability(source, store);
    cap.setCatalog([WEATHER_SPEC]);

    cap.resolve('c2', { ok: false, error: 'network timeout' });

    await Promise.resolve();
    expect(source.continueRun).toHaveBeenCalledOnce();
  });
});

// ---- Integration: toAgent wires clientTools and threads catalog into submit ----
// These tests re-use the StubAgent pattern from to-agent.spec.ts to verify that
// submit() passes tools to source.runAgent() once a catalog is set.

import { Observable } from 'rxjs';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import type { RunAgentInput } from '@ag-ui/core';
import { toAgent } from './to-agent';

class StubAgent {
  private readonly _subscribers: Array<{
    onEvent?: (p: { event: BaseEvent }) => void;
    onRunFailed?: (p: { error: Error }) => void;
  }> = [];

  subscribe(sub: {
    onEvent?: (p: { event: BaseEvent }) => void;
    onRunFailed?: (p: { error: Error }) => void;
  }) {
    this._subscribers.push(sub);
    return { unsubscribe: () => { /* no-op */ } };
  }

  emit(event: BaseEvent): void {
    for (const sub of this._subscribers) sub.onEvent?.({ event });
  }

  runAgent = vi.fn(async () => ({ result: undefined, newMessages: [] }));
  abortRun = vi.fn();
  addMessage = vi.fn();
  setMessages = vi.fn();

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }
}

describe('toAgent — clientTools integration', () => {
  it('exposes agent.clientTools with setCatalog/pending/resolve', () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    expect(typeof agent.clientTools.setCatalog).toBe('function');
    expect(typeof agent.clientTools.pending).toBe('function');
    expect(typeof agent.clientTools.resolve).toBe('function');
  });

  it('submit() passes tools to runAgent after setCatalog', async () => {
    const stub  = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    agent.clientTools.setCatalog([WEATHER_SPEC]);

    await agent.submit({ message: 'what is the weather?' });

    expect(stub.runAgent).toHaveBeenCalledOnce();
    const args = stub.runAgent.mock.calls[0][0] as { tools: Array<{ name: string }> };
    expect(args?.tools).toBeDefined();
    expect(args.tools.some((t) => t.name === 'get_weather')).toBe(true);
  });

  it('submit() without catalog passes undefined (no tools key) to runAgent', async () => {
    const stub  = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);

    await agent.submit({ message: 'hello' });

    expect(stub.runAgent).toHaveBeenCalledOnce();
    // When no catalog is set, runAgent is called with undefined (not { tools: [] })
    expect(stub.runAgent.mock.calls[0][0]).toBeUndefined();
  });

  it('submit({ resume }) threads catalog tools into forwardedProps call', async () => {
    const stub  = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    agent.clientTools.setCatalog([WEATHER_SPEC]);

    stub.emit({ type: 'CUSTOM', name: 'on_interrupt', value: {} } as unknown as BaseEvent);
    await agent.submit({ resume: { approved: true } });

    expect(stub.runAgent).toHaveBeenCalledOnce();
    const args = stub.runAgent.mock.calls[0][0] as {
      forwardedProps: unknown;
      tools: Array<{ name: string }>;
    };
    expect(args.forwardedProps).toEqual({ command: { resume: { approved: true } } });
    expect(args.tools?.some((t) => t.name === 'get_weather')).toBe(true);
  });
});
