import { Observable } from 'rxjs';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import type { RunAgentInput } from '@ag-ui/core';
import { runAgentConformance } from '@threadplane/chat/testing';
import { toAgent } from './to-agent';
import type { AgUiInterruptPersistence, AgUiThreadRecord } from './interrupt-persistence';
import {
  INTERRUPT_CONFORMANCE_BATCH,
  runInterruptConformance,
  type InterruptConformanceRequest,
} from '@threadplane/chat/testing';

/**
 * Minimal stub that satisfies the AbstractAgent shape for conformance testing.
 * Implements all methods that toAgent() calls: subscribe(), runAgent(),
 * abortRun(), addMessage(), and the abstract run() method.
 */
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { unsubscribe: () => {} };
  }

  async runAgent() {
    return { result: undefined, newMessages: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  abortRun() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  addMessage(_msg: unknown) {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }
}

runAgentConformance('toAgent (AG-UI adapter)', () => {
  return toAgent(new StubAgent() as unknown as AbstractAgent);
});

runInterruptConformance('toAgent (AG-UI adapter)', () => {
  const requests: InterruptConformanceRequest[] = [];
  let pause = false;
  let fail = false;
  let runNumber = 0;
  let lateGate: Promise<void> | undefined;
  let releaseLate: (() => void) | undefined;
  let startedLate: (() => void) | undefined;
  let lateRun: Promise<void> | undefined;
  const subscribers: Array<{
    onRunInitialized?: (p: { input: { runId: string } }) => void;
    onEvent?: (p: { event: BaseEvent; input: { runId: string } }) => void;
  }> = [];
  const source = {
    threadId: 'conformance-thread',
    state: {} as Record<string, unknown>,
    messages: [] as Array<{ content: string }>,
    subscribe(sub: typeof subscribers[number]) {
      subscribers.push(sub);
      return { unsubscribe: () => { subscribers.splice(subscribers.indexOf(sub), 1); } };
    },
    addMessage(message: { content: string }) { this.messages.push(message); },
    abortRun() { /* Local transport abort does not cancel a backend checkpoint. */ },
    async runAgent(parameters?: { runId?: string; resume?: Array<{ payload: unknown }>; forwardedProps?: { command?: { resume?: unknown } } }) {
      requests.push({
        resume: parameters?.resume ?? parameters?.forwardedProps?.command?.resume,
        state: { ...this.state },
        messages: this.messages.map(message => message.content),
      });
      if (fail) {
        fail = false;
        throw Object.assign(new Error('Known failure before dispatch'), { requestNotDispatched: true });
      }
      // A real AG-UI server echoes the runId it was handed (resume carries one),
      // so the adapter can attribute the run's terminal event back to it.
      const runId = parameters?.runId ?? `run-${++runNumber}`;
      for (const sub of subscribers) sub.onRunInitialized?.({ input: { runId } });
      // Capture callbacks before unsubscribe to model queued SDK delivery.
      const runSubscribers = [...subscribers];
      const emit = (event: unknown) => {
        for (const sub of runSubscribers) sub.onEvent?.({ event: event as BaseEvent, input: { runId } });
      };
      emit({ type: 'RUN_STARTED', runId });
      if (lateGate) {
        startedLate?.();
        await lateGate;
        emit({ type: 'STATE_SNAPSHOT', snapshot: { late: true } });
        emit({ type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'late-message', role: 'assistant', content: 'Late response' }] });
        emit({ type: 'RUN_FINISHED', runId, outcome: { type: 'interrupt', interrupts: [
          { id: 'late-interrupt', reason: 'confirmation', value: { question: 'Too late?' } },
        ] } });
        return { result: undefined, newMessages: [] };
      }
      emit({ type: 'RUN_FINISHED', runId, ...(pause ? {
        outcome: { type: 'interrupt', interrupts: INTERRUPT_CONFORMANCE_BATCH.map(entry => ({ ...entry, reason: 'confirmation' })) },
      } : {}) });
      pause = false;
      return { result: undefined, newMessages: [] };
    },
  };
  let ref = toAgent(source as unknown as AbstractAgent);
  return {
    get agent() { return ref; },
    resume: INTERRUPT_CONFORMANCE_BATCH.map(entry => ({
      interruptId: entry.id, status: 'resolved', payload: { approved: true },
    })),
    requests,
    pause: async () => { pause = true; await ref.submit({}); },
    pendingBatch: () => ref.interruptSession().interrupts.map(entry => ({ id: entry.id, value: (entry as unknown as { value: unknown }).value })),
    failNextDispatch: () => { fail = true; },
    backendCancellationCount: () => 0,
    startLateDelivery: async () => {
      lateGate = new Promise<void>(resolve => { releaseLate = resolve; });
      const started = new Promise<void>(resolve => { startedLate = resolve; });
      lateRun = ref.submit({});
      await started;
    },
    deliverLateEvents: async () => { releaseLate?.(); await lateRun; },
    restore: async () => {
      const records = new Map<string, AgUiThreadRecord>();
      const persistence: AgUiInterruptPersistence = {
        namespace: 'conformance',
        store: {
          async load(key) { return structuredClone(records.get(key) ?? null); },
          async compareAndSwap(key, revision, record) {
            if ((records.get(key)?.revision ?? null) !== revision) return false;
            records.set(key, structuredClone(record));
            return true;
          },
        },
      };
      ref.dispose();
      ref = toAgent(source as unknown as AbstractAgent, { persistence });
      await ref.ready;
      pause = true;
      await ref.submit({});
      expect(records.size).toBe(1);
      ref.dispose();
      const before = requests.length;
      const replacement = { ...source, state: {}, messages: [], pendingInterrupts: [] };
      ref = toAgent(replacement as unknown as AbstractAgent, { persistence });
      await ref.ready;
      expect(requests).toHaveLength(before);
      expect(replacement.pendingInterrupts).toHaveLength(INTERRUPT_CONFORMANCE_BATCH.length);
    },
    cleanup: () => ref.dispose(),
  };
}, { restoration: true });

import {
  REASONING_FIXTURE_EVENTS,
  REASONING_FIXTURE_MESSAGE_ID,
  assertReasoningFixtureMessages,
  type AbstractEvent,
} from '@threadplane/chat/testing';
import { reduceEvent } from './reducer';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { type AgentError } from '@threadplane/chat';
import type { Message, AgentStatus, ToolCall, AgentEvent } from '@threadplane/chat';

function abstractToAgUi(event: AbstractEvent, messageId: string): any {
  switch (event.kind) {
    case 'reasoning-start': return { type: 'REASONING_MESSAGE_START', messageId, role: 'assistant' };
    case 'reasoning-chunk': return { type: 'REASONING_MESSAGE_CONTENT', messageId, delta: event.delta };
    case 'reasoning-end':   return { type: 'REASONING_MESSAGE_END', messageId };
    case 'text-start':      return { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
    case 'text-chunk':      return { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: event.delta };
    case 'text-end':        return { type: 'TEXT_MESSAGE_END', messageId };
  }
}

describe('AG-UI reducer — reasoning-fixture conformance', () => {
  it('produces the expected Message[] from the fixture sequence', () => {
    const store = {
      messages:  signal<Message[]>([]),
      status:    signal<AgentStatus>('idle'),
      isLoading: signal<boolean>(false),
      error:     signal<AgentError | undefined>(undefined),
      toolCalls: signal<ToolCall[]>([]),
      state:     signal<Record<string, unknown>>({}),
      interrupt: signal(undefined),
      events$:   new Subject<AgentEvent>(),
      customEvents: signal([]),
      activities: signal(new Map()),
      deliveryRun: {
        generation: 'reasoning-fixture-run',
        baselineMessageIds: new Set<string>(),
        ownedMessageIds: new Set<string>(),
        snapshotReplacementIds: new Set<string>(),
      },
      allocateDeliveryGeneration: (scope: string) => `reasoning-fixture:${scope}`,
    };
    for (const evt of REASONING_FIXTURE_EVENTS) {
      reduceEvent(abstractToAgUi(evt, REASONING_FIXTURE_MESSAGE_ID), store);
    }
    assertReasoningFixtureMessages(store.messages());
  });
});
