import assert from 'node:assert/strict';
import test from 'node:test';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import { formatTripSummary } from '../../shared/trip-summary.js';
import {
  buildTripSurface,
  projectTripSurface,
  validateTripSurface,
  TRIP_CATALOG_ID,
} from './a2ui-trip-catalog.js';

const card = (note?: string) =>
  Object.freeze({
    callId: 'call',
    ...formatTripSummary({
      title: ' <b>Trip</b> ',
      days: [
        { day: 1, places: [' <i>Place</i> ', '<i>Place</i>'] },
        { day: 1, places: [] },
      ],
      ...(note === undefined ? {} : { note }),
    }),
  });

test('authored trip catalog projects actual raw snapshots with literal text and indexed duplicate entries', () => {
  const description = buildTripSurface(card(''));
  assert.equal(description.catalogId, TRIP_CATALOG_ID);
  validateTripSurface(description);
  const owner = createA2uiSurfaces();
  owner.apply({
    version: 'v0.9',
    createSurface: {
      surfaceId: description.surfaceId,
      catalogId: description.catalogId,
    },
  });
  owner.apply({
    version: 'v0.9',
    updateComponents: {
      surfaceId: description.surfaceId,
      components: [...description.components],
    },
  });
  owner.apply({
    version: 'v0.9',
    updateDataModel: {
      surfaceId: description.surfaceId,
      value: { arbitrary: 'not projected' },
    },
  });
  const prepared = projectTripSurface(owner.getSnapshot().surfaces[0], 'call');
  assert.deepEqual(prepared.spec.elements['root'].props, {
    title: '<b>Trip</b>',
  });
  assert.deepEqual(prepared.spec.elements['counts'].props, {
    text: '2 days · 2 stops',
  });
  assert.deepEqual(prepared.spec.elements['days'].children, ['day-0', 'day-1']);
  assert.deepEqual(prepared.spec.elements['places-0'].children, [
    'place-0-0',
    'place-0-1',
  ]);
  assert.deepEqual(prepared.spec.elements['day-1'].props, {
    label: 'Day 1',
    empty: true,
  });
  assert.deepEqual(prepared.spec.elements['note'].props, { text: '' });
  assert.deepEqual(prepared.spec.elements['place-0-0'].props, {
    text: '<i>Place</i>',
  });
  assert.deepEqual(prepared.state, {});
  owner.apply({
    version: 'v0.9',
    updateComponents: {
      surfaceId: description.surfaceId,
      components: [
        { id: 'place-0-0', component: 'Place', text: 'Changed raw text' },
      ],
    },
  });
  const changed = projectTripSurface(owner.getSnapshot().surfaces[0], 'call');
  assert.equal(
    changed.spec.elements['place-0-0'].props['text'],
    'Changed raw text'
  );
  assert.equal(
    prepared.spec.elements['place-0-0'].props['text'],
    '<i>Place</i>'
  );
  frozen(prepared);
  owner.dispose();
  assert.equal(prepared.spec.root, 'root');
});

test('authored trip catalog retains empty days and distinguishes omitted from empty note', () => {
  const description = buildTripSurface({
    callId: 'empty',
    ...formatTripSummary({ title: 'Empty', days: [] }),
  });
  assert.deepEqual(
    description.components.find((c) => c.id === 'days'),
    { id: 'days', component: 'Days', empty: true, children: [] }
  );
  assert.equal(
    description.components.some((c) => c.component === 'Note'),
    false
  );
  assert.equal(
    buildTripSurface(card('')).components.some((c) => c.component === 'Note'),
    true
  );
  frozen(description);
});

test('authored trip catalog rejects unknown catalogs, types, fields, dynamic props and invalid static trees', () => {
  const base = buildTripSurface(card('Note'));
  for (const patch of [
    { catalogId: 'other' },
    { unknown: true },
    { theme: { primaryColor: 'blue' } },
    { sendDataModel: true },
    {
      components: [
        ...base.components,
        { id: 'unknown', component: 'Button', action: {} },
      ],
    },
    {
      components: base.components.map((c) =>
        c.id === 'counts' ? { ...c, catalogId: TRIP_CATALOG_ID } : c
      ),
    },
    ...['action', 'url', 'checks', 'template', 'extra'].map((key) => ({
      components: base.components.map((c) =>
        c.id === 'counts' ? { ...c, [key]: 'forbidden' } : c
      ),
    })),
    ...[{ path: '/text' }, { call: 'function' }, () => 'text', 1, false].map(
      (text) => ({
        components: base.components.map((c) =>
          c.id === 'counts' ? { ...c, text } : c
        ),
      })
    ),
    ...[
      ['missing'],
      ['counts', 'counts'],
      ['root'],
      { path: '/items', componentId: 'counts' },
    ].map((children) => ({
      components: base.components.map((c) =>
        c.id === 'root' ? { ...c, children } : c
      ),
    })),
    {
      components: base.components.map((c) =>
        c.id === 'days' ? { ...c, children: ['counts'] } : c
      ),
    },
    { components: [...base.components, base.components[0]] },
    {
      components: base.components.map((c) =>
        c.id === 'counts' ? { id: 'counts', component: 'Counts' } : c
      ),
    },
    {
      components: base.components.map((c) =>
        c.id === 'days' ? { ...c, empty: 'false' } : c
      ),
    },
    {
      components: base.components.map((c) =>
        c.id === 'day-1' ? { ...c, children: ['places-0'] } : c
      ),
    },
  ])
    assert.throws(
      () => validateTripSurface({ ...base, ...patch } as typeof base),
      TypeError
    );
});

function frozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(frozen);
}
