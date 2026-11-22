import { signal } from '@angular/core';
import type { StateStore, StateModel } from '@json-render/core';

/**
 * Split a JSON Pointer into its unescaped segments.
 *
 * `''` and `'/'` both address the root. Anything else must start with `/`:
 * a slash-less path is rejected rather than silently reinterpreted, because
 * dropping its first segment would make `set('count', 1)` replace the whole
 * state model — silent data loss that is far worse than a thrown error.
 */
function parsePointer(path: string): string[] {
  if (path === '' || path === '/') return [];
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(
      `Invalid state path ${JSON.stringify(path)}: a state store path is a JSON Pointer and needs a leading "/" ` +
        `(write "/${String(path)}" to address that key, or "" for the root).`,
    );
  }
  return path
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getByPath(obj: unknown, segments: string[]): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function setByPath(obj: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;

  if (Array.isArray(obj)) {
    const index = Number(head);
    const clone = [...obj];
    clone[index] = setByPath(clone[index], rest, value);
    return clone;
  }

  const record = (obj != null && typeof obj === 'object')
    ? { ...obj as Record<string, unknown> }
    : {} as Record<string, unknown>;
  record[head] = setByPath(record[head], rest, value);
  return record;
}

/** The path and value of the mutation that most recently notified subscribers. */
export interface StateChangeRecord {
  /** The JSON Pointer that was written. */
  readonly path: string;
  /** The value written at that pointer. */
  readonly value: unknown;
}

/**
 * The `StateStore` that {@link signalStateStore} returns.
 *
 * Adds `lastChange()` on top of the `@json-render/core` interface, which is
 * how `<render-spec>` reports the mutated path on a `stateChange` render
 * event — `StateStore.subscribe` itself carries no path. A store from any
 * other implementation simply omits the member.
 */
export interface SignalStateStore extends StateStore {
  /**
   * The path and value of the most recent mutation, or `undefined` before the
   * first one. Written before subscribers are notified, so a subscriber can
   * read it to learn what changed.
   */
  lastChange?: () => StateChangeRecord | undefined;
}

/**
 * Create a signal-backed `StateStore` for a generative-UI surface —
 * holds the bound state that spec `$bindState` paths read and interactive
 * elements write, with path-addressable get/set and change subscriptions.
 *
 * Every path is a JSON Pointer and must start with `/` (or be `''` / `'/'`
 * for the root); a slash-less path throws.
 *
 * @param initialState - Optional starting state object.
 * @returns A {@link SignalStateStore} bridging Angular signals to the render engine.
 * @example
 * ```ts
 * const store = signalStateStore({ count: 0 });
 * store.set('/count', 1);
 * store.lastChange?.(); // { path: '/count', value: 1 }
 * ```
 */
export function signalStateStore(initialState: StateModel = {}): SignalStateStore {
  const state = signal<StateModel>(initialState);
  const listeners = new Set<() => void>();
  let lastChange: StateChangeRecord | undefined;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    get(path: string): unknown {
      return getByPath(state(), parsePointer(path));
    },
    set(path: string, value: unknown): void {
      const segments = parsePointer(path);
      const current = getByPath(state(), segments);
      if (current === value) return;
      state.set(setByPath(state(), segments, value) as StateModel);
      lastChange = { path, value };
      notify();
    },
    update(updates: Record<string, unknown>): void {
      let current = state();
      let applied: StateChangeRecord | undefined;
      for (const [path, value] of Object.entries(updates)) {
        const segments = parsePointer(path);
        const existing = getByPath(current, segments);
        if (existing !== value) {
          current = setByPath(current, segments, value) as StateModel;
          applied = { path, value };
        }
      }
      if (applied) {
        state.set(current);
        lastChange = applied;
        notify();
      }
    },
    getSnapshot(): StateModel {
      return state();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastChange(): StateChangeRecord | undefined {
      return lastChange;
    },
  };
}
