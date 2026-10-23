import { createRenderState } from '@threadplane/content/render-state';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const initial = { profile: { name: 'Ada' }, values: [1] };
const owner = createRenderState(initial);
const first = owner.getSnapshot();
initial.profile.name = 'caller mutation';
check(owner.get('/profile/name') === 'Ada', 'installed owner captures incoming data');
check(Object.isFrozen(first) && Object.isFrozen(first.profile), 'installed snapshots are deeply frozen');
let calls = 0;
let notifiedPath;
const release = owner.subscribe(() => { calls++; notifiedPath = owner.lastChange()?.path; });
owner.update({ '/values/2': 3, '/profile/name': 'Grace' });
check(notifiedPath === '/profile/name', 'metadata commits before notification');
check(calls === 1 && first.profile.name === 'Ada' && owner.get('/profile/name') === 'Grace', 'installed ordered batch preserves retained snapshot');
check(owner.get('/values/1') === undefined && Object.hasOwn(owner.get('/values'), 1), 'installed array growth is dense');
release();
owner.set('/profile/name', 'Katherine');
const retained = owner.getSnapshot();
owner.dispose();
check(owner.getSnapshot() === retained && calls === 1, 'installed disposal retains state and releases listeners');
let rejected = false;
try { owner.set('/profile/name', 'later'); } catch { rejected = true; }
check(rejected, 'disposed installed owner rejects commands');
console.log(JSON.stringify({ installedRenderState: 'passed', capturesInput: true, orderedBatch: true, denseArrays: true, retainedSnapshots: true, disposedCommandsRejected: true }));
