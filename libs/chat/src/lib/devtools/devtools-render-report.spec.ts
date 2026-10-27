import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';
import { defineAngularRegistry, RenderSpecComponent, type ɵRenderResolution } from '@threadplane/render';
import { A2uiSurfaceComponent } from '../a2ui/surface.component';
import { createA2uiSurfaceStore } from '../a2ui/surface-store';
import { a2uiBasicCatalog } from '../a2ui/catalog';
import { ChatGenerativeUiComponent } from '../primitives/chat-generative-ui/chat-generative-ui.component';
import {
  MAX_RENDER_ELEMENTS,
  MAX_RENDER_REGISTRY,
  RENDER_REPORT_WINDOW_MS,
  ɵcreateRenderDevtoolsReporter,
  ɵprovideRenderDevtools,
} from './devtools-render-report';

const angular = vi.hoisted(() => ({ devMode: true }));
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDevMode: () => angular.devMode,
}));

/**
 * U4 of the AG-UI DevTools UI inspector design, verbatim: the extension
 * validates this shape (its copy lives in that repository), so a drift here
 * fails a test.
 */
interface ThreadplaneRenderReport {
  v: 1;
  kind: 'render';
  surface: string;
  seq: number;
  registry: string[];
  elements: { key: string; type: string; state: 'mounted' | 'fallback' | 'unresolved' | 'hidden' }[];
  tMs: number;
}
const REPORT_KEYS = ['elements', 'kind', 'registry', 'seq', 'surface', 'tMs', 'v'];

type Global = typeof globalThis & { ngDevMode?: unknown; __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

const cleanups: Array<() => void> = [];
function listen(): ThreadplaneRenderReport[] {
  const reports: ThreadplaneRenderReport[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { kind?: unknown };
    if (detail?.kind === 'render') reports.push(detail as ThreadplaneRenderReport);
  };
  window.addEventListener('threadplane:devtools', listener);
  cleanups.push(() => window.removeEventListener('threadplane:devtools', listener));
  return reports;
}

/** Lets the reporter's coalescing window close. */
const settle = () => new Promise((resolve) => setTimeout(resolve, RENDER_REPORT_WINDOW_MS + 30));
const states = (report: ThreadplaneRenderReport | undefined) =>
  Object.fromEntries((report?.elements ?? []).map((e) => [e.key, e.state]));

@Component({ selector: 'chat-test-text', standalone: true, template: '<span data-text>{{ label() }}</span>' })
class TextComponent {
  readonly label = input<string>();
}
@Component({ selector: 'chat-test-fallback', standalone: true, template: '<span data-fallback></span>' })
class FallbackComponent {}

function a2uiState(components: Record<string, unknown>[], data?: Record<string, unknown>) {
  const store = createA2uiSurfaceStore();
  store.apply({ version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'basic' } } as never);
  store.apply({ version: 'v0.9', updateComponents: { surfaceId: 's1', components } } as never);
  if (data) store.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's1', path: '/', value: data } } as never);
  return { store, state: () => store.surfaceState('s1')() };
}

describe('render devtools report', () => {
  const originalNgDevMode = (globalThis as Global).ngDevMode;
  beforeEach(() => {
    angular.devMode = true;
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    (globalThis as Global).ngDevMode = originalNgDevMode;
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
    TestBed.resetTestingModule();
  });

  describe('an A2UI surface', () => {
    it('reports an unknown component unresolved and its subtree hidden, keyed by surfaceId', async () => {
      const reports = listen();
      const { state } = a2uiState([
        { id: 'root', component: 'Column', children: ['title', 'mystery'] },
        { id: 'title', component: 'Text', text: 'Hello' },
        { id: 'mystery', component: 'Mystery', children: ['inner'] },
        { id: 'inner', component: 'Column', children: ['leaf'] },
        { id: 'leaf', component: 'Text', text: 'never shown' },
      ]);
      TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] });
      const fx = TestBed.createComponent(A2uiSurfaceComponent);
      fx.componentRef.setInput('state', state());
      fx.componentRef.setInput('catalog', a2uiBasicCatalog());
      fx.detectChanges();
      await settle();

      expect(reports).toHaveLength(1);
      const [report] = reports;
      expect(Object.keys(report).sort()).toEqual(REPORT_KEYS);
      expect(report).toMatchObject({ v: 1, kind: 'render', surface: 's1' });
      expect(report.elements).toEqual([
        { key: 'root', type: 'Column', state: 'mounted' },
        { key: 'title', type: 'Text', state: 'mounted' },
        { key: 'mystery', type: 'Mystery', state: 'unresolved' },
        { key: 'inner', type: 'Column', state: 'hidden' },
        { key: 'leaf', type: 'Text', state: 'hidden' },
      ]);
      expect(report.registry).toEqual(Object.keys(a2uiBasicCatalog()));
      expect(report.registry).toContain('Column');
      expect(report.registry).not.toContain('Mystery');
      expect(Number.isInteger(report.seq) && report.seq > 0).toBe(true);
      expect(report.tMs).toBeLessThanOrEqual(performance.now());
    });

    it('reports a data-bound component as fallback until its data arrives, then mounted', async () => {
      const reports = listen();
      const surface = a2uiState([
        { id: 'root', component: 'Column', children: ['name'] },
        { id: 'name', component: 'Text', text: { path: '/name' } },
      ]);
      TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] });
      const fx = TestBed.createComponent(A2uiSurfaceComponent);
      fx.componentRef.setInput('state', surface.state());
      fx.componentRef.setInput('catalog', a2uiBasicCatalog());
      fx.detectChanges();
      await settle();
      expect(states(reports.at(-1))).toEqual({ root: 'mounted', name: 'fallback' });

      surface.store.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's1', path: '/name', value: 'Ada' } } as never);
      fx.componentRef.setInput('state', surface.state());
      fx.detectChanges();
      await settle();
      expect(fx.nativeElement.textContent).toContain('Ada');
      expect(states(reports.at(-1))).toEqual({ root: 'mounted', name: 'mounted' });
      expect(reports.at(-1)!.seq).toBeGreaterThan(reports.at(-2)!.seq);
    });
  });

  describe('a json-render spec', () => {
    const registry = defineAngularRegistry({ Text: { component: TextComponent, fallback: FallbackComponent } });

    function renderSpec(spec: Spec) {
      TestBed.configureTestingModule({ imports: [ChatGenerativeUiComponent] });
      const fx = TestBed.createComponent(ChatGenerativeUiComponent);
      fx.componentRef.setInput('spec', spec);
      fx.componentRef.setInput('registry', registry);
      fx.detectChanges();
      return fx;
    }

    it("is the surface 'spec:' + its root key, and reports only when the resolution changes", async () => {
      const reports = listen();
      const fx = renderSpec({ root: 'card', elements: { card: { type: 'Text', props: { label: 'hi' }, children: [] } } });
      await settle();
      fx.detectChanges();
      fx.detectChanges();
      await settle();

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        surface: 'spec:card',
        registry: ['Text'],
        elements: [{ key: 'card', type: 'Text', state: 'mounted' }],
      });
    });

    it('reads no more props with the reporter than without it', async () => {
      function counting() {
        let reads = 0;
        const props = {} as Record<string, unknown>;
        Object.defineProperty(props, 'label', { enumerable: true, get: () => { reads += 1; return 'hi'; } });
        return { spec: { root: 'card', elements: { card: { type: 'Text', props, children: [] } } } as Spec, reads: () => reads };
      }
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
      const off = counting();
      renderSpec(off.spec).detectChanges();
      await settle();
      TestBed.resetTestingModule();

      delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
      const reports = listen();
      const on = counting();
      renderSpec(on.spec).detectChanges();
      await settle();

      expect(reports).toHaveLength(1);
      expect(on.reads()).toBe(off.reads());
    });

    it('never reads the props of elements that do not render', async () => {
      const reports = listen();
      const unreadable = (type: string, children: string[] = []) =>
        Object.defineProperty({ type, children }, 'props', {
          enumerable: true,
          get() {
            throw new Error('read a prop of an element that never renders');
          },
        });
            // Rendered through <render-spec> under the chat provider directly: the
      // json-render normalizer would otherwise read every element's props.
      @Component({
        standalone: true,
        imports: [RenderSpecComponent],
        changeDetection: ChangeDetectionStrategy.OnPush,
        viewProviders: [ɵprovideRenderDevtools()],
        template: `<render-spec [spec]="spec" [registry]="registry" />`,
      })
      class Host {
        readonly registry = registry;
        readonly spec = {
          root: 'mystery',
          elements: { mystery: { type: 'Mystery', children: ['a'] }, a: unreadable('Text', ['b']), b: unreadable('Text') },
        } as unknown as Spec;
      }
      const fx = TestBed.createComponent(Host);
      fx.detectChanges();
      await settle();

      expect(reports.at(-1)).toMatchObject({
        surface: 'spec:mystery',
        elements: [
          { key: 'mystery', type: 'Mystery', state: 'unresolved' },
          { key: 'a', type: 'Text', state: 'hidden' },
          { key: 'b', type: 'Text', state: 'hidden' },
        ],
      });
    });
  });

  describe('gate', () => {
    it('is null when the build defines ngDevMode as false', () => {
      (globalThis as Global).ngDevMode = false;
      expect(ɵcreateRenderDevtoolsReporter()).toBeNull();
    });

    it('is null outside development mode, and a rendered surface reports nothing', async () => {
      angular.devMode = false;
      expect(ɵcreateRenderDevtoolsReporter()).toBeNull();
      const reports = listen();
      const { state } = a2uiState([{ id: 'root', component: 'Mystery' }]);
      TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] });
      const fx = TestBed.createComponent(A2uiSurfaceComponent);
      fx.componentRef.setInput('state', state());
      fx.componentRef.setInput('catalog', a2uiBasicCatalog());
      fx.detectChanges();
      await settle();
      expect(reports).toEqual([]);
    });

    it('honors the opt-out at creation and at dispatch', async () => {
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
      expect(ɵcreateRenderDevtoolsReporter()).toBeNull();
      delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;

      const reports = listen();
      const reporter = ɵcreateRenderDevtoolsReporter()!;
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
      reporter.changed(() => resolution(1, 1));
      await settle();
      expect(reports).toEqual([]);
    });

    it('stops after dispose', async () => {
      const reports = listen();
      const reporter = ɵcreateRenderDevtoolsReporter()!;
      reporter.changed(() => resolution(1, 1));
      reporter.dispose();
      await settle();
      expect(reports).toEqual([]);
    });
  });

  describe('bounds', () => {
    it(`keeps the first ${MAX_RENDER_ELEMENTS} elements and ${MAX_RENDER_REGISTRY} registry names`, async () => {
      const reports = listen();
      const reporter = ɵcreateRenderDevtoolsReporter(() => 'big')!;
      reporter.changed(() => resolution(2100, 600));
      await settle();
      expect(reports[0].elements).toHaveLength(MAX_RENDER_ELEMENTS);
      expect(reports[0].elements[0].key).toBe('e0');
      expect(reports[0].elements.at(-1)!.key).toBe(`e${MAX_RENDER_ELEMENTS - 1}`);
      expect(reports[0].registry).toHaveLength(MAX_RENDER_REGISTRY);
      expect(reports[0].registry.at(-1)).toBe(`T${MAX_RENDER_REGISTRY - 1}`);
    });

    it('drops names, keys and types that do not fit rather than truncating them', async () => {
      const reports = listen();
      const long = 'x'.repeat(129);
      const reporter = ɵcreateRenderDevtoolsReporter(() => 's')!;
      reporter.changed(() => ({
        root: 'a',
        registry: ['A', long, '', 'A'],
        elements: [
          { key: 'a', type: 'A', state: 'mounted' },
          { key: long, type: 'A', state: 'hidden' },
          { key: 'b', type: long, state: 'unresolved' },
          { key: 'c', type: '', state: 'unresolved' },
        ],
      }));
      await settle();
      expect(reports[0]).toMatchObject({ registry: ['A'], elements: [{ key: 'a', type: 'A', state: 'mounted' }] });
    });

    it("sends nothing for a surface id over 128 characters, and falls back to 'spec:' + root without one", async () => {
      const reports = listen();
      ɵcreateRenderDevtoolsReporter(() => 's'.repeat(129))!.changed(() => resolution(1, 1));
      ɵcreateRenderDevtoolsReporter(() => '')!.changed(() => resolution(1, 1));
      await settle();
      expect(reports.map((r) => r.surface)).toEqual(['spec:e0']);
    });

    it('numbers reports per page across surfaces', async () => {
      const reports = listen();
      ɵcreateRenderDevtoolsReporter(() => 'one')!.changed(() => resolution(1, 1));
      ɵcreateRenderDevtoolsReporter(() => 'two')!.changed(() => resolution(1, 1));
      await settle();
      expect(reports.map((r) => r.surface)).toEqual(['one', 'two']);
      expect(reports[1].seq).toBe(reports[0].seq + 1);
    });

    it('swallows a read that throws', async () => {
      const reports = listen();
      ɵcreateRenderDevtoolsReporter(() => 's')!.changed(() => {
        throw new Error('boom');
      });
      await settle();
      expect(reports).toEqual([]);
    });
  });
});

function resolution(elements: number, names: number): ɵRenderResolution {
  return {
    root: 'e0',
    registry: Array.from({ length: names }, (_, i) => `T${i}`),
    elements: Array.from({ length: elements }, (_, i) => ({ key: `e${i}`, type: 'T0', state: 'mounted' as const })),
  };
}
