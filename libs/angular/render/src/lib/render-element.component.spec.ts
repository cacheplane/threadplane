import { describe, it, expect, beforeEach } from 'vitest';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { z } from 'zod/v4';
import { isElementReady } from './internals/element-readiness';
import { DefaultFallbackComponent } from './default-fallback.component';
import type { Spec } from '@json-render/core';
import {
  evaluateVisibility,
  resolveBindings,
  resolveElementProps,
} from '@json-render/core';

import { defineAngularRegistry } from './define-angular-registry';
import { signalStateStore } from './signal-state-store';
import { buildPropResolutionContext } from './internals/prop-signal';

// --- Test components ---

@Component({
  selector: 'render-test-text',
  standalone: true,
  template: '<span>{{ label() }}</span>',
})
class TestTextComponent {
  readonly label = input<string>('');
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | null>(null);
}

// --- Helpers ---

function createSpec(elements: Record<string, unknown>, root = 'root'): Spec {
  return { root, elements } as Spec;
}

/**
 * These tests verify the rendering pipeline logic (element lookup, prop
 * resolution, visibility, repeat) at the unit level. Because this repo's
 * Vitest setup does not include the Angular template compiler plugin,
 * we test the pipeline functions and registry lookups directly rather
 * than rendering templates.
 */
describe('RenderElementComponent — pipeline logic', () => {
  it('should look up element from spec and resolve component class', () => {
    const registry = defineAngularRegistry({ Text: TestTextComponent });
    const spec = createSpec({
      root: { type: 'Text', props: { label: 'Hello' } },
    });
    const el = spec.elements['root'];
    expect(el).toBeDefined();
    expect(el.type).toBe('Text');
    expect(registry.getEntry(el.type)?.component).toBe(TestTextComponent);
  });

  it('should return undefined for unknown element type', () => {
    const registry = defineAngularRegistry({ Text: TestTextComponent });
    const spec = createSpec({
      root: { type: 'UnknownWidget', props: { label: 'Nope' } },
    });
    const el = spec.elements['root'];
    expect(registry.getEntry(el.type)).toBeUndefined();
  });

  it('should return undefined for missing element key', () => {
    const spec = createSpec({
      root: { type: 'Text', props: { label: 'Hello' } },
    });
    expect(spec.elements['nonexistent']).toBeUndefined();
  });

  it('should resolve $state prop expressions', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ count: 42 });
      const ctx = buildPropResolutionContext(store);
      const props = { count: { $state: '/count' } };
      const resolved = resolveElementProps(props, ctx);
      expect(resolved['count']).toBe(42);
    });
  });

  it('should evaluate visibility as hidden when state is falsy', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ show: false });
      const ctx = buildPropResolutionContext(store);
      const result = evaluateVisibility({ $state: '/show' }, ctx);
      expect(result).toBe(false);
    });
  });

  it('should evaluate visibility as visible when state is truthy', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ show: true });
      const ctx = buildPropResolutionContext(store);
      const result = evaluateVisibility({ $state: '/show' }, ctx);
      expect(result).toBe(true);
    });
  });

  it('should evaluate visibility as true when condition is undefined', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({});
      const ctx = buildPropResolutionContext(store);
      const result = evaluateVisibility(undefined, ctx);
      expect(result).toBe(true);
    });
  });

  it('should resolve bindings from $bindState expressions', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ form: { email: 'test@example.com' } });
      const ctx = buildPropResolutionContext(store);
      const props = { value: { $bindState: '/form/email' }, label: 'Email' };
      const bindings = resolveBindings(props, ctx);
      expect(bindings).toEqual({ value: '/form/email' });
    });
  });

  it('should resolve repeat item props via $item expression', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ items: ['A', 'B', 'C'] });
      const repeatScope = { item: 'B', index: 1, basePath: '/items/1' };
      const ctx = buildPropResolutionContext(store, repeatScope);
      const props = { label: { $item: '' } };
      const resolved = resolveElementProps(props, ctx);
      expect(resolved['label']).toBe('B');
    });
  });

  it('should resolve $index in repeat scope', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ items: ['A', 'B'] });
      const repeatScope = { item: 'B', index: 1, basePath: '/items/1' };
      const ctx = buildPropResolutionContext(store, repeatScope);
      const props = { idx: { $index: true } };
      const resolved = resolveElementProps(props, ctx);
      expect(resolved['idx']).toBe(1);
    });
  });

  it('should include childKeys and spec in resolved inputs structure', () => {
    const spec = createSpec({
      root: { type: 'Text', props: { label: 'Hello' }, children: ['child1', 'child2'] },
      child1: { type: 'Text', props: { label: 'C1' } },
      child2: { type: 'Text', props: { label: 'C2' } },
    });
    const el = spec.elements['root'];
    // The component passes childKeys from element.children
    const childKeys = el.children ?? [];
    expect(childKeys).toEqual(['child1', 'child2']);
  });

  it('should handle repeat by iterating state array items', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ items: ['A', 'B', 'C'] });
      const spec = createSpec({
        root: {
          type: 'Text',
          props: { label: { $item: '' } },
          repeat: { statePath: '/items' },
        },
      });
      const el = spec.elements['root'];
      const items = store.get(el.repeat!.statePath);
      expect(Array.isArray(items)).toBe(true);
      expect(items).toEqual(['A', 'B', 'C']);

      // Each item gets its own repeat scope and resolved props
      const results = (items as string[]).map((item, index) => {
        const scope = { item, index, basePath: `${el.repeat!.statePath}/${index}` };
        const ctx = buildPropResolutionContext(store, scope);
        return resolveElementProps(el.props ?? {}, ctx);
      });
      expect(results[0]['label']).toBe('A');
      expect(results[1]['label']).toBe('B');
      expect(results[2]['label']).toBe('C');
    });
  });
});

/**
 * Children rendering tests (Task 9).
 *
 * Verify that the recursive rendering pattern works: a parent Container
 * receives childKeys and spec, and each child element can be resolved
 * independently from the same spec.
 */
describe('RenderElementComponent — children rendering', () => {
  it('should pass childKeys and spec to the rendered component', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const registry = defineAngularRegistry({ Container: TestTextComponent, Text: TestTextComponent });
      const store = signalStateStore({ title: 'Parent' });
      const spec = createSpec({
        root: {
          type: 'Container',
          props: { label: 'Parent' },
          children: ['heading', 'body'],
        },
        heading: { type: 'Text', props: { label: 'Heading' } },
        body: { type: 'Text', props: { label: 'Body' } },
      });

      const rootEl = spec.elements['root'];
      const ctx = buildPropResolutionContext(store);
      const resolved = resolveElementProps(rootEl.props ?? {}, ctx);
      const bindings = resolveBindings(rootEl.props ?? {}, ctx);

      // Simulate what resolvedInputs computes
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const noopEmit = (): void => {};
      const inputs = {
        ...resolved,
        bindings,
        emit: noopEmit,
        loading: false,
        childKeys: rootEl.children ?? [],
        spec,
      };

      // Container receives childKeys pointing to its children
      expect(inputs.childKeys).toEqual(['heading', 'body']);
      expect(inputs.spec).toBe(spec);

      // Each child can be resolved from the same spec
      for (const childKey of inputs.childKeys) {
        const childEl = spec.elements[childKey];
        expect(childEl).toBeDefined();
        expect(registry.getEntry(childEl.type)?.component).toBe(TestTextComponent);
      }
    });
  });

  it('should resolve child props independently from parent', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({ greeting: 'Hi', name: 'World' });
      const spec = createSpec({
        root: {
          type: 'Container',
          props: {},
          children: ['greeting', 'name'],
        },
        greeting: { type: 'Text', props: { label: { $state: '/greeting' } } },
        name: { type: 'Text', props: { label: { $state: '/name' } } },
      });

      const ctx = buildPropResolutionContext(store);

      // Resolve children
      const greetingEl = spec.elements['greeting'];
      const greetingResolved = resolveElementProps(greetingEl.props ?? {}, ctx);
      expect(greetingResolved['label']).toBe('Hi');

      const nameEl = spec.elements['name'];
      const nameResolved = resolveElementProps(nameEl.props ?? {}, ctx);
      expect(nameResolved['label']).toBe('World');
    });
  });

  it('should support deeply nested children (recursive tree)', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const store = signalStateStore({});
      const spec = createSpec({
        root: {
          type: 'Container',
          props: {},
          children: ['level1'],
        },
        level1: {
          type: 'Container',
          props: {},
          children: ['level2'],
        },
        level2: {
          type: 'Container',
          props: {},
          children: ['leaf'],
        },
        leaf: {
          type: 'Text',
          props: { label: 'Deep Leaf' },
        },
      });

      // Walk the tree recursively
      function getLeafLabels(key: string): string[] {
        const el = spec.elements[key];
        if (!el) return [];
        const children = el.children ?? [];
        if (children.length === 0) {
          const ctx = buildPropResolutionContext(store);
          const resolved = resolveElementProps(el.props ?? {}, ctx);
          return [resolved['label'] as string];
        }
        return children.flatMap(getLeafLabels);
      }

      const labels = getLeafLabels('root');
      expect(labels).toEqual(['Deep Leaf']);
    });
  });

  it('should handle element with empty children array', () => {
    const spec = createSpec({
      root: { type: 'Container', props: {}, children: [] },
    });
    const el = spec.elements['root'];
    expect(el.children).toEqual([]);
  });

  it('should handle element with no children property', () => {
    const spec = createSpec({
      root: { type: 'Text', props: { label: 'No children' } },
    });
    const el = spec.elements['root'];
    // children defaults to undefined; component uses ?? []
    const childKeys = el.children ?? [];
    expect(childKeys).toEqual([]);
  });
});

describe('RenderElementComponent — handler injection context', () => {
  it('should allow handlers to call inject() inside runInInjectionContext', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { Injector, runInInjectionContext, inject, DestroyRef } = require('@angular/core');
      const injector = Injector.create({ providers: [] });

      let destroyRefAccessed = false;
      const handler = (params: Record<string, unknown>) => {
        // This would throw outside injection context
        runInInjectionContext(injector, () => {
          const dr = inject(DestroyRef);
          destroyRefAccessed = dr !== undefined;
        });
        return params;
      };

      const result = handler({ test: true });
      expect(destroyRefAccessed).toBe(true);
      expect(result).toEqual({ test: true });
    });
  });
});

describe('RenderElementComponent — element-level memoization', () => {
  it('element lookup returns same reference when spec changes but element is unchanged', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const { signal, computed } = require('@angular/core');

      // Simulate two spec snapshots with structural sharing:
      // el-1 is the same reference in both, el-2 is different
      const sharedEl1 = { type: 'Text', props: { label: 'Same' } };
      const spec1 = createSpec({
        root: { type: 'Container', props: {}, children: ['el-1', 'el-2'] },
        'el-1': sharedEl1,
        'el-2': { type: 'Text', props: { label: 'Old' } },
      });

      // spec2 reuses the same el-1 reference (structural sharing)
      const spec2 = {
        ...spec1,
        elements: {
          ...spec1.elements,
          'el-2': { type: 'Text', props: { label: 'New' } },
        },
      } as Spec;
      // el-1 is the SAME object reference
      expect(spec2.elements['el-1']).toBe(spec1.elements['el-1']);

      // Simulate what the component does: computed with Object.is equality
      const specSignal = signal(spec1);
      const elementKey = signal('el-1');
      const element = computed(
        () => specSignal()?.elements?.[elementKey()],
        { equal: Object.is },
      );

      const ref1 = element();
      expect(ref1).toBe(sharedEl1);

      // Update spec — el-1 reference unchanged due to structural sharing
      specSignal.set(spec2);
      const ref2 = element();
      // With Object.is equality, computed returns same reference
      expect(ref2).toBe(ref1);
    });
  });
});

// --- Fallback gate tests (Task 1.3) ---

import { TestBed } from '@angular/core/testing';
import { Component as Cmp2, Input } from '@angular/core';
import { RenderElementComponent } from './render-element.component';
import { RENDER_CONTEXT } from './contexts/render-context';

@Cmp2({ standalone: true, template: '<span data-test="real">label={{ label }}</span>' })
class FakeRealCmp {
  @Input() label?: string;
}

@Cmp2({ standalone: true, template: '<span data-test="fallback">SKEL</span>' })
class FakeFallbackCmp {}

function specWithBinding(): Spec {
  return {
    root: 'btn1',
    elements: {
      btn1: { type: 'button', props: { label: { $state: '/label' } } },
    },
  } as Spec;
}

@Cmp2({
  standalone: true,
  imports: [RenderElementComponent],
  template: `<render-element [elementKey]="'btn1'" [spec]="spec" />`,
})
class FallbackHost {
  spec = specWithBinding();
}

describe('RenderElementComponent — fallback gate', () => {
  let store: ReturnType<typeof signalStateStore>;
  beforeEach(() => {
    store = signalStateStore({ });
    TestBed.configureTestingModule({
      imports: [FallbackHost],
      providers: [{
        provide: RENDER_CONTEXT,
        useValue: {
          store,
          registry: defineAngularRegistry({
            button: { component: FakeRealCmp, fallback: FakeFallbackCmp },
          }),
          functions: {},
          handlers: {},
        },
      }],
    });
  });

  it('renders the fallback when a state-bound prop resolves to undefined', () => {
    const fx = TestBed.createComponent(FallbackHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="fallback"]')).toBeTruthy();
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeNull();
  });

  it('renders the real component once the state-bound prop is populated', () => {
    store.set('/label', 'click me');
    const fx = TestBed.createComponent(FallbackHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeTruthy();
    expect(fx.nativeElement.querySelector('[data-test="fallback"]')).toBeNull();
  });

  it('null counts as ready (not undefined)', () => {
    store.set('/label', null);
    const fx = TestBed.createComponent(FallbackHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeTruthy();
  });

  it('monotonic: once real mounts, a later undefined does not revert to fallback', async () => {
    store.set('/label', 'click me');
    const fx = TestBed.createComponent(FallbackHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeTruthy();

    // Flush microtasks so the mountedReal latch flips.
    await Promise.resolve();

    // Now CLEAR the binding — undefined again.
    store.set('/label', undefined);
    fx.detectChanges();
    // Still real, never reverts.
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeTruthy();
    expect(fx.nativeElement.querySelector('[data-test="fallback"]')).toBeNull();
  });
});

// --- RenderHost tests (Task 4) ---

import { Component as HostCmp, inject as hostInject } from '@angular/core';
import { injectRenderHost } from './contexts/render-host';
import type { RenderEvent } from './render-event';

@HostCmp({ standalone: true, template: '<button (click)="fire()">go</button>' })
class ResultEmitter {
  private readonly host = injectRenderHost();
  fire() { this.host.result({ picked: 2 }); }
}

@HostCmp({
  standalone: true,
  imports: [RenderElementComponent],
  template: `<render-element [elementKey]="'w1'" [spec]="spec" />`,
})
class ResultHost {
  spec = { root: 'w1', elements: { w1: { type: 'emitter', props: {} } } } as Spec;
}

describe('RenderElementComponent — RenderHost', () => {
  it('result(value) reaches the host as a RenderResultEvent', () => {
    const events: RenderEvent[] = [];
    const store = signalStateStore({});
    TestBed.configureTestingModule({
      imports: [ResultHost],
      providers: [{
        provide: RENDER_CONTEXT,
        useValue: {
          store,
          registry: defineAngularRegistry({ emitter: ResultEmitter }),
          functions: {},
          handlers: {},
          emitEvent: (e: RenderEvent) => events.push(e),
        },
      }],
    });
    const fx = TestBed.createComponent(ResultHost);
    fx.detectChanges();
    fx.nativeElement.querySelector('button').click();
    expect(events).toContainEqual({ type: 'result', value: { picked: 2 }, elementKey: 'w1' });
  });

  it('set(path, value) writes the render state store', () => {
    const store = signalStateStore({});
    @HostCmp({ standalone: true, template: '' })
    class SetterCmp {
      private readonly host = injectRenderHost();
      constructor() { this.host.set('/seats', 3); }
    }
    @HostCmp({
      standalone: true,
      imports: [RenderElementComponent],
      template: `<render-element [elementKey]="'s1'" [spec]="spec" />`,
    })
    class SetHost { spec = { root: 's1', elements: { s1: { type: 'setter', props: {} } } } as Spec; }
    TestBed.configureTestingModule({
      imports: [SetHost],
      providers: [{
        provide: RENDER_CONTEXT,
        useValue: { store, registry: defineAngularRegistry({ setter: SetterCmp }), functions: {}, handlers: {} },
      }],
    });
    const fx = TestBed.createComponent(SetHost);
    fx.detectChanges();
    expect(store.getSnapshot()).toMatchObject({ seats: 3 });
  });
});

// --- VIEW_REGISTRY token-fallback tests (Task 2) ---

import { RenderSpecComponent } from './render-spec.component';
import { provideRender } from './provide-render';
import { provideViews, VIEW_REGISTRY } from './provide-views';
import { views } from './views';

@Cmp2({ standalone: true, template: '<span data-test="token-comp">TOKEN</span>' })
class TokenComp {}

function specForTokenType(): Spec {
  return {
    root: 'el1',
    elements: {
      el1: { type: 'tokenType', props: {} },
    },
  } as Spec;
}

@Cmp2({
  standalone: true,
  imports: [RenderSpecComponent],
  template: `<render-spec [spec]="spec" />`,
})
class TokenRegistryHost {
  spec = specForTokenType();
}

describe('RenderSpecComponent — VIEW_REGISTRY token-fallback (Task 2)', () => {
  it('VIEW_REGISTRY token: renders component resolved from token when config has no registry', () => {
    // provideRender with no registry + provideViews with tokenType → TokenComp.
    // RenderSpecComponent should fall back to VIEW_REGISTRY and render TokenComp.
    TestBed.configureTestingModule({
      imports: [TokenRegistryHost],
      providers: [
        provideRender({}),
        provideViews(views({ tokenType: TokenComp })),
      ],
    });
    const fx = TestBed.createComponent(TokenRegistryHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="token-comp"]')).toBeTruthy();
  });

  it('null-path regression: unknown type with no registry anywhere renders nothing (mountClass null)', () => {
    // No registry at all — component for an unknown type is null → nothing renders.
    const emptyStore = signalStateStore({});
    TestBed.configureTestingModule({
      imports: [FallbackHost],
      providers: [{
        provide: RENDER_CONTEXT,
        useValue: {
          store: emptyStore,
          registry: defineAngularRegistry({}),
          functions: {},
          handlers: {},
        },
      }],
    });
    // btn1 has type 'button' but registry is empty — nothing should render.
    const fx = TestBed.createComponent(FallbackHost);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-test="real"]')).toBeNull();
    expect(fx.nativeElement.querySelector('[data-test="fallback"]')).toBeNull();
  });
});

// --- Readiness gate tests — schema-aware (RT3) ---

@Component({ selector: 'render-day-card', standalone: true, template: '<div>{{ day() }}</div>' })
class DayCardStub {
  readonly day = input.required<number>();
  readonly places = input.required<string[]>();
}

describe('RenderElementComponent — readiness gate (schema)', () => {
  const schema = z.object({ day: z.number(), places: z.array(z.string()) });
  const registry = defineAngularRegistry({
    day_card: { component: DayCardStub, fallback: DefaultFallbackComponent, schema },
  });

  it('is NOT ready (→ fallback) while streamed props miss required schema keys', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const ctx = buildPropResolutionContext(signalStateStore({}));
      // mid-stream: only status present, day/places absent
      const resolved = resolveElementProps({ status: 'running' }, ctx);
      expect(isElementReady(registry.getEntry('day_card'), resolved)).toBe(false);
      // → mountClass would pick the fallback (DefaultFallbackComponent), so the
      //   real DayCardStub (with input.required) never mounts: no NG0950.
      expect(registry.getEntry('day_card')?.fallback).toBe(DefaultFallbackComponent);
    });
  });

  it('IS ready (→ real component) once streamed props satisfy the schema', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const ctx = buildPropResolutionContext(signalStateStore({}));
      const resolved = resolveElementProps(
        { day: 2, places: ['Eiffel'], status: 'complete' },
        ctx,
      );
      expect(isElementReady(registry.getEntry('day_card'), resolved)).toBe(true);
      expect(registry.getEntry('day_card')?.component).toBe(DayCardStub);
    });
  });
});
