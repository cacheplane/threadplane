import { afterEach, describe, expect, it } from 'vitest';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';
import { RenderSpecComponent } from '../render-spec.component';
import { RenderElementComponent } from '../render-element.component';
import { defineAngularRegistry } from '../define-angular-registry';
import { signalStateStore } from '../signal-state-store';
import {
  resolveRenderTree,
  ɵRENDER_DEVTOOLS,
  type RenderDevtoolsHook,
  type RenderResolution,
} from './render-devtools';

@Component({
  selector: 'render-test-box',
  standalone: true,
  imports: [RenderElementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-box>@for (key of childKeys(); track key) {<render-element [elementKey]="key" [spec]="spec()" />}</div>`,
})
class BoxComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
}

@Component({ selector: 'render-test-text', standalone: true, template: '<span data-text>{{ label() }}</span>' })
class TextComponent {
  readonly label = input<string>();
}

@Component({ selector: 'render-test-fallback', standalone: true, template: '<span data-fallback></span>' })
class FallbackComponent {}

/** A component that renders a nested spec of its own. */
@Component({
  selector: 'render-test-nested',
  standalone: true,
  imports: [RenderSpecComponent],
  template: `<render-spec [spec]="inner" [registry]="registry" />`,
})
class NestedComponent {
  readonly inner: Spec = { root: 'inner', elements: { inner: { type: 'Text', props: { label: 'inner' }, children: [] } } };
  readonly registry = defineAngularRegistry({ Text: TextComponent });
}

const registry = defineAngularRegistry({
  Box: BoxComponent,
  Text: { component: TextComponent, fallback: FallbackComponent },
  Nested: NestedComponent,
});

/** A hook that records every `changed` call and reads on demand. */
function recordingHook() {
  const reads: Array<() => RenderResolution | null> = [];
  const hook: RenderDevtoolsHook = { changed: (read) => reads.push(read) };
  return {
    hook,
    calls: () => reads.length,
    latest: () => reads.at(-1)?.() ?? null,
    states: () => Object.fromEntries((reads.at(-1)?.()?.elements ?? []).map((e) => [e.key, e.state])),
  };
}

function render(spec: Spec, hook: RenderDevtoolsHook | null, store = signalStateStore({})) {
  TestBed.configureTestingModule({
    imports: [RenderSpecComponent],
    providers: hook ? [{ provide: ɵRENDER_DEVTOOLS, useValue: hook }] : [],
  });
  const fx = TestBed.createComponent(RenderSpecComponent);
  fx.componentRef.setInput('spec', spec);
  fx.componentRef.setInput('registry', registry);
  fx.componentRef.setInput('store', store);
  fx.detectChanges();
  return fx;
}

/** Defines `props` as a getter that throws, so any read of it fails the test. */
function withUnreadableProps<T extends object>(element: T): T {
  Object.defineProperty(element, 'props', {
    enumerable: true,
    get() {
      throw new Error('devtools read an element prop');
    },
  });
  return element;
}

describe('render devtools: resolveRenderTree', () => {
  it('reads structure only: root first, depth-first, then unreferenced elements; never props', () => {
    const spec = {
      root: 'root',
      elements: {
        orphan: withUnreadableProps({ type: 'Text', children: [] }),
        b: withUnreadableProps({ type: 'Text', children: [] }),
        root: withUnreadableProps({ type: 'Box', children: ['a', 'b'] }),
        a: withUnreadableProps({ type: 'Mystery', children: ['a1'] }),
        a1: withUnreadableProps({ type: 'Text', children: [] }),
      },
    } as unknown as Spec;
    const live = [
      { key: () => 'root', state: () => 'mounted' as const },
      { key: () => 'b', state: () => 'fallback' as const },
      { key: () => 'b', state: () => 'mounted' as const },
      { key: () => 'a', state: () => 'unresolved' as const },
    ];

    const resolution = resolveRenderTree(spec, registry, live as never);

    expect(resolution).toEqual({
      root: 'root',
      registry: ['Box', 'Text', 'Nested'],
      elements: [
        { key: 'root', type: 'Box', state: 'mounted' },
        { key: 'a', type: 'Mystery', state: 'unresolved' },
        { key: 'a1', type: 'Text', state: 'hidden' },
        { key: 'b', type: 'Text', state: 'mounted' },
        { key: 'orphan', type: 'Text', state: 'hidden' },
      ],
    });
  });

  it('returns null for a spec without a root', () => {
    expect(resolveRenderTree({ elements: {} } as unknown as Spec, registry, [])).toBeNull();
  });
});

describe('render devtools: <render-spec> with a hook', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('marks an unknown type unresolved and everything under it hidden', () => {
    const rec = recordingHook();
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'Box', props: {}, children: ['ok', 'mystery'] },
        ok: { type: 'Text', props: { label: 'hi' }, children: [] },
        mystery: { type: 'Mystery', props: {}, children: ['under'] },
        // Never rendered, so nothing may read its props — including devtools.
        under: withUnreadableProps({ type: 'Text', children: ['deeper'] }),
        deeper: withUnreadableProps({ type: 'Text', children: [] }),
      },
    } as unknown as Spec;

    render(spec, rec.hook);

    expect(rec.calls()).toBeGreaterThan(0);
    expect(rec.latest()?.elements).toEqual([
      { key: 'root', type: 'Box', state: 'mounted' },
      { key: 'ok', type: 'Text', state: 'mounted' },
      { key: 'mystery', type: 'Mystery', state: 'unresolved' },
      { key: 'under', type: 'Text', state: 'hidden' },
      { key: 'deeper', type: 'Text', state: 'hidden' },
    ]);
  });

  it('reports fallback while a bound prop is unresolved, then mounted', () => {
    const rec = recordingHook();
    const store = signalStateStore({});
    const fx = render(
      { root: 't', elements: { t: { type: 'Text', props: { label: { $state: '/name' } }, children: [] } } },
      rec.hook,
      store,
    );
    expect(fx.nativeElement.querySelector('[data-fallback]')).toBeTruthy();
    expect(rec.states()).toEqual({ t: 'fallback' });

    store.set('/name', 'Ada');
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-text]')).toBeTruthy();
    expect(rec.states()).toEqual({ t: 'mounted' });
  });

  it('reports visible:false as hidden, children of a hidden or fallback parent as hidden', () => {
    const rec = recordingHook();
    render(
      {
        root: 'root',
        elements: {
          root: { type: 'Box', props: {}, children: ['gone', 'waiting'] },
          gone: { type: 'Box', props: {}, visible: false, children: ['g1'] },
          g1: { type: 'Text', props: { label: 'x' }, children: [] },
          waiting: { type: 'Text', props: { label: { $state: '/missing' } }, children: ['w1'] },
          w1: { type: 'Text', props: { label: 'y' }, children: [] },
        },
      } as unknown as Spec,
      rec.hook,
    );
    expect(rec.states()).toEqual({ root: 'mounted', gone: 'hidden', g1: 'hidden', waiting: 'fallback', w1: 'hidden' });
  });

  it('reports a repeat by its most-rendered row, and an empty repeat as hidden', () => {
    const rec = recordingHook();
    const store = signalStateStore({ rows: [] });
    const fx = render(
      { root: 'r', elements: { r: { type: 'Text', props: { label: { $item: 'name' } }, repeat: { statePath: '/rows' }, children: [] } } } as unknown as Spec,
      rec.hook,
      store,
    );
    expect(rec.states()).toEqual({ r: 'hidden' });
    store.set('/rows', [{}, { name: 'b' }]);
    fx.detectChanges();
    expect(rec.states()).toEqual({ r: 'mounted' });
  });

  it('lets a nested spec report only through a hook provided closer to it', () => {
    const rec = recordingHook();
    render({ root: 'n', elements: { n: { type: 'Nested', props: {}, children: [] } } }, rec.hook);
    expect(rec.latest()).toEqual({ root: 'n', registry: ['Box', 'Text', 'Nested'], elements: [{ key: 'n', type: 'Nested', state: 'mounted' }] });
  });

  it('adds no prop reads: the same spec reads props the same number of times with and without the hook', () => {
    function countingSpec() {
      let reads = 0;
      const props = {} as Record<string, unknown>;
      Object.defineProperty(props, 'label', { enumerable: true, get: () => { reads += 1; return 'hi'; } });
      const spec = { root: 't', elements: { t: { type: 'Text', props, children: [] } } } as unknown as Spec;
      return { spec, reads: () => reads };
    }
    const without = countingSpec();
    const fx1 = render(without.spec, null);
    fx1.detectChanges();
    TestBed.resetTestingModule();

    const rec = recordingHook();
    const withHook = countingSpec();
    const fx2 = render(withHook.spec, rec.hook);
    fx2.detectChanges();
    const before = withHook.reads();
    expect(rec.latest()?.elements).toEqual([{ key: 't', type: 'Text', state: 'mounted' }]);
    expect(rec.states()).toEqual({ t: 'mounted' });

    expect(withHook.reads()).toBe(before);
    expect(withHook.reads()).toBe(without.reads());
  });

  it('creates no tracker and calls nothing without a hook', () => {
    const fx = render({ root: 't', elements: { t: { type: 'Text', props: { label: 'x' }, children: [] } } }, null);
    expect(fx.componentInstance._devtoolsTracker).toBeNull();
  });
});
