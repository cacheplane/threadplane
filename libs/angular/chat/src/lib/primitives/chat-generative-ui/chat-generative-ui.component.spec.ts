import { describe, it, expect, beforeEach } from 'vitest';
import { signal, computed } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Spec, StateStore } from '@json-render/core';
import { signalStateStore, toRenderRegistry } from '@threadplane/angular/render';
import { a2uiBasicCatalog } from '@threadplane/angular/a2ui';
import { ChatGenerativeUiComponent } from './chat-generative-ui.component';
import { normalizeJsonRenderSpec } from './normalize-json-render-spec';

const makeSpec = (root = 'root'): Spec =>
  ({ root, elements: { root: { type: 'div', props: {} } } } as any);

describe('ChatGenerativeUiComponent — spec input', () => {
  it('spec input defaults to null', () => {
    const spec$ = signal<Spec | null>(null);
    expect(spec$()).toBeNull();
  });

  it('renders when spec is present', () => {
    const spec$ = signal<Spec | null>(makeSpec());
    const shouldRender = computed(() => spec$() !== null);

    expect(shouldRender()).toBe(true);
  });

  it('does not render when spec is null', () => {
    const spec$ = signal<Spec | null>(null);
    const shouldRender = computed(() => spec$() !== null);

    expect(shouldRender()).toBe(false);
  });

  it('spec updates reactively', () => {
    const spec$ = signal<Spec | null>(null);
    const shouldRender = computed(() => spec$() !== null);

    expect(shouldRender()).toBe(false);
    spec$.set(makeSpec());
    expect(shouldRender()).toBe(true);
  });

  it('loading input defaults to false', () => {
    const loading$ = signal<boolean>(false);
    expect(loading$()).toBe(false);
  });

  it('loading can be set to true', () => {
    const loading$ = signal<boolean>(true);
    expect(loading$()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F4: json-render specs use the schema-documented `{ statePath: "/x" }` shape
// for state-bound props (the prompt in the example backends says:
//   props: { value: { statePath: "/name" } }
// and `state` carries the initial values). @json-render/core only resolves
// `$state`/`$bindState` expressions, so the raw object fell through to the
// view component and interpolated as the literal string "[object Object]".
// ─────────────────────────────────────────────────────────────────────────────

/** Spec fixture derived from the documented schema shapes (json_render.py):
 * a Text KPI bound via statePath + a Slider whose value/label bind via
 * statePath, with `state` carrying the initial value model. */
const statePathSpec = {
  root: 'col',
  elements: {
    col: { type: 'Column', props: { gap: 'medium' }, children: ['kpi', 'min'] },
    kpi: { type: 'Text', props: { text: { statePath: '/totalRevenue' }, variant: 'h3' } },
    min: {
      type: 'Slider',
      props: {
        label: 'Min revenue (USD)',
        value: { statePath: '/minRevenue' },
        min: 0,
        max: 100000,
      },
    },
  },
  state: { totalRevenue: '$1.2M', minRevenue: 25000 },
} as unknown as Spec;

describe('ChatGenerativeUiComponent — statePath resolution (F4)', () => {
  let fixture: ComponentFixture<ChatGenerativeUiComponent>;
  let store: StateStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChatGenerativeUiComponent] });
    fixture = TestBed.createComponent(ChatGenerativeUiComponent);
    // An EXPLICIT consumer-provided store (initially EMPTY) — replicate that
    // so spec.state seeding is exercised, not render-spec's internal store
    // creation. (The chat composition itself no longer passes its internal
    // store; only a consumer-supplied store reaches this input.)
    store = signalStateStore({});
    fixture.componentRef.setInput('registry', toRenderRegistry(a2uiBasicCatalog()));
    fixture.componentRef.setInput('store', store);
    fixture.componentRef.setInput('spec', statePathSpec);
  });

  function render(): string {
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('never renders "[object Object]" for statePath-bound props', () => {
    const text = render();
    expect(text).not.toContain('[object Object]');
  });

  it('resolves Text.text bound via statePath against spec.state', () => {
    const text = render();
    expect(text).toContain('$1.2M');
  });

  it('resolves Slider value bound via statePath (label shows the number)', () => {
    const text = render();
    expect(text).toContain('Min revenue (USD): 25000');
  });

  it('seeds spec.state into the provided store', () => {
    render();
    expect(store.get('/totalRevenue')).toBe('$1.2M');
    expect(store.get('/minRevenue')).toBe(25000);
  });

  it('writes slider input back to the bound state path', () => {
    render();
    const slider = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider).toBeTruthy();
    slider.value = '30000';
    slider.dispatchEvent(new Event('input'));
    expect(store.get('/minRevenue')).toBe(30000);
  });

  it('does not clobber user-modified state when the spec re-emits', () => {
    render();
    store.set('/minRevenue', 42000);
    // Re-emit the same spec object graph (streaming re-materializes specs).
    fixture.componentRef.setInput('spec', { ...statePathSpec } as Spec);
    render();
    expect(store.get('/minRevenue')).toBe(42000);
  });

  it('overwrites component-seeded partial chunk values when fuller state streams in', () => {
    // First emission carries a partial streaming chunk of the value.
    fixture.componentRef.setInput('spec', {
      ...statePathSpec,
      state: { totalRevenue: '$1.', minRevenue: 25000 },
    } as unknown as Spec);
    render();
    expect(store.get('/totalRevenue')).toBe('$1.');

    // Re-emit with the fuller value — the component wrote '$1.' itself, so
    // it is safe to overwrite (only USER edits are preserved).
    fixture.componentRef.setInput('spec', { ...statePathSpec } as Spec);
    const text = render();
    expect(store.get('/totalRevenue')).toBe('$1.2M');
    expect(text).toContain('$1.2M');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store isolation vs. sharing across component instances.
//
// Without a consumer store, each <chat-generative-ui> must be fully isolated:
// render-spec self-seeds a per-instance internal store from spec.state, so two
// dashboards with overlapping state keys (e.g. /totalRevenue on every message
// of a conversation) never collide. This is the regression test for the bug
// where the chat composition's conversation-wide internal store was passed to
// every surface. An EXPLICIT consumer store, by contrast, intentionally has
// shared/live semantics across all surfaces bound to it.
// ─────────────────────────────────────────────────────────────────────────────

/** Spec like statePathSpec but with a different value model for /totalRevenue. */
const otherStatePathSpec = {
  ...statePathSpec,
  state: { totalRevenue: '$9.9M', minRevenue: 75000 },
} as unknown as Spec;

describe('ChatGenerativeUiComponent — store isolation across instances', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChatGenerativeUiComponent] });
  });

  function createInstance(spec: Spec, store?: StateStore): ComponentFixture<ChatGenerativeUiComponent> {
    const fixture = TestBed.createComponent(ChatGenerativeUiComponent);
    fixture.componentRef.setInput('registry', toRenderRegistry(a2uiBasicCatalog()));
    if (store) fixture.componentRef.setInput('store', store);
    fixture.componentRef.setInput('spec', spec);
    return fixture;
  }

  function render(fixture: ComponentFixture<ChatGenerativeUiComponent>): string {
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('isolates instances WITHOUT a consumer store — overlapping paths never collide', () => {
    const a = createInstance(statePathSpec);
    const b = createInstance(otherStatePathSpec);
    const textA = render(a);
    const textB = render(b);

    // Each instance renders ITS OWN spec.state values for the same paths.
    expect(textA).toContain('$1.2M');
    expect(textA).not.toContain('$9.9M');
    expect(textB).toContain('$9.9M');
    expect(textB).not.toContain('$1.2M');

    // A user edit inside one surface must not leak into the other.
    const sliderA = (a.nativeElement as HTMLElement).querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    sliderA.value = '30000';
    sliderA.dispatchEvent(new Event('input'));
    render(a);
    expect(render(b)).toContain('Min revenue (USD): 75000');
  });

  it('shares one EXPLICIT consumer store across instances — first seeder wins, values are live', () => {
    const shared = signalStateStore({});
    const a = createInstance(statePathSpec, shared);
    const textA = render(a);
    expect(textA).toContain('$1.2M');

    // Second instance binds the SAME store with different spec.state for the
    // same paths. The paths are already populated (and not by THIS instance),
    // so it must not clobber them: both surfaces show the shared values.
    const b = createInstance(otherStatePathSpec, shared);
    const textB = render(b);
    expect(shared.get('/totalRevenue')).toBe('$1.2M');
    expect(shared.get('/minRevenue')).toBe(25000);
    expect(textB).toContain('$1.2M');
    expect(textB).not.toContain('$9.9M');

    // Live semantics: a write to the shared store is reflected in BOTH.
    shared.set('/totalRevenue', '$3.0M');
    expect(render(a)).toContain('$3.0M');
    expect(render(b)).toContain('$3.0M');
  });
});

describe('normalizeJsonRenderSpec', () => {
  it('rewrites { statePath } props to $bindState + _bindings', () => {
    const out = normalizeJsonRenderSpec(statePathSpec);
    const kpi = out.elements['kpi'] as { props: Record<string, unknown> };
    expect(kpi.props['text']).toEqual({ $bindState: '/totalRevenue' });
    const min = out.elements['min'] as { props: Record<string, unknown> };
    expect(min.props['value']).toEqual({ $bindState: '/minRevenue' });
    expect(min.props['_bindings']).toEqual({ value: '/minRevenue' });
  });

  it('leaves scalar props untouched', () => {
    const out = normalizeJsonRenderSpec(statePathSpec);
    const min = out.elements['min'] as { props: Record<string, unknown> };
    expect(min.props['label']).toBe('Min revenue (USD)');
    expect(min.props['min']).toBe(0);
  });

  it('returns the same reference when no statePath props exist', () => {
    const plain = {
      root: 'a',
      elements: { a: { type: 'Text', props: { text: 'hello' } } },
      state: {},
    } as unknown as Spec;
    expect(normalizeJsonRenderSpec(plain)).toBe(plain);
  });

  it('ignores objects that merely contain a statePath key among others', () => {
    const spec = {
      root: 'a',
      elements: {
        a: { type: 'Text', props: { text: { statePath: '/x', other: 1 } } },
      },
      state: {},
    } as unknown as Spec;
    const out = normalizeJsonRenderSpec(spec);
    const a = out.elements['a'] as { props: Record<string, unknown> };
    expect(a.props['text']).toEqual({ statePath: '/x', other: 1 });
  });
});
