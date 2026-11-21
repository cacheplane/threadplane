import { describe, it, expect, beforeEach } from 'vitest';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { A2uiSurfaceComponent } from './surface.component';
import type { A2uiSurfaceState } from './surface-store';
import { createA2uiSurfaceStore } from './surface-store';
import { a2uiBasicCatalog } from './catalog';

@Component({ standalone: true, selector: 'a2ui-test-real', template: '<span data-role="real"></span>', changeDetection: ChangeDetectionStrategy.OnPush })
class RealCmp {}
@Component({ standalone: true, selector: 'a2ui-test-custom-fb', template: '<span data-role="custom-fb"></span>', changeDetection: ChangeDetectionStrategy.OnPush })
class CustomFallback {}

function makeState(components: Array<{ id: string; type: string; props?: Record<string, unknown> }> = []): A2uiSurfaceState {
  const compsMap = new Map<string, never>(
    components.map((c) => [c.id, {
      id: c.id,
      component: { [c.type]: c.props ?? {} },
    } as never]),
  );
  return {
    surface: {
      surfaceId: 's1', catalogId: 'basic',
      components: compsMap, dataModel: {},
    } as never,
    componentViews: new Map() as never,
  };
}

describe('A2uiSurfaceComponent — empty surface', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] }));

  it('renders the default fallback when state.surface has no components', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeState([]));
    fx.componentRef.setInput('catalog', { t: RealCmp });
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('.a2ui-default-fallback')).toBeTruthy();
  });

  it('renders a custom fallback when surfaceFallback is set and surface is empty', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeState([]));
    fx.componentRef.setInput('catalog', { t: RealCmp });
    fx.componentRef.setInput('surfaceFallback', CustomFallback);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-role="custom-fb"]')).toBeTruthy();
  });
});

describe('A2uiSurfaceComponent — nested children with real catalog (regression)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] }));

  it('renders Column children defined via a children id list', () => {
    // Reproduces the contact-form bug: a Column with listed children
    // must actually render those children. Prior to the fix, the slot path
    // pushed wrapped wire-format props onto the catalog component which
    // had no matching `Column` input — so childKeys stayed empty and the
    // Column rendered as an empty <div>.
    const store = createA2uiSurfaceStore();
    store.apply({ version: 'v0.9', createSurface: {
      surfaceId: 's1', catalogId: 'basic',
    } } as never);
    store.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's1',
      components: [
        { id: 'root', component: 'Column',
          children: ['leaf'], justify: 'start', align: 'stretch' },
        { id: 'leaf', component: 'Text', text: 'Hello', variant: 'h2' },
      ],
    } } as never);

    const state = store.surfaceState('s1')();
    expect(state).toBeDefined();

    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', state);
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    // The Text leaf must appear inside the rendered surface. If the
    // Column's childKeys input was never set, no Text gets rendered.
    expect(fx.nativeElement.textContent).toContain('Hello');
  });
});

describe('A2uiSurfaceComponent — validation gate + live context (Phase 3)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] }));

  function makeCheckedSurfaceState() {
    const store = createA2uiSurfaceStore();
    store.apply({ version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'basic' } } as never);
    store.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's1',
      components: [
        { id: 'root', component: 'Column', children: ['email', 'go'] },
        { id: 'email', component: 'TextField', label: 'Email', value: { path: '/email' },
          checks: [
            { condition: { call: 'required', args: { value: { path: '/email' } } }, message: 'Email is required' },
            { condition: { call: 'email', args: { value: { path: '/email' } } }, message: 'Invalid email' },
          ] },
        { id: 'go', component: 'Button', child: 'go-lbl',
          action: { event: { name: 'submit', context: { email: { path: '/email' } } } } },
        { id: 'go-lbl', component: 'Text', text: 'Send' },
      ],
    } } as never);
    store.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's1', path: '/email', value: '' } } as never);
    return store.surfaceState('s1')()!;
  }

  it('blocks the action, writes the check message, and emits VALIDATION_FAILED when checks fail', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeCheckedSurfaceState());
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    const actions: unknown[] = [];
    const errors: { error: { code: string; message?: string } }[] = [];
    fx.componentInstance.action.subscribe((a) => actions.push(a));
    fx.componentInstance.validationError.subscribe((e) => errors.push(e));
    fx.detectChanges();

    const handler = fx.componentInstance.internalHandlers()['a2ui:event'];
    const result = handler({
      surfaceId: 's1', sourceComponentId: 'go', name: 'submit',
      context: { email: { $bindState: '/email' } },
    });

    expect(result).toBeUndefined();
    expect(actions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.code).toBe('VALIDATION_FAILED');
    expect(errors[0].error.message).toBe('Email is required');
    expect(fx.componentInstance.liveStore.get('/_a2uiChecks/email')).toBe('Email is required');
  });

  it('emits the action with live-typed context values once checks pass', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeCheckedSurfaceState());
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    const actions: { action: { context?: Record<string, unknown> } }[] = [];
    fx.componentInstance.action.subscribe((a) => actions.push(a));
    fx.detectChanges();

    // Simulate the user typing into the bound TextField (writes the store).
    fx.componentInstance.liveStore.set('/email', 'ada@example.com');

    const handler = fx.componentInstance.internalHandlers()['a2ui:event'];
    handler({
      surfaceId: 's1', sourceComponentId: 'go', name: 'submit',
      context: { email: { $bindState: '/email' } },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].action.context).toEqual({ email: 'ada@example.com' });
    expect(fx.componentInstance.liveStore.get('/_a2uiChecks/email')).toBe('');
  });

  it('enforces TextField validationRegexp as an implicit check', () => {
    const store = createA2uiSurfaceStore();
    store.apply({ version: 'v0.9', createSurface: { surfaceId: 's2', catalogId: 'basic' } } as never);
    store.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's2',
      components: [
        { id: 'root', component: 'Column', children: ['code'] },
        { id: 'code', component: 'TextField', label: 'Code', value: { path: '/code' },
          validationRegexp: '^[A-Z]{3}$' },
      ],
    } } as never);
    store.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's2', path: '/code', value: 'nope' } } as never);

    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', store.surfaceState('s2')()!);
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    const errors: { error: { code: string } }[] = [];
    fx.componentInstance.validationError.subscribe((e) => errors.push(e));
    fx.detectChanges();

    const handler = fx.componentInstance.internalHandlers()['a2ui:event'];
    const result = handler({ surfaceId: 's2', sourceComponentId: 'root', name: 'submit', context: {} });
    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(fx.componentInstance.liveStore.get('/_a2uiChecks/code')).toBe('Invalid format');
  });

  it('preserves user edits in the live store across spec re-emissions', () => {
    const state = makeCheckedSurfaceState();
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', state);
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();
    fx.componentInstance.liveStore.set('/email', 'user@typed.io');
    // Re-emit the same state (streaming re-materializes surfaces).
    fx.componentRef.setInput('state', { ...state });
    fx.detectChanges();
    expect(fx.componentInstance.liveStore.get('/email')).toBe('user@typed.io');
  });
});

describe('A2uiSurfaceComponent — surface theme chrome', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] }));

  function makeThemedState(theme?: Record<string, unknown>) {
    const store = createA2uiSurfaceStore();
    store.apply({ version: 'v0.9', createSurface: {
      surfaceId: 's1', catalogId: 'basic', ...(theme ? { theme } : {}),
    } } as never);
    store.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's1',
      components: [{ id: 'root', component: 'Text', text: 'Hello' }],
    } } as never);
    return store.surfaceState('s1')()!;
  }

  it('renders agentDisplayName and iconUrl as a header above the surface', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeThemedState({
      agentDisplayName: 'Flight Bot', iconUrl: 'https://x/icon.png',
    }));
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    const chrome = fx.nativeElement.querySelector('.a2ui-surface-chrome');
    expect(chrome).toBeTruthy();
    expect(chrome.textContent).toContain('Flight Bot');
    const img = chrome.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://x/icon.png');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('renders the name alone when only agentDisplayName is set', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeThemedState({ agentDisplayName: 'Flight Bot' }));
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    const chrome = fx.nativeElement.querySelector('.a2ui-surface-chrome');
    expect(chrome).toBeTruthy();
    expect(chrome.textContent).toContain('Flight Bot');
    expect(chrome.querySelector('img')).toBeNull();
  });

  it('renders no chrome element at all for a themeless surface', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeThemedState());
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    expect(fx.nativeElement.querySelector('.a2ui-surface-chrome')).toBeNull();
    // The surface itself still renders.
    expect(fx.nativeElement.textContent).toContain('Hello');
  });

  it('renders no chrome when the theme only carries primaryColor', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeThemedState({ primaryColor: '#ff0066' }));
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    expect(fx.nativeElement.querySelector('.a2ui-surface-chrome')).toBeNull();
  });

  it('still applies primaryColor as the --a2ui-primary host style', () => {
    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', makeThemedState({
      primaryColor: '#ff0066', agentDisplayName: 'Flight Bot',
    }));
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    fx.detectChanges();

    expect(fx.nativeElement.style.getPropertyValue('--a2ui-primary')).toBe('#ff0066');
    expect(fx.nativeElement.querySelector('.a2ui-surface-chrome')).toBeTruthy();
  });
});

describe('A2uiSurfaceComponent — sendDataModel live round-trip (Phase 4)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiSurfaceComponent] }));

  it('attaches the live data model (internal keys stripped) when sendDataModel is true', () => {
    const store = createA2uiSurfaceStore();
    store.apply({ version: 'v0.9', createSurface: {
      surfaceId: 's3', catalogId: 'basic', sendDataModel: true,
    } } as never);
    store.apply({ version: 'v0.9', updateComponents: {
      surfaceId: 's3',
      components: [
        { id: 'root', component: 'Column', children: ['name', 'go'] },
        { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' },
          checks: [{ condition: { call: 'required', args: { value: { path: '/name' } } }, message: 'Required' }] },
        { id: 'go', component: 'Button', child: 'go-lbl', action: { event: { name: 'save' } } },
        { id: 'go-lbl', component: 'Text', text: 'Save' },
      ],
    } } as never);
    store.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's3', path: '/name', value: '' } } as never);

    const fx = TestBed.createComponent(A2uiSurfaceComponent);
    fx.componentRef.setInput('state', store.surfaceState('s3')()!);
    fx.componentRef.setInput('catalog', a2uiBasicCatalog());
    const actions: { metadata?: { a2uiClientDataModel?: { surfaces: Record<string, Record<string, unknown>> } } }[] = [];
    fx.componentInstance.action.subscribe((a) => actions.push(a));
    fx.detectChanges();

    // User edits the bound field via the live store.
    fx.componentInstance.liveStore.set('/name', 'Ada Lovelace');

    const handler = fx.componentInstance.internalHandlers()['a2ui:event'];
    handler({ surfaceId: 's3', sourceComponentId: 'go', name: 'save', context: {} });

    expect(actions).toHaveLength(1);
    const model = actions[0].metadata!.a2uiClientDataModel!.surfaces['s3'];
    expect(model['name']).toBe('Ada Lovelace');
    expect('_a2uiChecks' in model).toBe(false);
  });
});
