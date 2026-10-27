import { createSurfaceState, surfaceSnapshot, transition } from './transition.js';
import type { SurfaceState } from './transition.js';
import type { A2uiSurfaces } from './types.js';

/** Create an application-owned accumulator for already parsed A2UI envelopes.
 * Observation borrows the owner; only its creator should dispose it. */
export function createA2uiSurfaces(): A2uiSurfaces {
  let state: SurfaceState | null = createSurfaceState();
  let snapshot = surfaceSnapshot(state);
  let disposed = false, notifying = false, dirty = false;
  const registrations = new Set<{ notify: () => void }>();

  function assertActive(): SurfaceState {
    if (disposed || !state) throw new Error('A2UI surfaces owner is disposed');
    return state;
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

  return {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      if (disposed) return () => undefined;
      const registration = { notify };
      registrations.add(registration);
      return () => { registrations.delete(registration); };
    },
    apply(message) {
      const next = transition(assertActive(), message);
      assertActive();
      state = next.state;
      if (!next.publish) return;
      snapshot = surfaceSnapshot(state);
      publish();
    },
    dispose() {
      disposed = true;
      dirty = false;
      registrations.clear();
      state = null;
    },
  };
}
