import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderSpec } from '@threadplane/react/render';

// Installed module execution probe; product SSR/hydration is a separate contract.
const registry = {
  Box: ({ children }) => createElement('section', null, children),
  Text: ({ props }) => createElement('p', null, props.text),
};
const spec = Object.freeze({
  root: 'root',
  elements: Object.freeze({
    root: { type: 'Box', props: {}, children: ['title', 'rows'] },
    title: {
      type: 'Text',
      props: { text: { $state: '/title' } },
      visible: { $state: '/show' },
    },
    rows: {
      type: 'Box',
      props: {},
      children: ['row'],
      repeat: { statePath: '/rows', key: 'id' },
    },
    row: { type: 'Text', props: { text: { $item: 'text' } } },
  }),
});
const state = {
  title: '<b>literal</b>',
  show: true,
  rows: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
};
const before = JSON.stringify({ spec, state });
const html = renderToStaticMarkup(
  createElement(RenderSpec, { spec, registry, state })
);
assert.match(html, /&lt;b&gt;literal&lt;\/b&gt;/);
assert.match(html, /<p>A<\/p><p>B<\/p>/);
assert.equal(JSON.stringify({ spec, state }), before);
assert.equal(Object.isFrozen(state.rows), false);
for (const root of ['missing', 'constructor', '__proto__', 'toString']) {
  assert.equal(
    renderToStaticMarkup(
      createElement(RenderSpec, { spec: { root, elements: {} }, registry })
    ),
    ''
  );
}
assert.equal(
  renderToStaticMarkup(createElement(RenderSpec, { spec: null, registry })),
  ''
);
console.log('Installed read-only RenderSpec runtime contracts passed.');
