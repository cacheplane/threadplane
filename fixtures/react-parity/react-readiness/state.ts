import { createRenderState } from '@threadplane/content/render-state';
export const counts = {
  constructed: 0,
  set: 0,
  update: 0,
  dispose: 0,
  registrations: 0,
  cleanups: 0,
  outstanding: 0,
  notifications: 0,
};
function constructOwner() {
  counts.constructed++;
  return createRenderState({
    payload: null,
    label: 'initial',
    show: true,
    rows: [
      { id: 'a', value: 'A' },
      { id: 'b', value: 'B' },
    ],
  });
}
const actual = constructOwner();
const references = new WeakMap<object, number>();
let next = 0;
export function reference(value: object) {
  if (!references.has(value)) references.set(value, ++next);
  return references.get(value)!;
}
// These commands forward to the actual owner. Only application controls import them.
export const owner = {
  set(path: string, value: unknown) {
    counts.set++;
    actual.set(path, value);
  },
  update(values: Readonly<Record<string, unknown>>) {
    counts.update++;
    actual.update(values);
  },
  dispose() {
    counts.dispose++;
    actual.dispose();
  },
};
export const observer = {
  getSnapshot: () => actual.getSnapshot(),
  subscribe(notify: () => void) {
    counts.registrations++;
    counts.outstanding++;
    const release = actual.subscribe(() => {
      counts.notifications++;
      notify();
    });
    let active = true;
    return () => {
      if (active) {
        active = false;
        release();
        counts.cleanups++;
        counts.outstanding--;
      }
    };
  },
};
export const state = {
  step: 0,
  mounted: true,
  observedId: 0,
  predicateCalls: 0,
  suspendedAttempts: 0,
};
export function evidence() {
  return {
    ...counts,
    ...state,
    snapshot: actual.getSnapshot(),
    snapshotId: reference(actual.getSnapshot()),
  };
}
declare global {
  interface Window {
    __readiness: typeof evidence;
  }
}
window.__readiness = evidence;
