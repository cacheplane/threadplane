import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFeatureInputs, requestPolicy, assertOwnerAccounting, assertStateTransition } from './verify-render-state.mjs';

const inputs = [
  'node_modules/@threadplane/content/src/render-state/index.js',
  'node_modules/@threadplane/content/src/render-state/owned-value.js',
  'node_modules/@threadplane/content/src/render-state/pointer.js',
  'node_modules/@threadplane/content/src/render-state/create-render-state.js',
  'node_modules/@threadplane/react/src/use-agent.js',
  'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
];
const counts = () => ({ registrations: 2, cleanups: 1, outstanding: 1, notifications: 0, reads: 3 });
const snapshot = { label: 'initial', detail: { count: 0 }, phase: 'idle' };
const sample = () => ({
  selected: 0, constructed: 1, snapshot: structuredClone(snapshot), snapshotId: 0,
  lastChange: null, sameReference: true, stableRead: true, retainedStable: true, frozenSnapshot: true,
  mounted: { react: true, angular: true }, viewReferences:{react:0,angular:0},
  owners: [{ id: 0, set: 0, update: 0, dispose: 0, snapshot: structuredClone(snapshot), snapshotId: 0, labelRead:'initial', lastChange: null, react: counts(), angular: counts() }],
});
test('requires each actual installed implementation and rejects SDK, parser, protocol and alias runtime inputs', () => {
  assertFeatureInputs(inputs);
  for (const missing of inputs) assert.throws(() => assertFeatureInputs(inputs.filter(p => p !== missing)), /Installed implementation/);
  for (const path of ['libs/content/src/render-state/index.ts', 'node_modules/@json-render/core/dist/index.js', 'node_modules/@threadplane/a2ui/index.js', 'node_modules/@threadplane/content/src/a2ui/index.js', 'node_modules/@cacheplane/json-stream/index.js', 'node_modules/@langchain/langgraph-sdk/index.js', 'node_modules/@ag-ui/client/index.js', 'node_modules/openai/index.js'])
    assert.throws(() => assertFeatureInputs([...inputs, path]), /runtime|alias/);
});
test('allows only GET owned loopback shell and frozen asset paths within a hard cap', () => {
  const origin = 'http://127.0.0.1:1234';
  for (const [path, method] of [['https://example.com/', 'GET'], [origin + '/api', 'GET'], [origin + '/presentation', 'POST'], [origin + '/presentation-assets/unknown.js', 'GET']])
    assert.equal(requestPolicy(origin, ['/presentation-assets/main.js'])(path, method), false);
  const allow = requestPolicy(origin, ['/presentation-assets/main.js'], 2);
  assert.equal(allow(origin + '/presentation', 'GET'), true);
  assert.equal(allow(origin + '/presentation-assets/main.js', 'GET'), true);
  assert.equal(allow(origin + '/presentation', 'GET'), false);
  for (const url of ['https://127.0.0.1', 'http://localhost:1234', 'https://example.com']) assert.throws(() => requestPolicy(url));
});
test('rejects wrong owner identity, reference evidence, counters and disposal', () => {
  assertOwnerAccounting(sample());
  for (const mutate of [e => e.selected = 2, e => e.constructed = 2, e => e.sameReference = false, e => e.stableRead = false, e => e.retainedStable = false, e => e.frozenSnapshot = false, e => e.owners[0].dispose = 2, e => e.owners[0].set = -1, e => e.owners[0].update = 0.5, e => e.owners[0].react.outstanding = 0, e => e.owners[0].angular.notifications = -1]) {
    const evidence = sample(); mutate(evidence); assert.throws(() => assertOwnerAccounting(evidence));
  }
});
test('requires exact selected-owner/view reference identities and actual path reads', () => {
  for (const mutate of [e => e.owners[0].snapshotId=99,e => e.viewReferences.angular=99,e => e.owners[0].labelRead='wrong']) {
    const evidence=sample();mutate(evidence);assert.throws(()=>assertOwnerAccounting(evidence));
  }
});
test('replacement releases both retired borrowers without disposing or mutating owners', () => {
  const before=sample(),next=sample();next.selected=1;next.constructed=2;
  next.snapshot={label:'second',detail:{count:10},phase:'idle'};next.snapshotId=1;
  for (const f of ['react','angular']) {next.owners[0][f].cleanups=2;next.owners[0][f].outstanding=0;}
  next.owners.push({...structuredClone(next.owners[0]),id:1,snapshot:next.snapshot,snapshotId:1,labelRead:'second',react:counts(),angular:counts()});
  next.viewReferences={react:1,angular:1};
  assertOwnerAccounting(next);assertStateTransition(before,next,'Switch owner');
  for (const mutate of [e => e.owners[0].react.outstanding=1,e => e.owners[0].dispose=1,e => e.selected=0,e => e.owners[1].set=1]) {
    const evidence=structuredClone(next);mutate(evidence);
    assert.throws(()=>{assertOwnerAccounting(evidence);assertStateTransition(before,evidence,'Switch owner');});
  }
});
test('no-op controls preserve real snapshot reference, metadata and notifications while forwarding commands', () => {
  const before = sample(), next = sample(); next.owners[0].set = 1;
  assertStateTransition(before, next, 'Same reference');
  for (const mutate of [e => e.snapshotId++, e => e.owners[0].react.notifications++, e => e.lastChange = {path:'/label', value:'initial'}, e => e.owners[0].set = 0]) {
    const evidence = structuredClone(next); mutate(evidence); assert.throws(() => assertStateTransition(before, evidence, 'Same reference'));
  }
});
test('accepted object and ordered batch require independent literal state, last change and one publication', () => {
  const before = sample(), next = sample();
  next.snapshot = {label:'initial', detail:{count:1}, phase:'idle'}; next.snapshotId = 1;
  next.lastChange = {path:'/detail',value:{count:1}};
  next.owners[0].set = 1;
  for (const f of ['react','angular']) next.owners[0][f].notifications = 1;
  assertStateTransition(before, next, 'Accept object');
  for (const mutate of [e => e.snapshot.detail.count = 99, e => e.snapshotId = 0, e => e.lastChange.path = '/wrong', e => e.owners[0].angular.notifications = 2]) {
    const evidence = structuredClone(next); mutate(evidence); assert.throws(() => assertStateTransition(before, evidence, 'Accept object'));
  }
  const batch = structuredClone(next); batch.snapshot = {label:'ordered',detail:{count:3},phase:'complete'}; batch.snapshotId = 2;
  batch.lastChange = {path:'/phase',value:'complete'}; batch.owners[0].update = 1;
  for (const f of ['react','angular']) batch.owners[0][f].notifications++;
  assertStateTransition(next, batch, 'Ordered batch');
  batch.snapshot.detail.count = 2;
  assert.throws(() => assertStateTransition(next, batch, 'Ordered batch'));
});
test('view lifecycle forbids commands, construction, disposal and reference replacement', () => {
  const before = sample(), next = sample(); next.mounted.react = false;
  next.owners[0].react.cleanups++; next.owners[0].react.outstanding = 0;
  assertStateTransition(before, next, 'Remove React');
  for (const mutate of [e => e.owners[0].set++, e => e.owners[0].dispose++, e => e.constructed++, e => e.snapshotId++]) {
    const evidence = structuredClone(next); mutate(evidence); assert.throws(() => assertStateTransition(before, evidence, 'Remove React'));
  }
});
test('disposed write attempts retain snapshots and metadata without publication or extra disposal', () => {
  const before = sample(), next = sample(); before.owners[0].dispose = next.owners[0].dispose = 1;
  next.owners[0].set = 1; next.owners[0].update = 1; next.error = 'set: disposed; update: disposed';
  assertStateTransition(before, next, 'Try disposed');
  for (const mutate of [e => e.error = '', e => e.error='disposed', e => e.error='set: disposed; update: wrong error', e => e.snapshotId++, e => e.owners[0].dispose++, e => e.owners[0].react.notifications++]) {
    const evidence = structuredClone(next); mutate(evidence); assert.throws(() => assertStateTransition(before, evidence, 'Try disposed'));
  }
});
for (const failure of ['none', 'launch', 'check', 'close']) test('shared real socket cleanup and propagated failure: ' + failure, async () => {
  const { verifyMarkdownBrowser } = await import('./verify-markdown.mjs');
  let origin, closed = false, checked = false;
  const result = verifyMarkdownBrowser('', {
    launch: async url => { origin = url; assert.equal((await fetch(url)).status, 200); if (failure === 'launch') throw new Error('launch failure'); return {close: async () => {await Promise.resolve(); closed = true; if (failure === 'close') throw new Error('close failure');}}; },
    check: async () => {checked = true; if (failure === 'check') throw new Error('check failure'); return 'checked';},
  });
  if (failure === 'none') assert.equal(await result, 'checked'); else await assert.rejects(result, new RegExp(failure + ' failure'));
  assert.equal(closed, failure !== 'launch'); assert.equal(checked, failure !== 'launch');
  await assert.rejects(fetch(origin), /fetch failed/);
});
