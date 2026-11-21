import { describe, expect, test } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createA2uiSurfaceStore } from './surface-store';
import type { A2uiComponent, A2uiMessage } from '@threadplane/a2ui';

function setup() {
  let store!: ReturnType<typeof createA2uiSurfaceStore>;
  TestBed.configureTestingModule({});
  TestBed.runInInjectionContext(() => {
    store = createA2uiSurfaceStore();
  });
  return store;
}

const BASIC = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

const createSurface = (surfaceId: string, extra?: Record<string, unknown>): A2uiMessage =>
  ({ version: 'v0.9', createSurface: { surfaceId, catalogId: BASIC, ...extra } } as A2uiMessage);
const updateComponents = (surfaceId: string, components: A2uiComponent[]): A2uiMessage =>
  ({ version: 'v0.9', updateComponents: { surfaceId, components } } as A2uiMessage);
const updateDataModel = (surfaceId: string, body: Record<string, unknown>): A2uiMessage =>
  ({ version: 'v0.9', updateDataModel: { surfaceId, ...body } } as A2uiMessage);

describe('A2uiSurfaceStore (v0.9, root-gated progressive rendering)', () => {
  test('starts with no surfaces', () => {
    const store = setup();
    expect(store.surfaces().size).toBe(0);
  });

  test('createSurface alone does not expose a surface', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    expect(store.surfaces().size).toBe(0);
  });

  test('components without createSurface stay buffered', () => {
    const store = setup();
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Card', child: 'inner' } as A2uiComponent,
    ]));
    expect(store.surfaces().size).toBe(0);
  });

  test('surface commits once createSurface + root component are both present', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'inner', component: 'Text', text: 'Hi' } as A2uiComponent,
    ]));
    expect(store.surfaces().size).toBe(0); // no root yet
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Card', child: 'inner' } as A2uiComponent,
    ]));
    const s = store.surfaces().get('s1');
    expect(s).toBeDefined();
    expect(s?.components.size).toBe(2);
    expect(s?.catalogId).toBe(BASIC);
  });

  test('components arriving before createSurface commit as soon as it arrives', () => {
    const store = setup();
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'Hi' } as A2uiComponent,
    ]));
    store.apply(createSurface('s1'));
    expect(store.surfaces().get('s1')?.components.has('root')).toBe(true);
  });

  test('pre-commit updateDataModel deltas fold into the initial data model', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateDataModel('s1', { path: '/title', value: 'Hello' }));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: { path: '/title' } } as A2uiComponent,
    ]));
    expect(store.surfaces().get('s1')?.dataModel).toEqual({ title: 'Hello' });
  });

  test('post-commit updateComponents merges by id (incremental, no re-commit gate)', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'a' } as A2uiComponent,
    ]));
    store.apply(updateComponents('s1', [
      { id: 'extra', component: 'Text', text: 'b' } as A2uiComponent,
    ]));
    const s = store.surfaces().get('s1');
    expect(s?.components.size).toBe(2);
    expect((s?.components.get('root') as { text?: unknown })?.text).toBe('a');
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'c' } as A2uiComponent,
    ]));
    expect((store.surfaces().get('s1')?.components.get('root') as { text?: unknown })?.text).toBe('c');
  });

  test('post-commit updateDataModel writes value at path', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'x' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/count', value: 7 }));
    expect(store.surfaces().get('s1')?.dataModel).toEqual({ count: 7 });
  });

  test('updateDataModel with omitted path replaces the whole model', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'x' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/a', value: 1 }));
    store.apply(updateDataModel('s1', { value: { b: 2 } }));
    expect(store.surfaces().get('s1')?.dataModel).toEqual({ b: 2 });
  });

  test('updateDataModel with omitted value deletes the key at path', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'x' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/a', value: 1 }));
    store.apply(updateDataModel('s1', { path: '/b', value: 2 }));
    store.apply(updateDataModel('s1', { path: '/a' }));
    expect(store.surfaces().get('s1')?.dataModel).toEqual({ b: 2 });
  });

  test('createSurface for an existing live surface is an idempotent refresh', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'x' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/a', value: 1 }));
    store.apply(createSurface('s1', { sendDataModel: true }));
    const s = store.surfaces().get('s1');
    expect(s?.components.size).toBe(1);
    expect(s?.dataModel).toEqual({ a: 1 });
    expect(s?.sendDataModel).toBe(true);
  });

  test('captures theme + sendDataModel from createSurface', () => {
    const store = setup();
    store.apply(createSurface('s1', { theme: { primaryColor: '#FF6633' }, sendDataModel: true }));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'hi' } as A2uiComponent,
    ]));
    const s = store.surfaces().get('s1')!;
    expect(s.theme).toEqual({ primaryColor: '#FF6633' });
    expect(s.sendDataModel).toBe(true);
  });

  test('deleteSurface clears buffer and committed surface', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'x' } as A2uiComponent,
    ]));
    expect(store.surfaces().size).toBe(1);
    store.apply({ version: 'v0.9', deleteSurface: { surfaceId: 's1' } } as A2uiMessage);
    expect(store.surfaces().size).toBe(0);
  });

  test('updateDataModel for an unknown surface with no components is buffered, not thrown', () => {
    const store = setup();
    store.apply(updateDataModel('s1', { path: '/name', value: 'B' }));
    expect(store.surfaces().size).toBe(0);
  });

  test('surface() returns a signal for a specific surface', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'hi' } as A2uiComponent,
    ]));
    const s = store.surface('s1');
    expect(s()).toBeDefined();
    expect(s()!.surfaceId).toBe('s1');
  });
});

describe('createA2uiSurfaceStore — applyPartialArgs', () => {
  test('dispatches each envelope via apply() in order', () => {
    const store = setup();
    const envelopes = [
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: BASIC } },
      { version: 'v0.9', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    ] as A2uiMessage[];
    store.applyPartialArgs('tc-1', envelopes);
    expect(store.surfaces().get('s1')?.components.has('root')).toBe(true);
  });

  test('records the tool_call_id as live (queryable)', () => {
    const store = setup();
    expect(store.isPartialLive('tc-1')).toBe(false);
    store.applyPartialArgs('tc-1', [
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: BASIC } } as A2uiMessage,
    ]);
    expect(store.isPartialLive('tc-1')).toBe(true);
  });

  test('ignores invalid envelopes silently', () => {
    const store = setup();
    store.applyPartialArgs('tc-x', [{ junk: 1 } as never]);
    expect(store.surfaces().size).toBe(0);
    expect(store.isPartialLive('tc-x')).toBe(true); // still tracked
  });
});

describe('A2uiSurfaceStore — per-component readiness', () => {
  test('extracts bindings from a component on updateComponents apply', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'TextField', label: 'Name', value: '{$.form.name}' } as A2uiComponent,
    ]));
    const view = store.surfaceState('s1')()!.componentViews.get('root')!;
    expect(view.bindings).toEqual(['$.form.name']);
    expect(view.type).toBe('TextField');
  });

  test('component.ready is false when bindings are unpopulated', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'TextField', label: 'Name', value: '{$.form.name}' } as A2uiComponent,
    ]));
    expect(store.surfaceState('s1')()!.componentViews.get('root')!.ready).toBe(false);
  });

  test('component.ready becomes true when bindings are populated by updateDataModel', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'TextField', label: 'Name', value: '{$.form.name}' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/form', value: { name: 'Ada' } }));
    const view = store.surfaceState('s1')()!.componentViews.get('root')!;
    expect(view.ready).toBe(true);
    expect(view.props['value']).toBe('Ada');
  });

  test('resolveProps substitutes partial references (mixed literal + {$.path}) in props', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'Hello {$.name}!' } as A2uiComponent,
    ]));
    const initialView = store.surfaceState('s1')()!.componentViews.get('root')!;
    expect(initialView.bindings).toEqual(['$.name']);
    expect(initialView.ready).toBe(false);

    store.apply(updateDataModel('s1', { path: '/name', value: 'Ada' }));
    const view = store.surfaceState('s1')()!.componentViews.get('root')!;
    expect(view.ready).toBe(true);
    expect(view.props['text']).toBe('Hello Ada!');
  });

  test('component.ready stays true after a later update clears a binding (monotonic)', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'TextField', label: 'n', value: '{$.name}' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/name', value: 'Ada' }));
    expect(store.surfaceState('s1')()!.componentViews.get('root')!.ready).toBe(true);
    store.apply(updateDataModel('s1', { path: '/name' }));
    expect(store.surfaceState('s1')()!.componentViews.get('root')!.ready).toBe(true);
  });

  test('multiple components have independent readiness', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'TextField', label: 'a', value: '{$.x}' } as A2uiComponent,
      { id: 'b', component: 'TextField', label: 'b', value: '{$.y}' } as A2uiComponent,
    ]));
    store.apply(updateDataModel('s1', { path: '/x', value: '1' }));
    const state = store.surfaceState('s1')()!;
    expect(state.componentViews.get('root')!.ready).toBe(true);
    expect(state.componentViews.get('b')!.ready).toBe(false);
  });

  test('reserved base keys are stripped from resolved props', () => {
    const store = setup();
    store.apply(createSurface('s1'));
    store.apply(updateComponents('s1', [
      { id: 'root', component: 'Text', text: 'Hi', weight: 2 } as A2uiComponent,
    ]));
    const view = store.surfaceState('s1')()!.componentViews.get('root')!;
    expect(view.ready).toBe(true);
    expect(view.props['id']).toBeUndefined();
    expect(view.props['component']).toBeUndefined();
    expect(view.props['text']).toBe('Hi');
  });
});
