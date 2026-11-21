import { describe, it, expect, vi, afterEach } from 'vitest';
import { Component, inject, input } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';

import { RenderElementComponent } from './render-element.component';
import { RENDER_CONTEXT } from './contexts/render-context';
import { defineAngularRegistry } from './define-angular-registry';
import { signalStateStore } from './signal-state-store';
import { injectRenderHost } from './contexts/render-host';
import { REPEAT_SCOPE } from './contexts/repeat-scope';

/** Fires `emit('click')` with no payload when its button is clicked. */
@Component({
  selector: 'render-test-clicker',
  standalone: true,
  template: '<button (click)="emit()(\'click\')">go</button>',
})
class ClickerComponent {
  readonly emit = input<(event: string) => void>(() => undefined);
}

/** Fires `host.emit('click', payload)` with a caller-supplied payload. */
@Component({
  selector: 'render-test-payload-clicker',
  standalone: true,
  template: '<button (click)="fire($event)">go</button>',
})
class PayloadClickerComponent {
  private readonly host = injectRenderHost();
  fire(event: Event): void {
    this.host.emit('click', event as unknown as Record<string, unknown>);
  }
}

function host(spec: Spec) {
  @Component({
    standalone: true,
    imports: [RenderElementComponent],
    template: `<render-element [elementKey]="spec.root" [spec]="spec" />`,
  })
  class Host {
    readonly spec = spec;
  }
  return Host;
}

interface Harness {
  fixture: ReturnType<typeof TestBed.createComponent>;
  store: ReturnType<typeof signalStateStore>;
  calls: { action: string; params: Record<string, unknown> }[];
  click: () => void;
}

function mount(
  spec: Spec,
  options: {
    initialState?: Record<string, unknown>;
    handlers?: Record<string, (params: Record<string, unknown>) => unknown>;
    component?: unknown;
    confirmAnswer?: boolean;
  } = {},
): Harness {
  const store = signalStateStore(options.initialState ?? {});
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  const declared = options.handlers ?? {};
  const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {};
  for (const name of new Set([...Object.keys(declared), 'noop'])) {
    handlers[name] = (params: Record<string, unknown>) => {
      calls.push({ action: name, params });
      return declared[name]?.(params);
    };
  }
  const HostCmp = host(spec);
  TestBed.configureTestingModule({
    imports: [HostCmp],
    providers: [
      {
        provide: RENDER_CONTEXT,
        useValue: {
          store,
          registry: defineAngularRegistry({
            clicker: (options.component ?? ClickerComponent) as never,
          }),
          functions: {},
          handlers,
        },
      },
    ],
  });
  if (options.confirmAnswer !== undefined) {
    const doc = TestBed.inject(DOCUMENT);
    vi.spyOn(doc.defaultView as Window, 'confirm').mockReturnValue(options.confirmAnswer);
  }
  const fixture = TestBed.createComponent(HostCmp);
  fixture.detectChanges();
  return {
    fixture,
    store,
    calls,
    click: () => {
      (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
      fixture.detectChanges();
    },
  };
}

afterEach(() => vi.restoreAllMocks());

function clickSpec(on: unknown): Spec {
  return {
    root: 'btn',
    elements: { btn: { type: 'clicker', props: {}, on } },
  } as unknown as Spec;
}

// --- (e) params resolution ---

describe('RenderElementComponent — action params resolution', () => {
  it('resolves $state expressions inside params before calling the handler', () => {
    const h = mount(clickSpec({ click: { action: 'pick', params: { id: { $state: '/selected' } } } }), {
      initialState: { selected: 'row-7' },
      handlers: { pick: () => undefined },
    });
    h.click();
    expect(h.calls).toEqual([{ action: 'pick', params: { id: 'row-7' } }]);
  });

  it('leaves literal params untouched and lets the payload win on key collisions', () => {
    const h = mount(clickSpec({ click: { action: 'pick', params: { id: 'literal', keep: 1 } } }), {
      handlers: { pick: () => undefined },
    });
    h.click();
    expect(h.calls[0].params).toEqual({ id: 'literal', keep: 1 });
  });
});

// --- (d) confirm / preventDefault / onSuccess / onError ---

describe('RenderElementComponent — ActionBinding.confirm', () => {
  it('skips the handler when the confirmation is declined', () => {
    const h = mount(
      clickSpec({ click: { action: 'wipe', params: {}, confirm: { title: 'Sure?', message: 'Delete all?' } } }),
      { handlers: { wipe: () => undefined }, confirmAnswer: false },
    );
    h.click();
    expect(h.calls).toEqual([]);
  });

  it('runs the handler when the confirmation is accepted, asking with the configured message', () => {
    const h = mount(
      clickSpec({ click: { action: 'wipe', params: {}, confirm: { title: 'Sure?', message: 'Delete all?' } } }),
      { handlers: { wipe: () => undefined }, confirmAnswer: true },
    );
    h.click();
    expect(h.calls.map((c) => c.action)).toEqual(['wipe']);
    expect(TestBed.inject(DOCUMENT).defaultView!.confirm).toHaveBeenCalledWith('Delete all?');
  });
});

describe('RenderElementComponent — ActionBinding.preventDefault', () => {
  it('calls preventDefault() on an Event payload', () => {
    const h = mount(clickSpec({ click: { action: 'nav', params: {}, preventDefault: true } }), {
      handlers: { nav: () => undefined },
      component: PayloadClickerComponent,
    });
    const button = (h.fixture.nativeElement as HTMLElement).querySelector('button')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the event alone when preventDefault is not set', () => {
    const h = mount(clickSpec({ click: { action: 'nav', params: {} } }), {
      handlers: { nav: () => undefined },
      component: PayloadClickerComponent,
    });
    const button = (h.fixture.nativeElement as HTMLElement).querySelector('button')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('RenderElementComponent — ActionBinding.onSuccess', () => {
  it('applies a `set` map after a synchronous handler returns', () => {
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onSuccess: { set: { '/saved': true } } } }),
      { initialState: { saved: false }, handlers: { save: () => undefined } },
    );
    h.click();
    expect(h.store.get('/saved')).toBe(true);
  });

  it('applies a `set` map only after an async handler resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onSuccess: { set: { '/saved': true } } } }),
      { initialState: { saved: false }, handlers: { save: () => gate } },
    );
    h.click();
    expect(h.store.get('/saved')).toBe(false);
    release();
    await gate;
    await Promise.resolve();
    expect(h.store.get('/saved')).toBe(true);
  });

  it('dispatches a follow-up action', () => {
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onSuccess: { action: 'toast' } } }),
      { handlers: { save: () => undefined, toast: () => undefined } },
    );
    h.click();
    expect(h.calls.map((c) => c.action)).toEqual(['save', 'toast']);
  });

  it('navigates through the document default view', () => {
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onSuccess: { navigate: '/done' } } }),
      { handlers: { save: () => undefined } },
    );
    const view = TestBed.inject(DOCUMENT).defaultView!;
    const original = Object.getOwnPropertyDescriptor(view, 'location')!;
    const assign = vi.fn();
    Object.defineProperty(view, 'location', { configurable: true, value: { assign } });
    try {
      h.click();
    } finally {
      Object.defineProperty(view, 'location', original);
    }
    expect(assign).toHaveBeenCalledWith('/done');
  });
});

describe('RenderElementComponent — ActionBinding.onError', () => {
  it('applies a `set` map when a synchronous handler throws, and swallows the throw', () => {
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onError: { set: { '/error': '$error.message' } } } }),
      {
        handlers: {
          save: () => { throw new Error('boom'); },
        },
      },
    );
    expect(() => h.click()).not.toThrow();
    expect(h.store.get('/error')).toBe('boom');
  });

  it('applies a `set` map when an async handler rejects', async () => {
    const h = mount(
      clickSpec({ click: { action: 'save', params: {}, onError: { set: { '/error': '$error.message' } } } }),
      { handlers: { save: () => Promise.reject(new Error('nope')) } },
    );
    h.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.store.get('/error')).toBe('nope');
  });

  it('dispatches a follow-up action on failure and does not run onSuccess', () => {
    const h = mount(
      clickSpec({
        click: {
          action: 'save',
          params: {},
          onSuccess: { action: 'toast' },
          onError: { action: 'report' },
        },
      }),
      {
        handlers: {
          save: () => { throw new Error('boom'); },
          toast: () => undefined,
          report: () => undefined,
        },
      },
    );
    h.click();
    expect(h.calls.map((c) => c.action)).toEqual(['save', 'report']);
  });

  it('does not run onSuccess when an async handler rejects', async () => {
    const h = mount(
      clickSpec({
        click: {
          action: 'save',
          params: {},
          onSuccess: { set: { '/saved': true } },
          onError: { set: { '/failed': true } },
        },
      }),
      {
        initialState: { saved: false, failed: false },
        handlers: { save: () => Promise.reject(new Error('nope')) },
      },
    );
    h.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.store.get('/saved')).toBe(false);
    expect(h.store.get('/failed')).toBe(true);
  });
});

// --- (f) visible on the repeat branch ---

/** Reads its item straight from the repeat scope, so no prop-readiness gate
 * stands between the repeat branch and the assertion about `visible`. */
@Component({
  selector: 'render-test-row',
  standalone: true,
  template: '<li class="row">{{ name }}</li>',
})
class RowComponent {
  private readonly scope = inject(REPEAT_SCOPE, { optional: true });
  get name(): string {
    return String((this.scope?.item as { name?: string } | undefined)?.name ?? '');
  }
}

describe('RenderElementComponent — visible on the repeat branch', () => {
  function repeatFixture(visible: unknown, items: unknown[]) {
    const spec = {
      root: 'rows',
      elements: {
        rows: {
          type: 'row',
          props: {},
          repeat: { statePath: '/items' },
          visible,
        },
      },
    } as unknown as Spec;
    const store = signalStateStore({ items });
    const HostCmp = host(spec);
    TestBed.configureTestingModule({
      imports: [HostCmp],
      providers: [
        {
          provide: RENDER_CONTEXT,
          useValue: {
            store,
            registry: defineAngularRegistry({ row: RowComponent }),
            functions: {},
            handlers: {},
          },
        },
      ],
    });
    const fx = TestBed.createComponent(HostCmp);
    fx.detectChanges();
    return (fx.nativeElement as HTMLElement).querySelectorAll('.row');
  }

  it('renders only the items whose per-item visible condition holds', () => {
    const rows = repeatFixture({ $item: 'active', eq: true }, [
      { name: 'a', active: true },
      { name: 'b', active: false },
      { name: 'c', active: true },
    ]);
    expect([...rows].map((r) => r.textContent?.trim())).toEqual(['a', 'c']);
  });

  it('renders every item when no visible condition is declared', () => {
    const rows = repeatFixture(undefined, [{ name: 'a' }, { name: 'b' }]);
    expect(rows).toHaveLength(2);
  });

  it('honors an $index condition per repeated item', () => {
    const rows = repeatFixture({ $index: true, eq: 0 }, [{ name: 'a' }, { name: 'b' }]);
    expect([...rows].map((r) => r.textContent?.trim())).toEqual(['a']);
  });

  it('hides every item when the condition is a literal false', () => {
    const rows = repeatFixture(false, [{ name: 'a' }, { name: 'b' }]);
    expect(rows).toHaveLength(0);
  });
});
