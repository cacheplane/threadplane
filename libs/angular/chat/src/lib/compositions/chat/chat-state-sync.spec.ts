/**
 * Tests for the agent.state() → render store sync effect in ChatComponent.
 *
 * AG-UI delivers backend state via STATE_SNAPSHOT / STATE_DELTA events.
 * The AG-UI reducer writes them to agent.state(). The chat composition must
 * mirror that signal into the signalStateStore so json-render specs bound via
 * $state JSON-pointer paths resolve correctly.
 *
 * Test approach: instantiate the real ChatComponent inside runInInjectionContext,
 * set signal inputs via the SIGNAL writer (the same pattern used by the existing
 * "welcome branch" and "showModelPicker" tests), then read the real
 * resolvedStore() after flushing effects. This exercises the actual effect
 * wired in the constructor — not a re-implementation — so the test fails when
 * the effect is absent and passes once it is present.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Injector, runInInjectionContext } from '@angular/core';
import { views } from '@threadplane/angular/render';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { ChatComponent } from './chat.component';

// ── helper: write into an InputSignal by reaching its SIGNAL node ───────────
// Same pattern as the "welcome branch" and "showModelPicker" tests above.
function setSignalInput<T>(sig: unknown, value: T): void {
  const obj = sig as Record<symbol, unknown>;
  const signalSymbol = Object.getOwnPropertySymbols(obj).find(
    (s) => s.description === 'SIGNAL',
  );
  if (!signalSymbol) throw new Error('Could not find SIGNAL symbol on input');
  const node = obj[signalSymbol] as {
    applyValueToInputSignal?: (n: unknown, v: T) => void;
    value?: T;
  };
  if (typeof node.applyValueToInputSignal === 'function') {
    node.applyValueToInputSignal(node, value);
  } else {
    node.value = value;
  }
}

// A minimal views registry — the content doesn't matter; its mere presence
// makes resolvedStore() return the component's internal signalStateStore.
const testViews = views({});

describe('ChatComponent — agent state → render store sync', () => {
  let agent: MockAgent;
  let injector: Injector;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChatComponent] });
    agent = mockAgent();
    injector = TestBed.inject(Injector);
  });

  it('maps top-level state keys as JSON-pointer paths into the render store', () => {
    runInInjectionContext(injector, () => {
      const comp = new ChatComponent();
      // Set the required [agent] input and optional [views] so resolvedStore()
      // returns the internal signalStateStore (not undefined).
      setSignalInput(comp.agent, agent);
      setSignalInput(comp.views, testViews);

      // Confirm the store is active before driving state.
      const store = comp.resolvedStore();
      expect(store).toBeTruthy();

      // Drive a STATE_SNAPSHOT via the agent state signal.
      agent.state.set({
        on_time: { value: 94.2, delta: '+1.1' },
        messages: [{ role: 'assistant', content: 'hello' }],
      });

      // Flush all pending effects (including the state→store sync effect).
      TestBed.flushEffects();

      // Core assertion: pointer paths under /on_time are present in the store.
      expect(store!.get('/on_time/value')).toBe(94.2);
      expect(store!.get('/on_time/delta')).toBe('+1.1');

      // messages must be excluded — it's large and meaningless to the render store.
      expect(store!.get('/messages')).toBeUndefined();
    });
  });

  it('updates the store reactively when state changes a second time (STATE_DELTA)', () => {
    runInInjectionContext(injector, () => {
      const comp = new ChatComponent();
      setSignalInput(comp.agent, agent);
      setSignalInput(comp.views, testViews);
      const store = comp.resolvedStore()!;

      agent.state.set({ on_time: { value: 90.0, delta: '-2.0' } });
      TestBed.flushEffects();
      expect(store.get('/on_time/value')).toBe(90.0);

      // Second update — simulates a STATE_DELTA arriving.
      agent.state.set({ on_time: { value: 91.5, delta: '+1.5' } });
      TestBed.flushEffects();
      expect(store.get('/on_time/value')).toBe(91.5);
      expect(store.get('/on_time/delta')).toBe('+1.5');
    });
  });

  it('is a no-op while the agent holds no state (a session that reports none)', () => {
    runInInjectionContext(injector, () => {
      const comp = new ChatComponent();
      // `state()` is undefined until the backend reports a state, and always
      // on a session that holds none.
      expect(agent.state()).toBeUndefined();
      setSignalInput(comp.agent, agent);
      setSignalInput(comp.views, testViews);
      const store = comp.resolvedStore()!;

      TestBed.flushEffects();
      // Store must remain empty — no writes from a stateless agent.
      expect(store.getSnapshot()).toEqual({});
    });
  });

  it('is a no-op when no views are bound (resolvedStore returns undefined)', () => {
    runInInjectionContext(injector, () => {
      const comp = new ChatComponent();
      // Only set [agent]; no [views] → resolvedStore() returns undefined.
      setSignalInput(comp.agent, agent);

      agent.state.set({ on_time: { value: 99 } });
      TestBed.flushEffects();

      // resolvedStore is undefined — no crash, no store to read.
      expect(comp.resolvedStore()).toBeUndefined();
    });
  });
});
