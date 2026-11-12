import { createSurfaceState, surfaceSnapshot, transition } from './transition.js';
import type { SurfaceState } from './transition.js';
import type { A2uiMessage } from '@threadplane/a2ui';
import type { A2uiSurfaces, A2uiValue } from './types.js';

function at(model: A2uiValue, path: string): { found: boolean; value: A2uiValue } {
  let value = model;
  for (const key of path.split('/').filter(Boolean)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      return { found: false, value: undefined };
    value = (value as Record<string, A2uiValue>)[key];
  }
  return { found: true, value };
}

/** A rewrite of the same primitive, or a delete of something absent, changes nothing worth publishing. */
function unchanged(before: A2uiValue, after: A2uiValue, path: string): boolean {
  const prior = at(before, path), next = at(after, path);
  if (prior.found !== next.found) return false;
  if (!next.found) return true;
  return (next.value === null || typeof next.value !== 'object') && Object.is(prior.value, next.value);
}

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
    setValue(surfaceId, path, value) {
      const current = assertActive();
      if (typeof path !== 'string' || !path.startsWith('/') || !path.split('/').some(Boolean))
        throw new TypeError('A local A2UI edit needs a path below the data model root');
      const surface = current.live.get(surfaceId);
      if (!surface) return false;
      const next = transition(current, {
        version: 'v0.9', updateDataModel: { surfaceId, path, value },
      } as A2uiMessage);
      // Structural sharing keeps the model's identity when a primitive is rewritten unchanged.
      if (unchanged(surface.dataModel, next.state.live.get(surfaceId)?.dataModel, path)) return false;
      state = next.state;
      snapshot = surfaceSnapshot(state);
      publish();
      return true;
    },
    dispose() {
      disposed = true;
      dirty = false;
      registrations.clear();
      state = null;
    },
  };
}
