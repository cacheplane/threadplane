import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpAgent, type BaseEvent } from '@ag-ui/client';
import { Observable, of } from 'rxjs';
import { toAgent } from './to-agent';
import { httpReplay } from './replay';
import type { AgUiInterruptPersistence, AgUiThreadRecord } from './interrupt-persistence';

const ev = (event: Record<string, unknown>) => event as unknown as BaseEvent;

/** A shallow copy of `value` without `key`. */
function omit(value: object, key: string): Record<string, unknown> {
  const copy = { ...(value as Record<string, unknown>) };
  delete copy[key];
  return copy;
}

function sse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A source whose live runs answer with `liveEvents(input)`; replay never calls it. */
function source(liveEvents: (input: { runId: string; threadId: string }) => unknown[] = input => [
  { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
  { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId },
]) {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => sse(liveEvents(JSON.parse(String(init?.body)))));
  return { source: new HttpAgent({ url: 'http://test.invalid', threadId: 't1', fetch }), fetch };
}

function memory(record?: AgUiThreadRecord) {
  const records = new Map<string, AgUiThreadRecord>();
  const config: AgUiInterruptPersistence = {
    namespace: 'account/agent',
    store: {
      async load(key) { return structuredClone(records.get(key) ?? null); },
      async compareAndSwap(key, revision, next) {
        if ((records.get(key)?.revision ?? null) !== revision) return false;
        records.set(key, structuredClone(next)); return true;
      },
    },
  };
  if (record) records.set(JSON.stringify([config.namespace, record.threadId]), record);
  return { config, records };
}

const persistedRecord: AgUiThreadRecord = {
  version: 1, namespace: 'account/agent', threadId: 't1', revision: 0,
  committed: { state: { from: 'persistence' }, messages: [{ id: 'p1', role: 'user', content: 'persisted question' }] },
  session: { phase: 'none', generation: 0, interrupts: [] },
};

/** A drained run: user turn in the run input, reasoning, text, a tool call and its result. */
const drainedRun: BaseEvent[] = [
  ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1', input: {
    threadId: 't1', runId: 'r1', state: {}, tools: [], context: [], forwardedProps: {},
    messages: [{ id: 'u1', role: 'user', content: 'Find flights' }],
  } }),
  ev({ type: 'REASONING_MESSAGE_START', messageId: 'a1', role: 'reasoning', timestamp: 1_000 }),
  ev({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'a1', delta: 'Checking routes' }),
  ev({ type: 'REASONING_MESSAGE_END', messageId: 'a1', timestamp: 3_500 }),
  ev({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }),
  ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Searching now.' }),
  ev({ type: 'TEXT_MESSAGE_END', messageId: 'a1' }),
  ev({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'search', parentMessageId: 'a1' }),
  ev({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"from":' }),
  ev({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '"SFO"}' }),
  ev({ type: 'TOOL_CALL_END', toolCallId: 'tc1' }),
  ev({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', messageId: 'tr1', content: '{"count":3}' }),
  ev({ type: 'STATE_SNAPSHOT', snapshot: { searches: 1 } }),
  ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' }),
];

const parkedRun: BaseEvent[] = [
  ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r2', input: {
    threadId: 't1', runId: 'r2', state: {}, tools: [], context: [], forwardedProps: {},
    messages: [{ id: 'u2', role: 'user', content: 'Book it' }],
  } }),
  ev({ type: 'TOOL_CALL_START', toolCallId: 'tc2', toolCallName: 'book', parentMessageId: 'a2' }),
  ev({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc2', delta: '{"flight":"UA1"}' }),
  ev({ type: 'TOOL_CALL_END', toolCallId: 'tc2' }),
  ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'confirmation', toolCallId: 'tc2' }] } }),
];

afterEach(() => vi.restoreAllMocks());

describe('toAgent replay', () => {
  it('rebuilds a drained run — messages, tool calls and reasoning — through the live reducer', async () => {
    const { source: src, fetch } = source();
    const replay = vi.fn(async () => drainedRun);
    const agent = toAgent(src, { replay, telemetry: false });
    expect(agent.isInputBlocked?.()).toBe(true);
    await agent.ready;

    expect(replay).toHaveBeenCalledWith('t1', expect.any(AbortSignal));
    expect(fetch).not.toHaveBeenCalled();
    expect(agent.isInputBlocked?.()).toBe(false);
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    const messages = agent.messages();
    expect(messages.map(m => [m.id, m.role])).toEqual([['u1', 'user'], ['a1', 'assistant']]);
    expect(messages[0].content).toBe('Find flights');
    expect(messages[1]).toMatchObject({
      content: 'Searching now.', reasoning: 'Checking routes', reasoningDurationMs: 2_500, toolCallIds: ['tc1'],
    });
    expect(messages[1].delivery).toMatchObject({ phase: 'complete', outcome: 'success' });
    expect(agent.toolCalls()).toEqual([
      expect.objectContaining({ id: 'tc1', name: 'search', args: { from: 'SFO' }, status: 'complete', result: { count: 3 } }),
    ]);
    expect(agent.state()).toEqual({ searches: 1 });
    expect(src.state).toEqual({ searches: 1 });
    agent.dispose();
  });

  it('matches the view and the next request history a live run of the same events leaves', async () => {
    const runEvents = drainedRun.slice(1, -1);
    const live = source(input => [
      { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
      ...runEvents,
      { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId },
    ]);
    const liveAgent = toAgent(live.source, { telemetry: false });
    await liveAgent.submit({ message: 'Find flights' });
    const userId = liveAgent.messages()[0].id;

    const replayed = source();
    const replayEvents = drainedRun.map(event => event.type !== 'RUN_STARTED' ? event : ev({
      ...(event as unknown as Record<string, unknown>),
      input: { threadId: 't1', runId: 'r1', state: {}, tools: [], context: [], forwardedProps: {},
        messages: [{ id: userId, role: 'user', content: 'Find flights' }] },
    }));
    const replayAgent = toAgent(replayed.source, { replay: async () => replayEvents, telemetry: false });
    await replayAgent.ready;

    // Generations and the local reasoning clock differ by construction.
    const view = (agent: typeof liveAgent) => agent.messages().map(message => ({
      ...omit(omit(message, 'delivery'), 'reasoningDurationMs'),
      phase: message.delivery.phase,
      outcome: message.delivery.phase === 'complete' ? message.delivery.outcome : undefined,
    }));
    expect(view(replayAgent)).toEqual(view(liveAgent));
    expect(replayAgent.toolCalls()).toEqual(liveAgent.toolCalls());
    expect(replayAgent.state()).toEqual(liveAgent.state());
    // The next request carries the same history it would after the live run.
    // (The live source also holds the local user message's delivery stamp, which
    // the client strips from outgoing input.)
    const outgoing = (messages: readonly object[]) => messages.map(message => omit(message, 'delivery'));
    expect(outgoing(replayed.source.messages)).toEqual(outgoing(live.source.messages));
    expect(replayed.source.state).toEqual(live.source.state);
    liveAgent.dispose(); replayAgent.dispose();
  });

  it('omits a reasoning duration the replayed events cannot establish', async () => {
    const events = drainedRun.map(event => ev(omit(event, 'timestamp')));
    const agent = toAgent(source().source, { replay: async () => events, telemetry: false });
    await agent.ready;
    const assistant = agent.messages().find(m => m.id === 'a1');
    expect(assistant?.reasoning).toBe('Checking routes');
    expect(assistant && 'reasoningDurationMs' in assistant).toBe(false);
    agent.dispose();
  });

  it('emits every replayed event on rawEvents$, in order, after the signals reflect them', async () => {
    const agent = toAgent(source().source, { replay: async () => drainedRun, telemetry: false });
    const seen: Array<{ type: string; messages: number }> = [];
    agent.rawEvents$.subscribe(event => seen.push({ type: event.type, messages: agent.messages().length }));
    await agent.ready;
    expect(seen.map(entry => entry.type)).toEqual(drainedRun.map(event => event.type));
    expect(seen.every(entry => entry.messages === 2)).toBe(true);
    agent.dispose();
  });

  it('restores a parked run as a pending interrupt that resume answers', async () => {
    const { source: src, fetch } = source(input => [
      { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'tc2', messageId: 'tr2', content: '{"booked":true}' },
      { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId },
    ]);
    const agent = toAgent(src, { replay: async () => [...drainedRun, ...parkedRun], telemetry: false });
    await agent.ready;

    expect(agent.status()).toBe('idle');
    expect(agent.interruptSession().phase).toBe('pending');
    expect(agent.interruptSession().interrupts.map(entry => entry.id)).toEqual(['i1']);
    expect(agent.interrupt()?.id).toBe('i1');
    expect(src.pendingInterrupts?.map(entry => entry.id)).toEqual(['i1']);
    expect(agent.messages().map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(agent.messages().find(m => m.id === 'a2')?.delivery).toMatchObject({ outcome: 'paused' });
    expect(agent.isInputBlocked?.()).toBe(true);

    await agent.submit({ resume: true }, { interruptGeneration: agent.interruptSession().generation });
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.resume).toEqual([{ interruptId: 'i1', status: 'resolved', payload: true }]);
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(src.messages.map(m => m.id).slice(0, body.messages.length));
    expect(body.messages.filter((m: { role: string }) => m.role === 'user').map((m: { id: string }) => m.id)).toEqual(['u1', 'u2']);
    expect(agent.error()).toBeUndefined();
    expect(agent.interruptSession().phase).toBe('none');
    expect(agent.toolCalls().find(tool => tool.id === 'tc2')?.result).toEqual({ booked: true });
    agent.dispose();
  });

  it('treats a run after a pause as the answer to that pause', async () => {
    const resumed: BaseEvent[] = [
      ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r3' }),
      ev({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc2', messageId: 'tr2', content: 'ok' }),
      ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r3' }),
    ];
    const agent = toAgent(source().source, { replay: async () => [...drainedRun, ...parkedRun, ...resumed], telemetry: false });
    await agent.ready;
    expect(agent.interruptSession().phase).toBe('none');
    expect(agent.interrupt()).toBeUndefined();
    expect(agent.isInputBlocked?.()).toBe(false);
    agent.dispose();
  });

  it('restores a legacy custom interrupt', async () => {
    const events: BaseEvent[] = [
      ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }),
      ev({ type: 'CUSTOM', name: 'on_interrupt', value: JSON.stringify({ question: 'Proceed?' }) }),
      ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' }),
    ];
    const agent = toAgent(source().source, { replay: async () => events, telemetry: false });
    await agent.ready;
    expect(agent.interruptSession().phase).toBe('pending');
    expect(agent.interrupt()?.value).toEqual({ question: 'Proceed?' });
    agent.dispose();
  });

  it('nests subagent events under their card rather than the parent transcript', async () => {
    const events: BaseEvent[] = [
      ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }),
      ev({ type: 'TOOL_CALL_START', toolCallId: 'dispatch-1', toolCallName: 'task', parentMessageId: 'a1' }),
      ev({ type: 'TOOL_CALL_END', toolCallId: 'dispatch-1' }),
      ev({ type: 'SUBAGENT_STARTED', subagentRunId: 'sub-1', name: 'researcher', parentToolCallId: 'dispatch-1' }),
      ev({ type: 'REASONING_MESSAGE_START', messageId: 'c1', role: 'reasoning', subagentRunId: 'sub-1' }),
      ev({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'c1', delta: 'Child thinking', subagentRunId: 'sub-1' }),
      ev({ type: 'TEXT_MESSAGE_START', messageId: 'c1', role: 'assistant', subagentRunId: 'sub-1' }),
      ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'c1', delta: 'Child answer', subagentRunId: 'sub-1' }),
      ev({ type: 'TOOL_CALL_START', toolCallId: 'child-tool', toolCallName: 'lookup', parentMessageId: 'c1', subagentRunId: 'sub-1' }),
      ev({ type: 'TOOL_CALL_END', toolCallId: 'child-tool', subagentRunId: 'sub-1' }),
      ev({ type: 'SUBAGENT_FINISHED', subagentRunId: 'sub-1', outcome: { type: 'success' } }),
      ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' }),
    ];
    const agent = toAgent(source().source, { replay: async () => events, telemetry: false });
    await agent.ready;
    const subagent = agent.subagents().get('sub-1');
    expect(subagent).toBeDefined();
    expect(subagent?.toolCallId).toBe('dispatch-1');
    expect(subagent?.name).toBe('researcher');
    expect(subagent?.status()).toBe('complete');
    expect(subagent?.messages()).toEqual([
      expect.objectContaining({ id: 'c1', content: 'Child answer', reasoning: 'Child thinking', toolCallIds: ['child-tool'] }),
    ]);
    expect(subagent?.toolCalls().map(tool => tool.id)).toEqual(['child-tool']);
    expect(agent.messages().map(m => m.id)).toEqual(['a1']);
    expect(agent.toolCalls().map(tool => tool.id)).toEqual(['dispatch-1']);
    agent.dispose();
  });

  it('settles a run the replay ends mid-stream as interrupted and leaves the agent idle', async () => {
    const events = drainedRun.slice(0, 6);
    const agent = toAgent(source().source, { replay: async () => events, telemetry: false });
    await agent.ready;
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    expect(agent.error()).toBeUndefined();
    expect(agent.messages().find(m => m.id === 'a1')?.delivery).toMatchObject({ phase: 'complete', outcome: 'interrupted' });
    agent.dispose();
  });

  it('accepts an Observable replay source', async () => {
    const agent = toAgent(source().source, { replay: () => of(...drainedRun), telemetry: false });
    await agent.ready;
    expect(agent.messages().map(m => m.id)).toEqual(['u1', 'a1']);
    agent.dispose();
  });

  it('wins over persistence when it returns events, without reading the store', async () => {
    const { config } = memory(persistedRecord);
    const load = vi.spyOn(config.store, 'load');
    const agent = toAgent(source().source, { replay: async () => drainedRun, persistence: config, telemetry: false });
    await agent.ready;
    expect(agent.messages().map(m => m.id)).toEqual(['u1', 'a1']);
    expect(load).not.toHaveBeenCalled();
    agent.dispose();
  });

  it('falls back to persistence when replay returns nothing', async () => {
    const { config } = memory(persistedRecord);
    const agent = toAgent(source().source, { replay: async () => [], persistence: config, telemetry: false });
    const raw: string[] = [];
    agent.rawEvents$.subscribe(event => raw.push(event.type));
    await agent.ready;
    expect(agent.messages().map(m => m.content)).toEqual(['persisted question']);
    expect(agent.state()).toEqual({ from: 'persistence' });
    expect(raw).toEqual([]);
    agent.dispose();
  });

  it('falls back to persistence, without rejecting ready, when replay fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { config } = memory(persistedRecord);
    const agent = toAgent(source().source, {
      replay: async () => { throw new Error('server unavailable'); }, persistence: config, telemetry: false,
    });
    await expect(agent.ready).resolves.toBeUndefined();
    expect(agent.messages().map(m => m.content)).toEqual(['persisted question']);
    expect(agent.error()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    agent.dispose();
  });

  it('discards a replay it cannot fold and falls back to persistence', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { config } = memory(persistedRecord);
    const events: BaseEvent[] = [
      ...drainedRun.slice(0, 7),
      ev({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'interrupt', interrupts: 'not-a-list' } }),
    ];
    const agent = toAgent(source().source, { replay: async () => events, persistence: config, telemetry: false });
    const raw: string[] = [];
    agent.rawEvents$.subscribe(event => raw.push(event.type));
    await agent.ready;
    expect(agent.messages().map(m => m.content)).toEqual(['persisted question']);
    expect(agent.toolCalls()).toEqual([]);
    expect(raw).toEqual([]);
    agent.dispose();
  });

  it('starts empty when replay returns nothing and no persistence is configured', async () => {
    const agent = toAgent(source().source, { replay: async () => [], telemetry: false });
    await agent.ready;
    expect(agent.messages()).toEqual([]);
    expect(agent.isInputBlocked?.()).toBe(false);
    agent.dispose();
  });

  it('aborts the replay request on dispose and applies nothing', async () => {
    let signal!: AbortSignal;
    let resolve!: (events: BaseEvent[]) => void;
    const agent = toAgent(source().source, {
      replay: (_threadId, abort) => { signal = abort; return new Promise(r => { resolve = r; }); },
      telemetry: false,
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    agent.dispose();
    expect(signal.aborted).toBe(true);
    resolve(drainedRun);
    await agent.ready;
    expect(agent.messages()).toEqual([]);
  });

  it('unsubscribes an Observable replay on dispose', async () => {
    let unsubscribed = false;
    const agent = toAgent(source().source, {
      replay: () => new Observable<BaseEvent>(() => () => { unsubscribed = true; }),
      telemetry: false,
    });
    await Promise.resolve();
    agent.dispose();
    await agent.ready;
    expect(unsubscribed).toBe(true);
  });

  it('redacts a replayed run error where operation errors are protected', async () => {
    const { ɵtoAgentWithProtectedErrors } = await import('./to-agent');
    const events: BaseEvent[] = [
      ev({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }),
      ev({ type: 'RUN_ERROR', message: 'secret stack trace', code: 'E_INTERNAL' }),
    ];
    const agent = ɵtoAgentWithProtectedErrors(source().source, { replay: async () => events, telemetry: false });
    const raw: BaseEvent[] = [];
    agent.rawEvents$.subscribe(event => raw.push(event));
    await agent.ready;
    expect(agent.status()).toBe('error');
    expect(agent.error()?.message).not.toContain('secret');
    expect(raw.at(-1)).toEqual({ type: 'RUN_ERROR', message: agent.error()?.message });
    agent.dispose();
  });

  it('replays through httpReplay end to end', async () => {
    const fetch = vi.fn(async () => Response.json({ events: drainedRun }));
    const agent = toAgent(source().source, {
      replay: httpReplay({ url: id => `http://test.invalid/threads/${id}/events`, fetch }),
      telemetry: false,
    });
    await agent.ready;
    expect(fetch).toHaveBeenCalledWith('http://test.invalid/threads/t1/events', expect.objectContaining({ method: 'GET' }));
    expect(agent.messages().map(m => m.id)).toEqual(['u1', 'a1']);
    agent.dispose();
  });
});
