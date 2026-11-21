import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createPartialJsonParser } from '@cacheplane/partial-json';
import type { Spec } from '@json-render/core';
import { createParseTreeStore } from './parse-tree-store';

describe('ParseTreeStore', () => {
  function setup() {
    const parser = createPartialJsonParser();
    let store!: ReturnType<typeof createParseTreeStore>;
    TestBed.runInInjectionContext(() => {
      store = createParseTreeStore(parser);
    });
    return { parser, store };
  }

  it('spec is null initially', () => {
    const { store } = setup();
    expect(store.spec()).toBeNull();
  });

  it('elementStates is empty initially', () => {
    const { store } = setup();
    expect(store.elementStates().size).toBe(0);
  });

  it('materializes a complete spec from streamed JSON', () => {
    const { store } = setup();
    const json = JSON.stringify({
      root: 'el-1',
      elements: {
        'el-1': { type: 'card', props: { title: 'Hello' }, children: ['el-2'] },
        'el-2': { type: 'text', props: { content: 'World' } },
      },
    });
    store.push(json);
    const spec = store.spec() as Spec;
    expect(spec).not.toBeNull();
    expect(spec.root).toBe('el-1');
    expect(spec.elements['el-1'].type).toBe('card');
    expect(spec.elements['el-2'].type).toBe('text');
  });

  it('updates spec incrementally as tokens stream', () => {
    const { store } = setup();
    const json = '{"root":"el-1","elements":{"el-1":{"type":"card","props":{"title":"Hi"}}}}';

    // Feed partial chunks
    store.push('{"root":');
    const spec1 = store.spec();
    expect(spec1).not.toBeNull();

    store.push('"el-1","elements":{');
    const spec2 = store.spec();
    expect(spec2).not.toBeNull();
    expect((spec2 as any).root).toBe('el-1');

    store.push('"el-1":{"type":"card","props":{"title":"Hi"}}}}');
    const spec3 = store.spec() as Spec;
    expect(spec3.root).toBe('el-1');
    expect(spec3.elements['el-1'].type).toBe('card');
  });

  it('preserves structural sharing for unchanged elements', () => {
    const { store } = setup();

    // Push a complete first element
    store.push('{"root":"el-1","elements":{"el-1":{"type":"card","props":{"title":"A"}}');
    const spec1 = store.spec() as any;
    const el1Ref = spec1?.elements?.['el-1'];

    // Push more data that doesn't change el-1
    store.push(',"el-2":{"type":"text","props":{"content":"B"}}}}');
    const spec2 = store.spec() as any;

    // el-1 subtree should be structurally shared (same reference)
    expect(spec2.elements['el-1']).toBe(el1Ref);
  });

  it('tracks element accumulation states for hasType and hasProps', () => {
    const { store } = setup();

    store.push('{"root":"el-1","elements":{"el-1":{"type":"card"');
    let states = store.elementStates();
    const el1State = states.get('el-1');
    expect(el1State).toBeDefined();
    expect(el1State!.hasType).toBe(true);
    expect(el1State!.hasProps).toBe(false);

    store.push(',"props":{"title":"Hi"}}}}');
    states = store.elementStates();
    const el1StateAfter = states.get('el-1');
    expect(el1StateAfter!.hasType).toBe(true);
    expect(el1StateAfter!.hasProps).toBe(true);
  });

  it('tracks hasChildren state', () => {
    const { store } = setup();

    store.push('{"root":"el-1","elements":{"el-1":{"type":"card","props":{}');
    let states = store.elementStates();
    expect(states.get('el-1')?.hasChildren).toBe(false);

    store.push(',"children":["el-2"]}}}');
    states = store.elementStates();
    expect(states.get('el-1')?.hasChildren).toBe(true);
  });

  it('tracks streaming state per element', () => {
    const { store } = setup();

    // Start streaming an element
    store.push('{"root":"el-1","elements":{"el-1":{"type":"card"');
    let states = store.elementStates();
    expect(states.get('el-1')?.streaming).toBe(true);

    // Complete the element
    store.push(',"props":{}}}}');
    states = store.elementStates();
    // After closing brace the element object is complete
    expect(states.get('el-1')?.streaming).toBe(false);
  });
});
