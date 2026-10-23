import { createRenderState, type RenderStateSnapshot, type RenderStateChange } from '@threadplane/content/render-state';

type Framework = 'react' | 'angular';
const counters = () => ({registrations:0, cleanups:0, outstanding:0, notifications:0, reads:0});
const references = new WeakMap<object, number>();
let nextReference = 0;
export function reference(value: object) {
  if (!references.has(value)) references.set(value, nextReference++);
  return references.get(value)!;
}
function frozen(value: unknown): boolean {
  return value === null || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(frozen));
}
let constructed = 0;
export function generation(id: number) {
  // Application construction only: neither framework view can construct owners.
  const actual = createRenderState({label:['initial','second','third'][id], detail:{count:id * 10}, phase:'idle'});
  constructed++;
  const counts = {id, set:0, update:0, get:0, getSnapshot:0, lastChange:0, dispose:0, react:counters(), angular:counters()};
  const retained: {snapshot:RenderStateSnapshot; change: RenderStateChange | undefined; text:string; metadata:string | undefined}[] = [];
  const retain = () => {
    const snapshot = actual.getSnapshot(), change = actual.lastChange();
    reference(snapshot);
    retained.push({snapshot,change,text:JSON.stringify(snapshot),metadata:JSON.stringify(change)});
  };
  retain();
  const owner = {
    getSnapshot() {counts.getSnapshot++; return actual.getSnapshot();},
    get(path:string) {counts.get++; return actual.get(path);},
    lastChange() {counts.lastChange++; return actual.lastChange();},
    set(path:string,value:unknown) {retain(); counts.set++; actual.set(path,value);},
    update(updates:Readonly<Record<string,unknown>>) {retain(); counts.update++; actual.update(updates);},
    subscribe: (notify:()=>void) => actual.subscribe(notify),
    dispose() {counts.dispose++; actual.dispose();},
  };
  function observer(framework:Framework) {
    const count = counts[framework];
    return {
      getSnapshot() {count.reads++; return owner.getSnapshot();},
      subscribe(notify:()=>void) {
        count.registrations++; count.outstanding++;
        const release = owner.subscribe(() => {count.notifications++; notify();});
        let active = true;
        return () => {if (!active) return; active = false; release(); count.cleanups++; count.outstanding--;};
      },
    };
  }
  return {
    owner, counts, react:observer('react'), angular:observer('angular'),
    retainedEvidence: () => retained.map(({snapshot,change,text,metadata}) => ({
      snapshotId:reference(snapshot), snapshot, change:change ?? null,
      unchanged:JSON.stringify(snapshot) === text && JSON.stringify(change) === metadata,
      frozen:frozen(snapshot) && frozen(change),
    })),
  };
}
export const generations = [generation(0)];
export let selected = generations[0];
export function selectNext() {selected = generation(generations.length); generations.push(selected);}
export const views: Partial<Record<Framework,RenderStateSnapshot>> = {};
export const mounted = {react:false,angular:false};
export const state = {step:0,ready:false,busy:false,error:''};
export const sequence = [
  'Same reference','Equal primitive','Accept object','Ordered batch',
  'Remove React','Write absent React','Mount React',
  'Remove Angular','Write absent Angular','Mount Angular',
  'Switch owner','Write old','Accept second','Switch again','Write second old','Accept third',
  'Dispose all','Try disposed','Teardown',
];
export function evidence() {
  const snapshot = selected.owner.getSnapshot();
  const owners = generations.map(g => ({
    ...g.counts, react:{...g.counts.react}, angular:{...g.counts.angular},
    snapshot:g.owner.getSnapshot(), snapshotId:reference(g.owner.getSnapshot()), labelRead:g.owner.get('/label'), lastChange:g.owner.lastChange() ?? null,
    retained:g.retainedEvidence(),
  }));
  return {
    ...state, selected:selected.counts.id, constructed, snapshot, snapshotId:reference(snapshot),
    lastChange:selected.owner.lastChange() ?? null, owners, mounted:{...mounted},
    viewReferences:{react:views.react ? reference(views.react) : null,angular:views.angular ? reference(views.angular) : null},
    sameReference:(!mounted.react || views.react === snapshot) && (!mounted.angular || views.angular === snapshot),
    stableRead:snapshot === selected.owner.getSnapshot(), frozenSnapshot:frozen(snapshot),
    retainedStable:owners.every(g => g.retained.every(r => r.unchanged && r.frozen)),
  };
}
export function element(id:string) {const node=document.getElementById(id); if (!node) throw new Error('Missing '+id); return node;}
export function draw() {
  element('evidence').textContent=JSON.stringify(evidence(),null,2);
  element('controls').querySelectorAll('button').forEach((button,index) => {button.disabled=!state.ready || state.busy || state.step !== index;});
}
declare global {interface Window {__renderState:typeof evidence;}}
window.__renderState=evidence;
