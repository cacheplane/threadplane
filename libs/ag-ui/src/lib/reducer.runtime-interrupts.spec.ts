//
// Transcript-driven interrupt-detection tests.
//
// The fixtures under libs/ag-ui/fixtures/runtime-transcripts/ are REAL SSE
// captures from the 2026-08-31 runtime-portability spikes (AWS Strands,
// Microsoft Agent Framework, Mastra), replayed here event-for-event through
// reduceEvent. Payloads are verbatim from the wire — do not edit them.
//
// AWS Strands and Microsoft Agent Framework signal interrupts ONLY via the
// protocol-standard RUN_FINISHED outcome = { type: 'interrupt', interrupts };
// Mastra emits the CUSTOM on_interrupt bridge convention AND the outcome.
// The LangGraph bridge emits only CUSTOM on_interrupt.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import {
  completeDelivery,
  type AgentError,
  type AgentStatus,
  type Message,
  type ToolCall,
  type AgentEvent,
  type AgentUsage,
} from '@threadplane/chat';
import { reduceEvent, type ReducerStore, type CustomStreamEvent, type ActivityEntry } from './reducer';
import { toAgent } from './to-agent';

const FIXTURES_DIR = join(__dirname, '../../fixtures/runtime-transcripts');

/** Parse an SSE capture into its event objects (one per `data:` line). */
function readSseFixture(name: string): BaseEvent[] {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length)) as BaseEvent);
}

/** Parse a plain JSON-array transcript (synthetic, not an SSE capture). */
function readJsonFixture(name: string): BaseEvent[] {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  return JSON.parse(raw) as BaseEvent[];
}

function makeStore(generation = 'run-generation-1'): ReducerStore {
  let sequence = 0;
  return {
    messages:  signal<Message[]>([]),
    status:    signal<AgentStatus>('idle'),
    isLoading: signal(false),
    error:     signal<AgentError | undefined>(undefined),
    toolCalls: signal<ToolCall[]>([]),
    state:     signal<Record<string, unknown>>({}),
    interrupt: signal(undefined),
    events$:   new Subject<AgentEvent>(),
    customEvents: signal<CustomStreamEvent[]>([]),
    activities: signal<Map<string, ActivityEntry>>(new Map()),
    usage: signal<AgentUsage | undefined>(undefined),
    pendingClientToolCallIds: signal<ReadonlySet<string> | undefined>(undefined),
    deliveryRun: {
      generation,
      baselineMessageIds: new Set<string>(),
      ownedMessageIds: new Set<string>(),
      snapshotReplacementIds: new Set<string>(),
    },
    allocateDeliveryGeneration: (scope: string) => `${generation}:${scope}:${++sequence}`,
  } as ReducerStore;
}

function replay(store: ReducerStore, events: readonly BaseEvent[]): void {
  for (const event of events) reduceEvent(event, store);
}

describe('RUN_FINISHED interrupt outcome — AWS Strands transcript', () => {
  // Source: spike-strands/transcripts/interrupt_phase1.sse (schedule_meeting
  // approval interrupt; RUN_FINISHED carries the interrupt outcome).
  const events = readSseFixture('strands-interrupt.sse');

  it('sets the interrupt signal preserving all identifying fields from the outcome', () => {
    const store = makeStore();
    replay(store, events);

    const ix = store.interrupt();
    expect(ix).toBeDefined();
    expect(ix!.resumable).toBe(true);
    // The interrupt id is the outcome entry's id — needed verbatim on resume.
    expect(ix!.id).toBe(
      'v1:tool_call:call_A9ckGX1LrvO82OhqZinzDsom:340a4daa-b874-5aad-8309-a63b92d507dd',
    );
    const value = ix!.value as { interrupts: Array<Record<string, unknown>>; runId?: string };
    expect(value.runId).toBe('run-1');
    expect(value.interrupts).toEqual([{
      id: 'v1:tool_call:call_A9ckGX1LrvO82OhqZinzDsom:340a4daa-b874-5aad-8309-a63b92d507dd',
      reason: 'schedule_meeting',
      metadata: { reason: { topic: 'Q3 roadmap', attendee: 'Dana' } },
    }]);
  });

  it("finalizes the run as 'paused' (idle, not loading), not 'success'", () => {
    const store = makeStore();
    replay(store, events);

    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
    const assistant = store.messages().find((m) => m.role === 'assistant');
    expect(assistant?.delivery).toEqual(completeDelivery('run-generation-1', 'paused'));
  });

  it('keeps the pending approval tool call with its streamed args', () => {
    const store = makeStore();
    replay(store, events);

    const call = store.toolCalls().find((t) => t.name === 'schedule_meeting');
    expect(call).toBeDefined();
    expect(call!.id).toBe('call_A9ckGX1LrvO82OhqZinzDsom');
    expect(call!.args).toEqual({ topic: 'Q3 roadmap', attendee: 'Dana' });
  });

  // SYNTHETIC follow-up event: no transcript carries a plain RUN_FINISHED
  // after an interrupt outcome; this guards the ordering contract directly.
  it('a later plain RUN_FINISHED does not flip the paused run to success', () => {
    const store = makeStore();
    replay(store, events);
    const interruptBefore = store.interrupt();

    reduceEvent({ type: 'RUN_FINISHED', runId: 'run-1' } as unknown as BaseEvent, store);

    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.interrupt()).toBe(interruptBefore);
    const assistant = store.messages().find((m) => m.role === 'assistant');
    expect(assistant?.delivery).toEqual(completeDelivery('run-generation-1', 'paused'));
  });
});

describe('RUN_FINISHED interrupt outcome — Microsoft Agent Framework transcript', () => {
  // Source: spike-maf/transcripts/06-hitl-interrupt.sse (generate_task_steps
  // function-approval request delivered via the RUN_FINISHED outcome).
  const events = readSseFixture('maf-hitl-interrupt.sse');

  it('sets the interrupt with the full function-approval entry preserved', () => {
    const store = makeStore();
    replay(store, events);

    const ix = store.interrupt();
    expect(ix).toBeDefined();
    expect(ix!.resumable).toBe(true);
    expect(ix!.id).toBe('call_VlNsrwdW5hhp2G8Ufp6i8ueQ');
    const value = ix!.value as { interrupts: Array<Record<string, unknown>>; runId?: string };
    expect(value.runId).toBe('83caa76f-b177-4c68-9b2b-ad1be07589e5');
    expect(value.interrupts).toHaveLength(1);
    const entry = value.interrupts[0];
    expect(entry['id']).toBe('call_VlNsrwdW5hhp2G8Ufp6i8ueQ');
    expect(entry['reason']).toBe('tool_call');
    expect(entry['toolCallId']).toBe('call_VlNsrwdW5hhp2G8Ufp6i8ueQ');
    expect(entry['responseSchema']).toMatchObject({ type: 'object' });
    expect(entry['metadata']).toMatchObject({
      agent_framework: {
        type: 'function_approval_request',
        function_call: { call_id: 'call_VlNsrwdW5hhp2G8Ufp6i8ueQ', name: 'generate_task_steps' },
      },
    });
  });

  it("finalizes the run as 'paused' with the approval call intact", () => {
    const store = makeStore();
    replay(store, events);

    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
    const call = store.toolCalls().find((t) => t.name === 'generate_task_steps');
    expect(call).toBeDefined();
  });
});

describe('CUSTOM on_interrupt + RUN_FINISHED outcome — Mastra transcript (both events)', () => {
  // Source: spike-mastra/transcripts/05a-interrupt.sse. Mastra emits the
  // CUSTOM on_interrupt bridge convention FIRST, then a RUN_FINISHED that
  // also carries the interrupt outcome — the real double-event case.
  const events = readSseFixture('mastra-interrupt.sse');

  it('keeps the CUSTOM on_interrupt payload (first signal wins) and finalizes once', () => {
    const store = makeStore();
    replay(store, events);

    const ix = store.interrupt();
    expect(ix).toBeDefined();
    expect(ix!.resumable).toBe(true);
    // Value is the parsed on_interrupt payload — NOT the outcome wrapper.
    const value = ix!.value as Record<string, unknown>;
    expect(value['type']).toBe('mastra_suspend');
    expect(value['toolCallId']).toBe('call_Foj4SpskZ2aqeqPgqsm4FYq1');
    expect(value['toolName']).toBe('schedule_meeting');
    expect(value['runId']).toBe('run-hitl-1');
    expect(value['interrupts']).toBeUndefined();

    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
  });

  // SYNTHETIC ordering permutation: no captured transcript emits the
  // RUN_FINISHED interrupt outcome BEFORE the CUSTOM on_interrupt, so the
  // reverse order is replayed here from the same captured payloads.
  it('reverse order (outcome first, then on_interrupt) does not clobber the interrupt', () => {
    const store = makeStore();
    const [runStarted, custom, runFinished] = events;
    reduceEvent(runStarted, store);
    reduceEvent(runFinished, store);

    const fromOutcome = store.interrupt();
    expect(fromOutcome).toBeDefined();
    expect(store.deliveryRun?.outcome).toBe('paused');

    reduceEvent(custom, store);

    // First signal (the outcome-derived interrupt) wins; no double-finalize.
    expect(store.interrupt()).toBe(fromOutcome);
    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
  });
});

describe("RUN_FINISHED outcome { type: 'success' } — Strands plain-chat transcript", () => {
  // Source: spike-strands/transcripts/plain_chat.sse. Strands stamps a
  // success outcome on every RUN_FINISHED — it must behave exactly like a
  // plain RUN_FINISHED (no interrupt, run finalized as success).
  it('finalizes as success and leaves the interrupt signal unset', () => {
    const store = makeStore();
    replay(store, readSseFixture('strands-plain-chat.sse'));

    expect(store.interrupt()).toBeUndefined();
    expect(store.deliveryRun?.outcome).toBe('success');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
    const assistant = store.messages().find((m) => m.role === 'assistant');
    expect(assistant?.delivery).toEqual(completeDelivery('run-generation-1', 'success'));
  });
});

describe('toAgent end-to-end — Strands interrupt transcript through the adapter', () => {
  /** Minimal AbstractAgent stand-in (mirrors to-agent.spec.ts's StubAgent). */
  class StubAgent {
    state: Record<string, unknown> = {};
    private readonly subscribers: Array<{
      onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void;
    }> = [];
    subscribe(sub: { onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void }) {
      this.subscribers.push(sub);
      return { unsubscribe: () => undefined };
    }
    emit(event: BaseEvent, callbackRunId?: string): void {
      for (const sub of this.subscribers) sub.onEvent?.({ event, input: { runId: callbackRunId } });
    }
    runAgent = vi.fn(async () => ({ result: undefined, newMessages: [] }));
    abortRun = vi.fn();
    addMessage = vi.fn();
    setMessages = vi.fn();
  }

  it('surfaces the interrupt and settles idle/not-loading after submit', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    let finishRun!: () => void;
    stub.runAgent.mockImplementationOnce(() => new Promise((resolve) => {
      finishRun = () => resolve({ result: undefined, newMessages: [] });
    }));

    const submitted = agent.submit({ message: 'Schedule a meeting with Dana about the Q3 roadmap.' });
    for (const event of readSseFixture('strands-interrupt.sse')) {
      stub.emit(event, 'run-1');
    }
    finishRun();
    await submitted;

    expect(agent.interrupt!()).toMatchObject({
      id: 'v1:tool_call:call_A9ckGX1LrvO82OhqZinzDsom:340a4daa-b874-5aad-8309-a63b92d507dd',
      resumable: true,
    });
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    expect(agent.error()).toBeUndefined();
  });
});

describe('toAgent end-to-end — synthetic subagent-lifecycle transcript', () => {
  // Source: subagent-lifecycle.json — a synthetic (not vendor-captured) wire
  // sequence pinning the SUBAGENT_STARTED/FINISHED contract: a parent tool
  // call (call-9) spawns a subagentRunId-attributed child (sa-1) whose
  // TEXT_MESSAGE_* events must route into subagents(), never the parent
  // transcript, while the parent's own TOOL_CALL_END/RESULT for call-9 stay
  // on the parent side because they carry no subagentRunId.
  class StubAgent {
    state: Record<string, unknown> = {};
    private readonly subscribers: Array<{
      onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void;
    }> = [];
    subscribe(sub: { onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void }) {
      this.subscribers.push(sub);
      return { unsubscribe: () => undefined };
    }
    emit(event: BaseEvent, callbackRunId?: string): void {
      for (const sub of this.subscribers) sub.onEvent?.({ event, input: { runId: callbackRunId } });
    }
    runAgent = vi.fn(async () => ({ result: undefined, newMessages: [] }));
    abortRun = vi.fn();
    addMessage = vi.fn();
    setMessages = vi.fn();
  }

  it('routes the child transcript into subagents() and keeps the parent transcript to its own two messages', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    let finishRun!: () => void;
    stub.runAgent.mockImplementationOnce(() => new Promise((resolve) => {
      finishRun = () => resolve({ result: undefined, newMessages: [] });
    }));

    const submitted = agent.submit({ message: 'Can you check availability and confirm?' });
    for (const event of readJsonFixture('subagent-lifecycle.json')) {
      stub.emit(event, 'run-subagent-1');
    }
    finishRun();
    await submitted;

    const parentAssistantMessages = agent.messages().filter((m) => m.role === 'assistant');
    expect(parentAssistantMessages).toHaveLength(2);
    expect(parentAssistantMessages.map((m) => m.id)).toEqual(['m-parent-1', 'm-parent-2']);

    const subagents = agent.subagents!();
    expect(subagents.size).toBe(1);
    const sa = subagents.get('sa-1');
    expect(sa).toBeDefined();
    expect(sa!.toolCallId).toBe('call-9');
    expect(sa!.name).toBe('researcher');
    expect(sa!.status()).toBe('complete');
    expect(sa!.messages()).toHaveLength(1);
    expect(sa!.messages()[0]).toMatchObject({ id: 'sa-1-m1', content: 'Checking availability' });

    // The child's messageId must never leak into the parent transcript.
    expect(agent.messages().some((m) => m.id === 'sa-1-m1')).toBe(false);
  });
});
