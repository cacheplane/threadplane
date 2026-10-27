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
const produced = { list: [{ value: 42 }] };
const functions = Object.create(null);
Object.defineProperty(functions, 'inner', { value: () => produced });
functions.outer = (args) => {
  assert.equal(Object.isFrozen(args), true);
  assert.equal(Object.isFrozen(args.value), true);
  assert.equal(Object.isFrozen(args.value.list), true);
  assert.notEqual(args.value, produced);
  return String(args.value.list[0].value);
};
functions.rowLabel = (args) => `${args.value}/${args.index}`;
functions.constructor = () => 'own constructor';
const computed = {
  root: 'root',
  elements: {
    root: { type: 'Box', props: {}, children: ['value', 'rows', 'named'] },
    value: {
      type: 'Text',
      props: {
        text: { $computed: 'outer', args: { value: { $computed: 'inner' } } },
      },
    },
    rows: {
      type: 'Box',
      props: {},
      children: ['row'],
      repeat: { statePath: '/rows', key: 'id' },
    },
    row: {
      type: 'Text',
      props: {
        text: {
          $computed: 'rowLabel',
          args: { value: { $item: 'text' }, index: { $index: true } },
        },
      },
    },
    named: { type: 'Text', props: { text: { $computed: 'constructor' } } },
  },
};
const computedHtml = renderToStaticMarkup(
  createElement(RenderSpec, { spec: computed, registry, state, functions })
);
assert.match(computedHtml, /<p>42<\/p>/);
assert.match(computedHtml, /<p>A\/0<\/p><p>B\/1<\/p>/);
assert.match(computedHtml, /<p>own constructor<\/p>/);
assert.equal(Object.isFrozen(produced), false);
assert.equal(Object.isFrozen(produced.list), false);
for (const label of [
  () => Promise.resolve('later'),
  () => new Date(0),
  () => Infinity,
]) {
  assert.throws(
    () =>
      renderToStaticMarkup(
        createElement(RenderSpec, {
          spec: {
            root: 'text',
            elements: {
              text: { type: 'Text', props: { text: { $computed: 'label' } } },
            },
          },
          registry,
          functions: { label },
        })
      ),
    TypeError
  );
}
console.log('Installed read-only RenderSpec runtime contracts passed.');
console.log('Installed pure computed RenderSpec contracts passed.');
