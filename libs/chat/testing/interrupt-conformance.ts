import { describe, expect, it } from 'vitest';
import type { Agent, AgentSubmitInput } from '@threadplane/chat';

/** The two approval interrupts adapters must preserve throughout the shared interrupt conformance scenarios. */
export const INTERRUPT_CONFORMANCE_BATCH = [
  { id: 'approval-a', value: { question: 'Approve A?' } },
  { id: 'approval-b', value: { question: 'Approve B?' } },
];

/** Semantic view of a native request; adapters retain responsibility for wire assertions. */
export interface InterruptConformanceRequest {
  resume: unknown;
  state: Record<string, unknown>;
  messages: string[];
}

/** Opt-in harness: pause and failure must be driven through the real adapter. */
export interface InterruptConformanceHarness {
  agent: Agent;
  /** Native decision addressing every interrupt in the fixture batch. */
  resume: unknown;
  pause(): Promise<void>;
  pendingBatch(): Array<{ id: string; value: unknown }>;
  failNextDispatch(): void;
  requests: InterruptConformanceRequest[];
  backendCancellationCount(): number;
  /** Start a native run and hold its delivery until deliverLateEvents is called. */
  startLateDelivery(): Promise<void>;
  /** Release captured native callbacks/events, even after cleanup. */
  deliverLateEvents(): Promise<void>;
  cleanup(): void | Promise<void>;
  /** Optional backend history/store restoration; never synthesizes a local pause. */
  restore?: () => Promise<void>;
}

/** Separate from base conformance so agents without interrupts remain supported. */
export function runInterruptConformance(
  label: string,
  factory: () => InterruptConformanceHarness,
  options: { restoration?: boolean } = {},
): void {
  describe(`${label} — interrupt conformance`, () => {
    for (const [name, scenario] of interruptConformanceScenarios(factory, options)) {
      it(name, scenario);
    }
  });
}

/** @internal Exposed here to verify the suite rejects nonconforming harnesses. */
export function interruptConformanceScenarios(
  factory: () => InterruptConformanceHarness,
  options: { restoration?: boolean } = {},
): Map<string, () => Promise<void>> {
    const scenarios = new Map<string, () => Promise<void>>();
    const register = (name: string, scenario: () => Promise<void>) => scenarios.set(name, scenario);
    const withHarness = async (test: (h: InterruptConformanceHarness) => Promise<void>) => {
      const h = factory();
      try { await test(h); } finally { await h.cleanup(); }
    };

    register('exposes the complete paused batch while remaining idle', () => withHarness(async h => {
      await h.pause();
      expect(h.agent.interrupt?.()?.resumable).toBe(true);
      expect(h.agent.status()).toBe('idle');
      expect(h.agent.isLoading()).toBe(false);
      expect(h.pendingBatch()).toEqual(INTERRUPT_CONFORMANCE_BATCH);
    }));

    register('forwards resume, state and message together', () => withHarness(async h => {
      await h.pause();
      const input = combinedInput(h.resume);
      await h.agent.submit(input);
      expect(h.requests.at(-1)).toEqual({
        resume: input.resume, state: input.state, messages: [input.message],
      });
    }));

    for (const combined of [false, true]) {
      register(`intentionally retries a failed ${combined ? 'combined' : 'resume-only'} dispatch unchanged`, () => withHarness(async h => {
        await h.pause();
        const input: AgentSubmitInput = combined ? combinedInput(h.resume) : { resume: h.resume };
        const before = h.requests.length;
        h.failNextDispatch();
        await h.agent.submit(input).catch(() => undefined);
        expect(h.agent.error()).toBeDefined();
        expect(h.requests).toHaveLength(before + 1);
        const failed = h.requests.at(-1);
        await h.agent.retry();
        expect(h.requests).toHaveLength(before + 2);
        expect(h.requests.at(-1)).toEqual(failed);
        expect(h.requests.at(-1)).toEqual({
          resume: input.resume,
          state: input.state ?? {},
          messages: combined ? [input.message] : [],
        });
        expect(h.agent.error()).toBeUndefined();
        expect(h.agent.isLoading()).toBe(false);
      }));
    }

    register('stops local work without cancelling the backend pause', () => withHarness(async h => {
      await h.pause();
      const before = h.backendCancellationCount();
      await h.agent.stop();
      expect(h.backendCancellationCount()).toBe(before);
      expect(h.pendingBatch()).toEqual(INTERRUPT_CONFORMANCE_BATCH);
    }));

    register('applies captured delivery while the agent is live', () => withHarness(async h => {
      await h.startLateDelivery();
      const before = snapshot(h);
      await h.deliverLateEvents();
      expect(snapshot(h)).not.toEqual(before);
    }));

    register('ignores captured delivery after disposal', () => withHarness(async h => {
      await h.startLateDelivery();
      await h.cleanup();
      const disposed = snapshot(h);
      await h.deliverLateEvents();
      expect(snapshot(h)).toEqual(disposed);
    }));

    if (options.restoration) {
      register('restores the complete pause from backend history', () => withHarness(async h => {
        expect(h.restore).toBeTypeOf('function');
        if (!h.restore) throw new Error('Restoration harness is required');
        await h.restore();
        expect(h.pendingBatch()).toEqual(INTERRUPT_CONFORMANCE_BATCH);
        expect(h.agent.interrupt?.()?.resumable).toBe(true);
      }));
    }
    return scenarios;
}

function combinedInput(resume: unknown) {
  return { resume, state: { reviewer: 'Ada' }, message: 'Approved, continue' };
}

function snapshot(h: InterruptConformanceHarness) {
  return structuredClone({
    state: h.agent.state(), messages: h.agent.messages(),
    interrupt: h.agent.interrupt?.(), batch: h.pendingBatch(),
  });
}
