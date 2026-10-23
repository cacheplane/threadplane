import {
  createA2uiSurfaces,
  type A2uiSurfacesSnapshot,
} from '@threadplane/content/a2ui';
import type { A2uiMessage } from '@threadplane/a2ui';

type Framework = 'react' | 'angular';
const counters = () => ({
  registrations: 0,
  cleanups: 0,
  outstanding: 0,
  notifications: 0,
  reads: 0,
});
function frozen(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(frozen))
  );
}
export function generation(id: number) {
  const owner = createA2uiSurfaces();
  const counts = {
    id,
    apply: 0,
    dispose: 0,
    react: counters(),
    angular: counters(),
  };
  const retained: { snapshot: A2uiSurfacesSnapshot; text: string }[] = [];
  function observer(framework: Framework) {
    // Capture this generation's actual owner; identity changes on replacement.
    const count = counts[framework];
    return {
      getSnapshot() {
        count.reads++;
        return owner.getSnapshot();
      },
      subscribe(notify: () => void) {
        count.registrations++;
        count.outstanding++;
        const release = owner.subscribe(() => {
          count.notifications++;
          notify();
        });
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          release();
          count.cleanups++;
          count.outstanding--;
        };
      },
    };
  }
  return {
    counts,
    owner,
    react: observer('react'),
    angular: observer('angular'),
    apply(message: A2uiMessage) {
      const snapshot = owner.getSnapshot();
      retained.push({ snapshot, text: JSON.stringify(snapshot) });
      counts.apply++;
      owner.apply(message);
    },
    dispose() {
      counts.dispose++;
      owner.dispose();
    },
    retainedStable: () =>
      retained.every(
        ({ snapshot, text }) =>
          JSON.stringify(snapshot) === text && frozen(snapshot)
      ),
  };
}
export const generations = [generation(0)];
export let selected = generations[0];
export function selectNext() {
  selected = generation(generations.length);
  generations.push(selected);
}
export const views: Partial<Record<Framework, A2uiSurfacesSnapshot>> = {};
export const mounted = { react: false, angular: false };
export const state = { step: 0, ready: false, busy: false, error: '' };
export const sequence = [
  'Stage',
  'Commit root',
  'Update',
  'Delete',
  'Recreate',
  'Switch owner',
  'Apply old',
  'Commit new',
  'Switch again',
  'Apply second old',
  'Commit third',
  'Remove React',
  'Update absent React',
  'Mount React',
  'Remove Angular',
  'Update absent Angular',
  'Mount Angular',
  'Dispose',
  'Try disposed',
  'Teardown',
];
export const create = (): A2uiMessage => ({
  version: 'v0.9',
  createSurface: { surfaceId: 'surface', catalogId: 'raw-catalog' },
});
export const root = (): A2uiMessage => ({
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface',
    components: [
      { id: 'root', component: 'Text', text: 'literal <b>text</b>' },
    ],
  },
});
export const model = (value: string): A2uiMessage => ({
  version: 'v0.9',
  updateDataModel: { surfaceId: 'surface', value: { value } },
});
export function commit(value: string) {
  selected.apply(create());
  selected.apply(model(value));
  selected.apply(root());
}
export function evidence() {
  const snapshot = selected.owner.getSnapshot();
  return {
    ...state,
    selected: selected.counts.id,
    snapshot,
    owners: generations.map((g) => ({
      ...g.counts,
      react: { ...g.counts.react },
      angular: { ...g.counts.angular },
      snapshot: g.owner.getSnapshot(),
    })),
    mounted: { ...mounted },
    sameReference:
      (!mounted.react || views.react === snapshot) &&
      (!mounted.angular || views.angular === snapshot),
    stableRead: snapshot === selected.owner.getSnapshot(),
    frozenSnapshot: frozen(snapshot),
    retainedStable: generations.every((g) => g.retainedStable()),
  };
}
export function element(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing ' + id);
  return node;
}
export function draw() {
  element('evidence').textContent = JSON.stringify(evidence(), null, 2);
  element('controls')
    .querySelectorAll('button')
    .forEach((button, index) => {
      button.disabled = !state.ready || state.busy || state.step !== index;
    });
}
declare global {
  interface Window {
    __a2ui: typeof evidence;
  }
}
window.__a2ui = evidence;
