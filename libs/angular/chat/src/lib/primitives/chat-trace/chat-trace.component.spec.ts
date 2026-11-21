// libs/angular/chat/src/lib/primitives/chat-trace/chat-trace.component.spec.ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import type { TraceState } from './chat-trace.component';

// Tests verify the signal-computed logic that ChatTraceComponent exposes.
// We cannot use createComponent + setInput for signal inputs under vitest JIT
// (Angular's JIT compiler does not process signal-input metadata, so setInput
// throws NG0303).  Instead we mirror the component's computed logic directly
// inside runInInjectionContext — the same pattern used by chat-typing-indicator
// and chat-timeline specs in this library.

function makeTrace(initialState: TraceState = 'pending', initialDefaultExpanded = false) {
  const state = signal<TraceState>(initialState);
  const defaultExpanded = signal<boolean>(initialDefaultExpanded);
  const expandedOverride = signal<boolean | null>(null);

  const expanded = computed(() => {
    const override = expandedOverride();
    if (override !== null) return override;
    const s = state();
    if (s === 'running' || s === 'error') return true;
    return defaultExpanded();
  });

  const expandedStr = computed(() => String(expanded()));

  function toggle() {
    expandedOverride.set(!expanded());
  }

  function setState(s: TraceState) {
    const prev = state();
    // Mirror the effect logic: clear override when re-entering running/error from a different state
    if ((s === 'running' || s === 'error') && prev && prev !== s) {
      expandedOverride.set(null);
    }
    state.set(s);
  }

  return { state, defaultExpanded, expanded, expandedStr, toggle, setState, expandedOverride };
}

describe('ChatTraceComponent — expanded computed', () => {
  it('is false by default (pending state)', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('pending');
      expect(expanded()).toBe(false);
    });
  });

  it('auto-expands when state is running', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('running');
      expect(expanded()).toBe(true);
    });
  });

  it('is false when state is done', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('done');
      expect(expanded()).toBe(false);
    });
  });

  it('auto-expands when state is error', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('error');
      expect(expanded()).toBe(true);
    });
  });

  it('honors defaultExpanded=true when done', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('done', true);
      expect(expanded()).toBe(true);
    });
  });

  it('defaultExpanded=false keeps done collapsed', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded } = makeTrace('done', false);
      expect(expanded()).toBe(false);
    });
  });
});

describe('ChatTraceComponent — toggle', () => {
  it('flips collapsed to expanded', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded, toggle } = makeTrace('pending');
      expect(expanded()).toBe(false);
      toggle();
      expect(expanded()).toBe(true);
    });
  });

  it('flips expanded to collapsed', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded, toggle } = makeTrace('running');
      expect(expanded()).toBe(true);
      toggle();
      expect(expanded()).toBe(false);
    });
  });
});

describe('ChatTraceComponent — state transitions', () => {
  it('clears manual override and auto-expands when transitioning to running', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded, toggle, setState } = makeTrace('running');
      // Manually collapse while running
      toggle();
      expect(expanded()).toBe(false);
      // Transitioning away from running and back resets the override
      setState('pending');
      setState('running');
      expect(expanded()).toBe(true);
    });
  });

  it('clears manual override and auto-expands when transitioning to error', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expanded, toggle, setState } = makeTrace('running');
      toggle();
      expect(expanded()).toBe(false);
      setState('error');
      expect(expanded()).toBe(true);
    });
  });

  it('done state respects defaultExpanded without timeout', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      // With defaultExpanded=false (default), done stays collapsed — no timeout needed
      const { expanded, setState } = makeTrace('running');
      expect(expanded()).toBe(true);
      setState('done');
      expect(expanded()).toBe(false);
    });
  });

  it('expandedStr reflects expanded as string', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { expandedStr, setState } = makeTrace('pending');
      expect(expandedStr()).toBe('false');
      setState('running');
      expect(expandedStr()).toBe('true');
    });
  });
});
