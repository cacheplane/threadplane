import { isDevMode } from '@angular/core';
declare const ngDevMode: boolean;

/** The adapters that report. */
export type DevtoolsAdapter = 'langgraph' | 'ag-ui';

/**
 * The closed signal vocabulary per adapter. A consumer (the AG-UI DevTools
 * extension) rejects a report naming anything else, so the emitter enforces
 * the same lists rather than trusting every call site.
 */
export const LANGGRAPH_DEVTOOLS_SIGNALS = [
  'status', 'values', 'messages', 'error', 'interrupt', 'interrupts', 'branch', 'history',
  'isThreadLoading', 'toolProgress', 'toolCalls', 'messageMetadata', 'subagents', 'queue', 'custom',
] as const;
export const AG_UI_DEVTOOLS_SIGNALS = [
  'messages', 'status', 'isLoading', 'error', 'toolCalls', 'state', 'interrupt',
  'customEvents', 'activities', 'interruptSession',
] as const;

export type LangGraphDevtoolsSignal = (typeof LANGGRAPH_DEVTOOLS_SIGNALS)[number];
export type AgUiDevtoolsSignal = (typeof AG_UI_DEVTOOLS_SIGNALS)[number];

/** Labels for writes that no protocol event caused. */
export type DevtoolsPseudoEvent = 'run:start' | 'run:end' | 'history' | 'reset' | 'submit' | 'queue' | 'branch';

/**
 * Per-agent recorder of which signals each event wrote. Brackets nest: a
 * bracket opened while another is open joins the outer report, so helpers can
 * bracket themselves without splitting the event that called them. A write
 * outside any bracket is not reported.
 */
export interface DevtoolsEmitter<Name extends string = string> {
  /** Opens a report for a protocol event. */
  begin(eventType: string): void;
  /** Records that the open report wrote `name`. Never receives the value. */
  wrote(name: Name): void;
  /** Closes the report opened by the matching `begin` and dispatches it if anything was written. */
  end(): void;
  /** Runs `run` inside a report labelled with a pseudo-event, returning its result. */
  outside<R>(label: DevtoolsPseudoEvent, run: () => R): R;
}

type EmitterFor<A extends DevtoolsAdapter> = DevtoolsEmitter<
  A extends 'langgraph' ? LangGraphDevtoolsSignal : AgUiDevtoolsSignal
>;

type DevtoolsWindow = Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

const MAX_EVENT_TYPE_LENGTH = 128;
let fallbackAgentId = 0;

/**
 * Creates the development-only devtools emitter for one agent instance, or
 * `null` in production builds, outside a browser, or when the page set
 * `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true`.
 *
 * Each closed report is dispatched on `window` as a `threadplane:devtools`
 * `CustomEvent` whose detail is `{ v, agent, adapter, seq, eventType, wrote, tMs }`
 * — signal names and timing only, never signal values.
 *
 * @internal Adapter seam for `@threadplane/langgraph` and `@threadplane/ag-ui`; not a public API.
 */
export function ɵcreateDevtoolsEmitter<A extends DevtoolsAdapter>(adapter: A): EmitterFor<A> | null {
  // Production builds define ngDevMode as false, which folds this branch away
  // and with it every trace of the emitter (see scripts/verify-devtools-bundle.mjs).
  if ((typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode()) {
    return createDevelopmentEmitter(adapter) as EmitterFor<A> | null;
  }
  return null;
}

function createDevelopmentEmitter(adapter: DevtoolsAdapter): DevtoolsEmitter | null {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return null;
  if (optedOut()) return null;

  const vocabulary: ReadonlySet<string> = new Set<string>(
    adapter === 'langgraph' ? LANGGRAPH_DEVTOOLS_SIGNALS : AG_UI_DEVTOOLS_SIGNALS,
  );
  const agent = newAgentId();
  let seq = 0;
  let depth = 0;
  let eventType = '';
  let startedAt = 0;
  let written: string[] = [];

  const begin = (type: string): void => {
    if (depth++ > 0) return;
    eventType = typeof type === 'string' ? type.slice(0, MAX_EVENT_TYPE_LENGTH) : '';
    startedAt = now();
    written = [];
  };

  const end = (): void => {
    if (depth === 0) return;
    if (--depth > 0) return;
    const names = written;
    written = [];
    // An event that wrote nothing is not worth a report; the page also learns
    // nothing about listeners either way, since dispatch has no reply.
    if (names.length === 0 || optedOut()) return;
    seq += 1;
    const detail = { v: 1 as const, agent, adapter, seq, eventType, wrote: names, tMs: startedAt };
    try {
      window.dispatchEvent(new CustomEvent('threadplane:devtools', { detail }));
    } catch {
      // A throwing listener must never break the agent that reported.
    }
  };

  return {
    begin,
    end,
    wrote(name: string): void {
      if (depth === 0 || !vocabulary.has(name) || written.includes(name)) return;
      written.push(name);
    },
    outside<R>(label: DevtoolsPseudoEvent, run: () => R): R {
      begin(label);
      try {
        return run();
      } finally {
        end();
      }
    },
  };
}

function optedOut(): boolean {
  try {
    return (window as DevtoolsWindow).__THREADPLANE_DEVTOOLS_DISABLED__ === true;
  } catch {
    return true;
  }
}

function newAgentId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Insecure contexts lack randomUUID; fall through to the counter.
  }
  fallbackAgentId += 1;
  return `agent-${fallbackAgentId}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
