import { describe, expect, it } from 'vitest';
import type { A2uiMessage } from '@threadplane/a2ui';
import { createSurfaceState, transition, surfaceSnapshot } from './transition.js';

const create = (id = 's', extra = {}): A2uiMessage => ({ version: 'v0.9', createSurface: { surfaceId: id, catalogId: 'catalog', ...extra } });
const components = (ids = ['root'], id = 's'): A2uiMessage => ({ version: 'v0.9', updateComponents: { surfaceId: id, components: ids.map(id => ({ id, component: 'Text', text: id })) } });
const model = (value: unknown, path?: string, id = 's'): A2uiMessage => ({ version: 'v0.9', updateDataModel: { surfaceId: id, path, value } });
const remove = (id = 's'): A2uiMessage => ({ version: 'v0.9', deleteSurface: { surfaceId: id } });

function harness() {
  let state = createSurfaceState();
  let snapshot = surfaceSnapshot(state);
  let publications = 0;
  return {
    apply(message: A2uiMessage) {
      const result = transition(state, message);
      state = result.state;
      if (result.publish) { snapshot = surfaceSnapshot(state); publications++; }
    },
    get snapshot() { return snapshot; },
    get publications() { return publications; },
  };
}

describe('A2UI transitions', () => {
  it('gates on create and root, folding earlier model commands in arrival order', () => {
    const h = harness();
    h.apply(model({ old: true }));
    h.apply(model('first', '/title'));
    h.apply(model('last', '/title'));
    h.apply(components(['child']));
    h.apply(create());
    expect(h.publications).toBe(0);
    h.apply(components());
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ old: true, title: 'last' });
    expect(h.snapshot.surfaces[0].components.map(c => c.id)).toEqual(['child', 'root']);
    expect(h.publications).toBe(1);
  });

  it('preserves surface and component insertion order including numeric-looking IDs', () => {
    const h = harness();
    for (const id of ['10', '2', 's']) { h.apply(create(id)); h.apply(components(['root', '10', '2'], id)); }
    const old = h.snapshot;
    h.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's', components: [
        { id: '2', component: 'Text', text: 'replacement' },
        { id: 'new', component: 'Text', text: 'new' },
      ],
    } });
    expect(h.snapshot.surfaces.map(s => s.surfaceId)).toEqual(['10', '2', 's']);
    expect(h.snapshot.surfaces[2].components.map(c => c.id)).toEqual(['root', '10', '2', 'new']);
    expect(old.surfaces[2].components).toHaveLength(3);
    expect(h.snapshot.surfaces[2].components[2]['text']).toBe('replacement');
    expect(old.surfaces[2].components[2]['text']).toBe('2');
    expect(Object.isFrozen(h.snapshot.surfaces[2].components)).toBe(true);
  });

  it('uses last buffered create but retains omitted metadata on live refresh', () => {
    const h = harness();
    h.apply(create('s', { theme: { primaryColor: 'red' }, sendDataModel: true }));
    h.apply(create());
    h.apply(components());
    expect(Object.hasOwn(h.snapshot.surfaces[0], 'theme')).toBe(false);
    h.apply(create('s', { theme: { primaryColor: 'blue' }, sendDataModel: false }));
    h.apply(create('s', { catalogId: 'new' }));
    expect(h.snapshot.surfaces[0]).toMatchObject({ catalogId: 'new', theme: { primaryColor: 'blue' }, sendDataModel: false });
    h.apply(create('s', { theme: undefined, sendDataModel: undefined }));
    expect(h.snapshot.surfaces[0].theme).toEqual({ primaryColor: 'blue' });
  });

  it('retains accepted nonenumerable metadata across live create refreshes', () => {
    for (const sendDataModel of [true, false]) {
      const h = harness();
      const input = create();
      if ('createSurface' in input) {
        Object.defineProperty(input.createSurface, 'theme', {
          value: { primaryColor: 'red' }, enumerable: false,
        });
        Object.defineProperty(input.createSurface, 'sendDataModel', {
          value: sendDataModel, enumerable: false,
        });
      }
      h.apply(input); h.apply(components());
      const prior = h.snapshot;
      h.apply(create('s', { catalogId: 'new' }));
      expect(h.snapshot.surfaces[0]).toMatchObject({
        catalogId: 'new', theme: { primaryColor: 'red' }, sendDataModel,
      });
      h.apply(create('s', {
        theme: { primaryColor: 'blue' }, sendDataModel: !sendDataModel,
      }));
      h.apply(create());
      expect(h.snapshot.surfaces[0]).toMatchObject({
        theme: { primaryColor: 'blue' }, sendDataModel: !sendDataModel,
      });
      expect(prior.surfaces[0]).toMatchObject({
        theme: { primaryColor: 'red' }, sendDataModel,
      });
    }
  });

  it('preserves whole-root rules, simple slash paths and exact array deletions', () => {
    const h = harness(); h.apply(create()); h.apply(components());
    for (const path of [undefined, '', '/']) {
      for (const value of [42, 'text', false, ['a', 'b']]) {
        h.apply(model(value, path)); expect(h.snapshot.surfaces[0].dataModel).toEqual(value);
      }
      h.apply(model(null, path)); expect(h.snapshot.surfaces[0].dataModel).toEqual({});
      h.apply(model(undefined, path)); expect(h.snapshot.surfaces[0].dataModel).toEqual({});
    }
    h.apply(model(['a', 'b'])); h.apply(model(undefined, '/0'));
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ '1': 'b' });
    expect(Array.isArray(h.snapshot.surfaces[0].dataModel)).toBe(false);
    h.apply(model({ items: ['a', 'b'] })); h.apply(model(undefined, '/items/0'));
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ items: [undefined, 'b'] });
    h.apply(model(1, '//a~1b//~0/'));
    expect(h.snapshot.surfaces[0].dataModel).toMatchObject({ 'a~1b': { '~0': 1 } });
    h.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/items' } });
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ 'a~1b': { '~0': 1 } });
  });

  it('keeps prototype-like paths as safe own data', () => {
    const h = harness(); h.apply(create()); h.apply(components());
    for (const key of ['__proto__', 'constructor', 'prototype']) h.apply(model('own', `/${key}/value`));
    const data = h.snapshot.surfaces[0].dataModel as Record<string, unknown>;
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(Object.hasOwn(data, key)).toBe(true); expect(data[key]).toEqual({ value: 'own' });
    }
    expect((Object.prototype as Record<string, unknown>)['value']).toBeUndefined();
    h.apply(model(undefined, '/__proto__/value'));
    expect((h.snapshot.surfaces[0].dataModel as Record<string, unknown>)['__proto__']).toEqual({});
  });

  it('distinguishes literal root paths from repeated slash paths', () => {
    const h = harness(); h.apply(create()); h.apply(components());
    h.apply(model(null, '///'));
    expect(h.snapshot.surfaces[0].dataModel).toBeNull();
  });

  it('preserves UTF-16 string own indices when deleting from a scalar root', () => {
    const h = harness(); h.apply(create()); h.apply(components());
    h.apply(model('😀a')); h.apply(model(undefined, '/0'));
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ '1': '\ude00', '2': 'a' });
  });

  it('publishes recognized live commands and every delete, then recreates cleanly', () => {
    const h = harness(); h.apply(remove()); expect(h.publications).toBe(1);
    h.apply(model('staged', '/title')); h.apply(remove());
    h.apply(create()); h.apply(components());
    expect(h.snapshot.surfaces[0].dataModel).toEqual({});
    const before = h.snapshot;
    h.apply(components([])); h.apply(model(undefined, '/absent')); h.apply(create());
    expect(h.publications).toBe(6); expect(h.snapshot).not.toBe(before);
    h.apply(remove()); expect(h.snapshot.surfaces).toEqual([]);
    h.apply(components()); h.apply(create()); expect(h.snapshot.surfaces).toHaveLength(1);
  });

  it('captures all envelope data before mutation and retains immutable earlier snapshots', () => {
    const h = harness();
    const input = create('s', { theme: { primaryColor: 'red' } });
    h.apply(input);
    if ('createSurface' in input) input.createSurface.theme!.primaryColor = 'blue';
    h.apply(components());
    const old = h.snapshot;
    const data = { list: [{ name: 'before' }] };
    h.apply(model(data)); data.list[0].name = 'after';
    expect(h.snapshot.surfaces[0].dataModel).toEqual({ list: [{ name: 'before' }] });
    expect(old.surfaces[0].dataModel).toEqual({});
    expect(old.surfaces[0].theme?.primaryColor).toBe('red');
    expect(Object.isFrozen(h.snapshot.surfaces[0])).toBe(true);
  });

  it('rejects unsupported model paths atomically for live and staged surfaces', () => {
    for (const live of [false, true]) {
      const h = harness();
      if (live) { h.apply(create()); h.apply(components()); }
      h.apply(model({ items: ['a', 'b'] }));
      const before = h.snapshot;
      for (const path of ['/items/extra', '/items/length', '/items/-1', '/items/01', '/items/4294967295']) {
        expect(() => h.apply(model('no', path))).toThrow(TypeError);
        expect(() => h.apply(model(undefined, path))).toThrow(TypeError);
        expect(h.snapshot).toBe(before);
      }
      const bad = Object.defineProperty({}, 'oops', { get() { throw new Error('invoked'); } });
      expect(() => h.apply(model(bad))).toThrow(TypeError);
      if (!live) { h.apply(create()); h.apply(components()); }
      expect(h.snapshot.surfaces[0].dataModel).toEqual({ items: ['a', 'b'] });
    }
  });

  it('rejects an entire component command without leaking its earlier components', () => {
    const h = harness(); h.apply(create());
    const message = components(['root', 'bad']);
    if ('updateComponents' in message) Object.defineProperty(message.updateComponents.components[1], 'text', { get() { throw new Error('invoked'); } });
    expect(() => h.apply(message)).toThrow(TypeError);
    h.apply(components(['child'])); expect(h.publications).toBe(0);
    h.apply(components()); expect(h.snapshot.surfaces[0].components.map(c => c.id)).toEqual(['child', 'root']);
  });
});
