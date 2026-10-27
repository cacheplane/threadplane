import { captureRecord, captureValue, isRecord } from './owned-value.js';
import { applyPointer, parsePointer, readPointer } from './pointer.js';
import type { RenderState, RenderStateChange, RenderStateValue } from './types.js';

/** An application owns commands and disposal; observers only borrow this owner. */
export function createRenderState(initialState: Readonly<Record<string, unknown>> = {}): RenderState {
  let snapshot = captureRecord(initialState);
  let change: RenderStateChange | undefined;
  let disposed = false, notifying = false, dirty = false;
  const registrations = new Set<{ notify: () => void }>();

  function assertActive(): void {
    if (disposed) throw new Error('Render-state owner is disposed');
  }

  function publish(): void {
    dirty = true;
    if (notifying) return;
    notifying = true;
    try {
      while (dirty && !disposed) {
        dirty = false;
        for (const registration of [...registrations]) {
          if (disposed) break;
          if (!registrations.has(registration)) continue;
          try {
            registration.notify();
          } catch {
            /* An observer cannot reject an accepted update. */
          }
        }
      }
    } finally {
      notifying = false;
    }
  }

  function prepare(path: string, original: unknown) {
    const segments = parsePointer(path);
    const owned = segments.length === 0 ? captureRecord(original) : captureValue(original);
    return { path, segments, original, owned };
  }

  function commit(writes: readonly { path: string; segments: readonly string[]; original: unknown; owned: RenderStateValue }[]): void {
    let working = snapshot;
    let finalChange: RenderStateChange | undefined;
    for (const write of writes) {
      // Preserve caller identity independently of capture; compare against ordered working data.
      if (readPointer(working, write.segments) === write.original) continue;
      working = applyPointer(working, write.segments, write.owned);
      finalChange = Object.freeze({ path: write.path, value: write.owned });
    }
    if (!finalChange) return;
    snapshot = working;
    change = finalChange;
    publish();
  }

  return {
    getSnapshot: () => snapshot,
    get: path => readPointer(snapshot, parsePointer(path)),
    lastChange: () => change,
    set(path, value) {
      assertActive();
      commit([prepare(path, value)]);
    },
    update(updates) {
      assertActive();
      if (!isRecord(updates)) throw new TypeError('Render-state updates must be a plain record');
      const descriptors = Object.getOwnPropertyDescriptors(updates);
      // Inspect the whole descriptor model before consuming any values.
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') throw new TypeError('Symbol render-state update keys are unsupported');
        if (!Object.hasOwn(descriptors[key], 'value')) throw new TypeError('Render-state update accessors are unsupported');
      }
      const writes = Object.keys(descriptors)
        .filter(path => descriptors[path].enumerable)
        .map(path => prepare(path, descriptors[path].value));
      commit(writes);
    },
    subscribe(notify) {
      if (disposed) return () => undefined;
      const registration = { notify };
      registrations.add(registration);
      return () => { registrations.delete(registration); };
    },
    dispose() {
      disposed = true;
      dirty = false;
      registrations.clear();
    },
  };
}
