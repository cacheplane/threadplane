import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatDebug, StateDiff } from '@threadplane/react/debug';

assert.equal(typeof window, 'undefined');
assert.equal(typeof document, 'undefined');
let requests = 0;
const fetchBefore = globalThis.fetch;
globalThis.fetch = () => { requests++; throw new Error('Passive state comparison must not fetch'); };
try {
  const render = (before, after) => renderToStaticMarkup(createElement(StateDiff, { before, after }));
  const literal = render({ 'a~/b.c': 0, removed: null }, { 'a~/b.c': 1, added: '<img onerror=hostile>' });
  assert.match(literal, /aria-label="State changes"/);
  assert.match(literal, /&quot;path&quot;:&quot;\/a~0~1b.c&quot;/);
  assert.match(literal, /&quot;kind&quot;:&quot;changed&quot;/);
  assert.match(literal, /&quot;kind&quot;:&quot;removed&quot;/);
  assert.match(literal, /&quot;kind&quot;:&quot;added&quot;/);
  assert.match(literal, /&lt;img onerror=hostile&gt;/);
  assert.doesNotMatch(literal, /<img|<button/);
  assert.match(render({ rows: [{ x: 1, y: 2 }] }, { rows: [{ y: 2, x: 1 }] }), /No changes in the supplied states\./);
  assert.match(render([1], [2]), /&quot;path&quot;:&quot;&quot;/);
  assert.match(render([1], [2]), /whole arrays/);
  const cyclic = {}; cyclic.self = cyclic;
  for (const invalid of [NaN, cyclic, new Date()]) {
    const html = render(invalid, invalid);
    assert.match(html, /invalid plain data/);
    assert.doesNotMatch(html, /No changes|<pre/);
  }
  let reads = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { reads++; throw new Error('Getter must not run'); } });
  assert.match(render(accessor, {}), /invalid plain data/);
  assert.equal(reads, 0);
  assert.match(render('x'.repeat(2001), 'x'.repeat(2001)), /supplied states exceed comparison limits/);
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, i]));
  assert.doesNotMatch(render(many, {}), /Comparison unavailable/);
  assert.match(render({ ...many, extra: 50 }, {}), /changes exceed display limits/);

  const selection = { contextKey: 'owner', pageGeneration: 1, rowKey: 'row' };
  const props = {
    contextKey: 'owner', defaultOpen: true,
    current: { contextKey: 'owner', status: 'ready', values: { count: 2 } },
    checkpointPage: { contextKey: 'owner', pageGeneration: 1, rows: [{ rowKey: 'row', label: 'Saved checkpoint', inspectable: true }], truncated: false },
    selection,
    inspection: { status: 'ready', selection, values: { count: 1 } },
    onInspect() { requests++; }, onRefresh() { requests++; },
  };
  const panel = renderToStaticMarkup(createElement(ChatDebug, props));
  assert.match(panel, /Compare selected checkpoint with current state/);
  assert.match(panel, /&quot;before&quot;:1,&quot;after&quot;:2/);
  for (const change of [
    { current: { contextKey: 'other', status: 'ready', values: {} } },
    { current: { contextKey: 'owner', status: 'unknown' } },
    { inspection: { status: 'loading', selection } },
    { inspection: { status: 'ready', selection: { ...selection, pageGeneration: 2 }, values: {} } },
  ]) assert.doesNotMatch(renderToStaticMarkup(createElement(ChatDebug, { ...props, ...change })), /Compare selected checkpoint with current state/);
  assert.equal(requests, 0);
  console.log('Installed StateDiff and ChatDebug SSR: exact bounded changes, literal JSON Pointer paths, atomic arrays, complete-input/output refusal, matched-ready comparison and no browser globals or requests.');
} finally {
  globalThis.fetch = fetchBefore;
}
