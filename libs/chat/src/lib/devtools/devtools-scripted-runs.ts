import { isDevMode } from '@angular/core';
import type { DevtoolsAdapter } from './devtools-emitter';
declare const ngDevMode: boolean;

/**
 * One scripted LangGraph run: the SSE frames the transport would have read,
 * each `{ event, data }` exactly as the LangGraph SDK yields it. The adapter
 * normalizes them with the same function the real transport uses.
 */
export interface LangGraphScriptedRun {
  frames: { event: string; data: unknown }[];
}

/** One scripted AG-UI run: the protocol events the source agent would have emitted. */
export interface AgUiScriptedRun {
  events: { type: string; [key: string]: unknown }[];
}

export type ScriptedRunFor<A extends DevtoolsAdapter> = A extends 'langgraph' ? LangGraphScriptedRun : AgUiScriptedRun;

/** `threadplane:devtools:arm` detail. */
export interface DevtoolsArmCommand {
  v: 1;
  armId: string;
  adapter: DevtoolsAdapter;
  runs: LangGraphScriptedRun[] | AgUiScriptedRun[];
}

/** `threadplane:devtools:disarm` detail. */
export interface DevtoolsDisarmCommand {
  v: 1;
  armId: string;
}

export type DevtoolsAckState = 'armed' | 'consumed' | 'expired' | 'disarmed' | 'rejected';

/** `threadplane:devtools:ack` detail. `run` is the 0-based index into the arm's `runs`. */
export interface DevtoolsAck {
  v: 1;
  armId: string;
  state: DevtoolsAckState;
  run?: number;
  reason?: string;
}

/**
 * The scripted runs armed for one adapter. An adapter asks at the point it
 * would open a stream; a non-null answer replaces the network for that run.
 */
export interface DevtoolsScriptedRuns<A extends DevtoolsAdapter = DevtoolsAdapter> {
  /** Takes the next armed run for this adapter and acknowledges it `consumed`, or returns null. */
  take(): ScriptedRunFor<A> | null;
}

/** Time source for expiry. Injectable so tests need not wait ten minutes. */
export interface ScriptedRunClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const ARM_EVENT = 'threadplane:devtools:arm';
export const DISARM_EVENT = 'threadplane:devtools:disarm';
export const ACK_EVENT = 'threadplane:devtools:ack';

export const SCRIPTED_RUN_LIMITS = {
  /** Runs per arm. */
  runs: 8,
  /** Frames (LangGraph) or events (AG-UI) per run. */
  itemsPerRun: 5_000,
  /** UTF-8 bytes of the arm's JSON serialization. */
  bytes: 2 * 1024 * 1024,
  /** An arm not fully consumed by then is dropped and acknowledged `expired`. */
  ttlMs: 10 * 60 * 1000,
  /** Longest accepted armId. */
  armIdLength: 128,
  /** Longest accepted frame `event` / event `type`. */
  typeLength: 256,
} as const;

type DevtoolsWindow = Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

const ADAPTERS: readonly DevtoolsAdapter[] = ['langgraph', 'ag-ui'];

interface PendingArm {
  armId: string;
  runs: (LangGraphScriptedRun | AgUiScriptedRun)[];
  next: number;
  expiresAt: number;
  timer: unknown;
}

/**
 * The page-wide store of armed runs: at most one pending arm per adapter.
 * Listens for arm and disarm commands on `target` and answers each with acks.
 *
 * @internal Exported for tests; adapters use {@link ɵdevtoolsScriptedRuns}.
 */
export interface ScriptedRunStore {
  take(adapter: DevtoolsAdapter): LangGraphScriptedRun | AgUiScriptedRun | null;
  /** Removes the listeners and drops every pending arm without acknowledging it. */
  dispose(): void;
}

/** @internal */
export function createScriptedRunStore(target: Window, clock: ScriptedRunClock = defaultClock): ScriptedRunStore {
  const pending = new Map<DevtoolsAdapter, PendingArm>();

  const ack = (detail: DevtoolsAck): void => {
    try {
      target.dispatchEvent(new CustomEvent(ACK_EVENT, { detail }));
    } catch {
      // A throwing listener must never break the agent that acknowledged.
    }
  };

  const drop = (adapter: DevtoolsAdapter): PendingArm | undefined => {
    const arm = pending.get(adapter);
    if (!arm) return undefined;
    pending.delete(adapter);
    clock.clearTimeout(arm.timer);
    return arm;
  };

  const expire = (adapter: DevtoolsAdapter, arm: PendingArm): void => {
    if (pending.get(adapter) !== arm) return;
    drop(adapter);
    ack({ v: 1, armId: arm.armId, state: 'expired' });
  };

  const onArm = (event: Event): void => {
    if (optedOut(target)) return;
    const detail = (event as CustomEvent<unknown>).detail;
    const armId = readArmId(detail);
    // Without an id there is nothing to correlate an answer with.
    if (armId === null) return;
    const parsed = parseArm(detail);
    if (typeof parsed === 'string') {
      ack({ v: 1, armId, state: 'rejected', reason: parsed });
      return;
    }
    const replaced = drop(parsed.adapter);
    if (replaced) ack({ v: 1, armId: replaced.armId, state: 'disarmed' });
    const arm: PendingArm = {
      armId,
      runs: parsed.runs,
      next: 0,
      expiresAt: clock.now() + SCRIPTED_RUN_LIMITS.ttlMs,
      timer: undefined,
    };
    arm.timer = clock.setTimeout(() => expire(parsed.adapter, arm), SCRIPTED_RUN_LIMITS.ttlMs);
    pending.set(parsed.adapter, arm);
    ack({ v: 1, armId, state: 'armed' });
  };

  const onDisarm = (event: Event): void => {
    if (optedOut(target)) return;
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail) || readOwn(detail, 'v') !== 1) return;
    const armId = readArmId(detail);
    if (armId === null) return;
    for (const [adapter, arm] of pending) {
      if (arm.armId !== armId) continue;
      drop(adapter);
      ack({ v: 1, armId, state: 'disarmed' });
      return;
    }
    // Unknown, already consumed or already expired: its last ack stands.
  };

  target.addEventListener(ARM_EVENT, onArm);
  target.addEventListener(DISARM_EVENT, onDisarm);

  return {
    take(adapter) {
      const arm = pending.get(adapter);
      if (!arm || optedOut(target)) return null;
      if (clock.now() >= arm.expiresAt) {
        // The timer can lag (a throttled background tab); the deadline cannot.
        expire(adapter, arm);
        return null;
      }
      const index = arm.next++;
      const run = arm.runs[index];
      if (arm.next >= arm.runs.length) drop(adapter);
      ack({ v: 1, armId: arm.armId, state: 'consumed', run: index });
      return run;
    },
    dispose() {
      target.removeEventListener(ARM_EVENT, onArm);
      target.removeEventListener(DISARM_EVENT, onDisarm);
      for (const adapter of [...pending.keys()]) drop(adapter);
    },
  };
}

let pageStore: ScriptedRunStore | null = null;

/**
 * The development-only scripted-run source for one adapter, or `null` in
 * production builds, outside a browser, or when the page set
 * `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true` — the same gate as
 * {@link ɵcreateDevtoolsEmitter}.
 *
 * The first call on a page installs the `threadplane:devtools:arm` and
 * `threadplane:devtools:disarm` listeners; nothing listens before an agent
 * exists, and nothing ever listens in production.
 *
 * @internal Adapter seam for `@threadplane/langgraph` and `@threadplane/ag-ui`; not a public API.
 */
export function ɵdevtoolsScriptedRuns<A extends DevtoolsAdapter>(adapter: A): DevtoolsScriptedRuns<A> | null {
  // Production builds define ngDevMode as false, which folds this branch away
  // and with it the listeners and their event names (see scripts/verify-devtools-bundle.mjs).
  if ((typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode()) {
    return developmentScriptedRuns(adapter) as DevtoolsScriptedRuns<A> | null;
  }
  return null;
}

function developmentScriptedRuns(adapter: DevtoolsAdapter): DevtoolsScriptedRuns | null {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return null;
  if (optedOut(window)) return null;
  const store = (pageStore ??= createScriptedRunStore(window));
  return { take: () => store.take(adapter) as never };
}

/**
 * Validates an arm and returns a detached JSON copy of it, or the reason it is
 * rejected. Cheap structural limits come first so a hostile detail is never
 * serialized whole.
 */
function parseArm(detail: unknown): { adapter: DevtoolsAdapter; runs: (LangGraphScriptedRun | AgUiScriptedRun)[] } | string {
  try {
    if (!isRecord(detail)) return 'arm must be an object';
    if (readOwn(detail, 'v') !== 1) return 'unsupported version';
    const adapter = readOwn(detail, 'adapter');
    if (!ADAPTERS.includes(adapter as DevtoolsAdapter)) return 'unknown adapter';
    const runs = readOwn(detail, 'runs');
    if (!Array.isArray(runs) || runs.length === 0 || runs.length > SCRIPTED_RUN_LIMITS.runs) {
      return `runs must list 1 to ${SCRIPTED_RUN_LIMITS.runs} runs`;
    }
    const key = adapter === 'langgraph' ? 'frames' : 'events';
    for (let i = 0; i < runs.length; i++) {
      const items = isRecord(runs[i]) ? readOwn(runs[i] as Record<string, unknown>, key) : undefined;
      if (!Array.isArray(items)) return `run ${i} has no ${key} list`;
      if (items.length > SCRIPTED_RUN_LIMITS.itemsPerRun) {
        return `run ${i} has more than ${SCRIPTED_RUN_LIMITS.itemsPerRun} ${key}`;
      }
    }

    let json: string | undefined;
    try {
      json = JSON.stringify({ runs });
    } catch {
      return 'arm is not serializable';
    }
    if (typeof json !== 'string') return 'arm is not serializable';
    if (utf8Length(json) > SCRIPTED_RUN_LIMITS.bytes) return 'arm exceeds 2 MB';
    const copy = (JSON.parse(json) as { runs: Record<string, unknown>[] }).runs;

    for (let i = 0; i < copy.length; i++) {
      const items = copy[i][key] as unknown[];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        if (!isRecord(item)) return `run ${i} ${key.slice(0, -1)} ${j} is not an object`;
        const type = adapter === 'langgraph' ? item['event'] : item['type'];
        if (typeof type !== 'string' || type.length === 0 || type.length > SCRIPTED_RUN_LIMITS.typeLength) {
          return `run ${i} ${key.slice(0, -1)} ${j} has no ${adapter === 'langgraph' ? 'event' : 'type'}`;
        }
      }
    }
    const runsCopy = adapter === 'langgraph'
      ? copy.map(run => ({
          frames: (run['frames'] as Record<string, unknown>[]).map(frame => ({ event: frame['event'] as string, data: frame['data'] })),
        }))
      : copy.map(run => ({ events: run['events'] as AgUiScriptedRun['events'] }));
    return { adapter: adapter as DevtoolsAdapter, runs: runsCopy };
  } catch {
    // A getter or proxy that throws is a malformed arm, not a crash.
    return 'arm is malformed';
  }
}

function readArmId(detail: unknown): string | null {
  try {
    if (!isRecord(detail)) return null;
    const armId = readOwn(detail, 'armId');
    return typeof armId === 'string' && armId.length > 0 && armId.length <= SCRIPTED_RUN_LIMITS.armIdLength ? armId : null;
  } catch {
    return null;
  }
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8Length(text: string): number {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  // Upper bound without an encoder: no UTF-16 code unit takes more than 3 bytes.
  return text.length * 3;
}

function optedOut(target: Window): boolean {
  try {
    return (target as DevtoolsWindow).__THREADPLANE_DEVTOOLS_DISABLED__ === true;
  } catch {
    return true;
  }
}

const defaultClock: ScriptedRunClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
