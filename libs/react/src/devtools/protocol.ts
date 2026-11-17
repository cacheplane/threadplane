/**
 * The page side of the Threadplane DevTools wire protocol, shared by the React
 * signals reporter (`@threadplane/react/debug`) and the render report
 * (`@threadplane/react/render`). It mirrors `@threadplane/chat`'s
 * `devtools-emitter.ts` and `devtools-render-report.ts`: the same
 * `threadplane:devtools` `CustomEvent` on `window`, the same report shapes and
 * bounds, and the same `window.__THREADPLANE_DEVTOOLS_DISABLED__` opt-out.
 * Names, keys, states and timing only, never values.
 *
 * Callers gate every use on `process.env.NODE_ENV !== 'production'` written
 * at the call site, so a production bundle folds the branch away and drops
 * this module with it.
 *
 * @internal Not a public API.
 */

/** The `CustomEvent` name both reports are dispatched under. */
export const DEVTOOLS_EVENT = 'threadplane:devtools';

/** The adapters whose signal vocabularies the extension accepts. */
export type DevtoolsAdapter = 'langgraph' | 'ag-ui';

/** One spec element's state in a render report. */
export type RenderElementState = 'mounted' | 'fallback' | 'unresolved' | 'hidden';

/** The signals report: which signals one event wrote. */
export interface SignalsDevtoolsReport {
  v: 1;
  agent: string;
  adapter: DevtoolsAdapter;
  seq: number;
  eventType: string;
  wrote: string[];
  tMs: number;
}

/** The render report: how each element of one rendered surface resolved. */
export interface RenderDevtoolsReport {
  v: 1;
  kind: 'render';
  surface: string;
  seq: number;
  registry: string[];
  elements: { key: string; type: string; state: RenderElementState }[];
  tMs: number;
}

export const MAX_EVENT_TYPE_LENGTH = 128;
export const MAX_RENDER_NAME_LENGTH = 128;
export const MAX_RENDER_REGISTRY = 500;
export const MAX_RENDER_ELEMENTS = 2000;

type DevtoolsWindow = Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

let fallbackAgentId = 0;

/** True when there is a window to report on and the page has not opted out. */
export function devtoolsAvailable(): boolean {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function')
    return false;
  return !optedOut();
}

/** The page's opt-out, read on every dispatch so it can be set at any time. */
export function optedOut(): boolean {
  try {
    return (
      (window as DevtoolsWindow).__THREADPLANE_DEVTOOLS_DISABLED__ === true
    );
  } catch {
    return true;
  }
}

/** Dispatches one report. A throwing listener never reaches the caller. */
export function dispatchDevtoolsReport(
  detail: SignalsDevtoolsReport | RenderDevtoolsReport
): void {
  try {
    window.dispatchEvent(new CustomEvent(DEVTOOLS_EVENT, { detail }));
  } catch {
    // Devtools must never break the agent or surface that reported.
  }
}

/** A random id per reporting agent instance. */
export function newAgentId(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    )
      return crypto.randomUUID();
  } catch {
    // Insecure contexts lack randomUUID; fall through to the counter.
  }
  fallbackAgentId += 1;
  return `agent-${fallbackAgentId}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The clock the extension stamps its own captures with. */
export function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** A non-empty string of at most `max` characters. */
export function fits(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
