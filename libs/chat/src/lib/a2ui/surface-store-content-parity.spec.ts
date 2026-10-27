import { TestBed } from '@angular/core/testing';
import type { A2uiComponent, A2uiMessage, A2uiSurface } from '@threadplane/a2ui';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import { describe, expect, test } from 'vitest';
import { createA2uiSurfaceStore } from './surface-store';

const create = (surfaceId: string, extra = {}): A2uiMessage => ({
  version: 'v0.9', createSurface: { surfaceId, catalogId: 'catalog', ...extra },
});
const components = (surfaceId: string, values: A2uiComponent[]): A2uiMessage => ({
  version: 'v0.9', updateComponents: { surfaceId, components: values },
});
const root = (surfaceId: string) => components(surfaceId, [{ id: 'root', component: 'Text', text: 'root' }]);
const model = (surfaceId: string, body: { path?: string; value?: unknown }): A2uiMessage => ({
  version: 'v0.9', updateDataModel: { surfaceId, ...body },
});
const remove = (surfaceId: string): A2uiMessage => ({ version: 'v0.9', deleteSurface: { surfaceId } });

// Only the two Map containers differ between the public representations.
// Leave all payloads untouched: presence, undefined, holes and order matter.
function normalize(surfaces: Map<string, A2uiSurface>) {
  return { surfaces: Array.from(surfaces.values(), (surface) => ({
    ...surface, components: Array.from(surface.components.values()),
  })) };
}

function oracle() {
  TestBed.configureTestingModule({});
  const angular = TestBed.runInInjectionContext(() => createA2uiSurfaceStore());
  const neutral = createA2uiSurfaces();
  let count = 0;
  function apply(command: A2uiMessage) {
    // Each owner receives its own capture, including explicit undefined fields.
    angular.apply(structuredClone(command));
    neutral.apply(structuredClone(command));
    expect(neutral.getSnapshot(), `after command ${++count}`).toStrictEqual(normalize(angular.surfaces()));
  }
  expect(neutral.getSnapshot()).toStrictEqual(normalize(angular.surfaces()));
  return {
    apply,
    run: (commands: A2uiMessage[]) => commands.forEach(apply),
    models: (id: string) => [angular.surfaces().get(id)!.dataModel, neutral.getSnapshot().surfaces.find((s) => s.surfaceId === id)!.dataModel],
    snapshots: () => [normalize(angular.surfaces()), neutral.getSnapshot()],
  };
}

describe('content surfaces versus the unchanged Angular store', () => {
  const permutations = [
    ['create', 'root', 'model'], ['create', 'model', 'root'],
    ['root', 'create', 'model'], ['root', 'model', 'create'],
    ['model', 'create', 'root'], ['model', 'root', 'create'],
  ] as const;
  test.each(permutations)('compares every staging step: %s, %s, %s', (...order) => {
    const commands = { create: create('s'), root: root('s'), model: model('s', { path: '/queued', value: { present: undefined, items: ['x', undefined] } }) };
    const trace = oracle();
    trace.run(order.map((key) => commands[key]));
    for (const value of trace.models('s')) expect(value).toStrictEqual({ queued: { present: undefined, items: ['x', undefined] } });
  });

  test('preserves surface and component insertion order and replaces whole duplicate components', () => {
    const trace = oracle();
    trace.run([
      create('10'), create('2'), components('10', [{ id: '10', component: 'Text', text: 'old', obsolete: true }, { id: '2', component: 'Text' }, { id: '10', component: 'Text', text: 'staged' }]),
      root('2'), root('10'), create('alpha'), root('alpha'),
      components('10', [{ id: '2', component: 'Button', label: 'first' }, { id: '1', component: 'Text' }, { id: '2', component: 'Text', text: undefined }]),
      components('10', [{ id: '10', component: 'Button', label: 'replacement' }]),
    ]);
    for (const snapshot of trace.snapshots()) {
      expect(snapshot.surfaces.map((s) => s.surfaceId)).toStrictEqual(['2', '10', 'alpha']);
      const values = snapshot.surfaces[1].components;
      expect(values.map((c) => c.id)).toStrictEqual(['10', '2', 'root', '1']);
      expect(values[0]).toStrictEqual({ id: '10', component: 'Button', label: 'replacement' });
      expect(values[1]).toStrictEqual({ id: '2', component: 'Text', text: undefined });
    }
  });

  test('distinguishes buffered metadata replacement from live omitted and undefined retention', () => {
    const trace = oracle();
    trace.run([
      create('s', { theme: { primaryColor: 'old' }, sendDataModel: true }),
      create('s', { catalogId: 'buffered', theme: undefined, sendDataModel: undefined }), root('s'),
    ]);
    for (const snapshot of trace.snapshots()) {
      expect(Object.hasOwn(snapshot.surfaces[0], 'theme')).toBe(false);
      expect(Object.hasOwn(snapshot.surfaces[0], 'sendDataModel')).toBe(false);
    }
    trace.run([
      create('s', { theme: { primaryColor: 'new' }, sendDataModel: true }),
      create('s', { catalogId: 'omitted' }),
      create('s', { theme: undefined, sendDataModel: undefined }),
      create('s', { theme: {}, sendDataModel: false }), create('s'),
      create('s', { theme: undefined, sendDataModel: undefined }),
    ]);
    for (const snapshot of trace.snapshots()) {
      expect(snapshot.surfaces[0].theme).toStrictEqual({});
      expect(snapshot.surfaces[0].sendDataModel).toBe(false);
    }
    trace.run([create('omitted', { sendDataModel: true }), create('omitted'), root('omitted')]);
    for (const snapshot of trace.snapshots()) expect(Object.hasOwn(snapshot.surfaces[1], 'sendDataModel')).toBe(false);
    trace.run([create('false', { sendDataModel: true }), create('false', { theme: {}, sendDataModel: false }), root('false')]);
    for (const snapshot of trace.snapshots()) {
      expect(snapshot.surfaces[2].theme).toStrictEqual({});
      expect(snapshot.surfaces[2].sendDataModel).toBe(false);
    }
  });

  test('folds staged and live path writes, whole replacement and omitted or undefined deletes', () => {
    const trace = oracle();
    trace.run([
      model('s', { value: { stale: true } }), model('s', { value: { retained: undefined, nested: { before: 1 } } }),
      model('s', { path: '/nested/after', value: 2 }), model('s', { path: '/nested/before' }),
      model('s', { path: '/explicit', value: 3 }), model('s', { path: '/explicit', value: undefined }), create('s'), root('s'),
      model('s', { path: '/nested/after', value: undefined }), model('s', { path: '/missing/deep' }),
      model('s', { path: '/', value: { replaced: true } }), model('s', { value: undefined }),
      model('s', { value: { again: 1 } }), model('s', {}), model('s', { path: '/a/b', value: ['x', undefined] }),
    ]);
    for (const value of trace.models('s')) expect(value).toStrictEqual({ a: { b: ['x', undefined] } });
  });

  test('binds root array deletion to a plain record on both owners', () => {
    const trace = oracle();
    trace.run([create('s'), root('s'), model('s', { value: ['a', 'b'] }), model('s', { path: '/0' })]);
    for (const value of trace.models('s')) {
      expect(value).toStrictEqual({ '1': 'b' });
      expect(Array.isArray(value)).toBe(false);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    }
  });

  test('binds nested array deletion to an own undefined entry on both owners', () => {
    const trace = oracle();
    trace.run([model('s', { value: { items: ['a', 'b'] } }), model('s', { path: '/items/0' }), create('s'), root('s')]);
    for (const value of trace.models('s')) {
      expect(value).toStrictEqual({ items: [undefined, 'b'] });
      const items = (value as { items: unknown[] }).items;
      expect(Object.hasOwn(items, '0')).toBe(true);
      expect(items).toHaveLength(2);
    }
    trace.run([model('s', { path: '/items/1', value: 'updated' }), model('s', { path: '/items/0', value: undefined })]);
  });

  test('handles scalar roots, Unicode string deletion and repeated-slash null replacement', () => {
    const trace = oracle();
    trace.run([create('s'), root('s')]);
    for (const value of [42, false, 'A😀é', null]) trace.apply(model('s', { value }));
    trace.run([model('s', { value: 'A😀é' }), model('s', { path: '/0' })]);
    for (const value of trace.models('s')) expect(value).toStrictEqual({ '1': '\ud83d', '2': '\ude00', '3': 'é' });
    trace.run([model('s', { path: '///', value: null })]);
    for (const value of trace.models('s')) expect(value).toBeNull();
    trace.run([model('s', { path: '///' }), model('s', { path: '//nested///value/', value: 5 })]);
    for (const value of trace.models('s')) expect(value).toStrictEqual({ nested: { value: 5 } });
  });

  test('deletes absent, staged and live surfaces and recreates them without old state', () => {
    const trace = oracle();
    trace.run([
      remove('absent'), create('staged'), model('staged', { value: { discarded: true } }), remove('staged'), root('staged'), create('staged'),
      model('only-model', { path: '/discarded', value: true }), remove('only-model'), create('only-model'), root('only-model'),
      create('10'), root('10'), model('staged', { value: { live: true } }), remove('staged'), remove('staged'),
      components('staged', [{ id: 'old', component: 'Text' }]), remove('staged'), create('staged'), root('staged'),
    ]);
    for (const snapshot of trace.snapshots()) {
      expect(snapshot.surfaces.map((s) => s.surfaceId)).toStrictEqual(['only-model', '10', 'staged']);
      expect(snapshot.surfaces[2].components.map((c) => c.id)).toStrictEqual(['root']);
      expect(snapshot.surfaces[2].dataModel).toStrictEqual({});
    }
  });

  test('strict comparison detects presence, holes and ordered-map differences', () => {
    expect({ present: undefined }).not.toStrictEqual({});
    expect([undefined]).not.toStrictEqual(new Array(1));
    expect(normalize(new Map())).not.toStrictEqual({ surfaces: [undefined] });
    const trace = oracle();
    trace.run([create('10'), root('10'), create('2'), root('2')]);
    const snapshot = trace.snapshots()[0];
    expect(snapshot).not.toStrictEqual({ surfaces: [...snapshot.surfaces].reverse() });
  });
});

describe('neutral-only own-property safety (outside legacy parity)', () => {
  test('treats prototype-like path names as own data without inherited traversal', () => {
    const owner = createA2uiSurfaces();
    [create('s'), root('s'), model('s', { path: '/__proto__/polluted', value: true }), model('s', { path: '/constructor/prototype/local', value: 'own' })].forEach(owner.apply);
    const value = owner.getSnapshot().surfaces[0].dataModel as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value['__proto__']).toStrictEqual({ polluted: true });
    expect(Object.hasOwn(value, 'constructor')).toBe(true);
    expect(value['constructor']).toStrictEqual({ prototype: { local: 'own' } });
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'local')).toBe(false);
  });

  test('preserves explicit undefined, own prototype-like keys and sparse host-array holes', () => {
    const owner = createA2uiSurfaces();
    const record = Object.create(null);
    Object.defineProperty(record, '__proto__', { value: { own: undefined }, enumerable: true });
    const sparse = new Array(3);
    sparse[1] = undefined;
    // Legacy spreads densify sparse arrays on path writes; deliberately no parity claim.
    [create('s'), root('s'), model('s', { value: { record, sparse } }), model('s', { path: '/sparse/2', value: 'last' })].forEach(owner.apply);
    const value = owner.getSnapshot().surfaces[0].dataModel as { record: Record<string, unknown>; sparse: unknown[] };
    expect(Object.getPrototypeOf(value.record)).toBeNull();
    expect(Object.hasOwn(value.record, '__proto__')).toBe(true);
    expect(value.record['__proto__']).toStrictEqual({ own: undefined });
    expect(Object.hasOwn(value.record['__proto__'] as object, 'own')).toBe(true);
    expect(Object.hasOwn(value.sparse, '0')).toBe(false);
    expect(Object.hasOwn(value.sparse, '1')).toBe(true);
    expect(value.sparse[1]).toBeUndefined();
    expect(value.sparse[2]).toBe('last');
  });
});
