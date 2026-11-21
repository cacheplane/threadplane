import { describe, expect, it } from 'vitest';
import { Component, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { z } from 'zod/v4';
import type { Spec } from '@json-render/core';

import { RenderElementComponent } from './render-element.component';
import { RENDER_CONTEXT } from './contexts/render-context';
import { defineAngularRegistry } from './define-angular-registry';
import { signalStateStore } from './signal-state-store';
import { injectRenderHost } from './contexts/render-host';
import type { AngularRegistry } from './render.types';

/** Renders a plain `content` prop, so a repeated element only shows text when
 * its `$item`-bound props resolved in that item's own repeat scope. */
@Component({
  selector: 'render-test-item-text',
  standalone: true,
  template: '<p class="item">{{ content() }}</p>',
})
class ItemTextComponent {
  readonly content = input<string>('');
}

/** Distinguishable fallback so a per-item readiness gate is observable. */
@Component({
  selector: 'render-test-item-skeleton',
  standalone: true,
  template: '<p class="skeleton">loading</p>',
})
class ItemSkeletonComponent {}

/** Fires `emit('click')` — the framework `emit` input path. */
@Component({
  selector: 'render-test-item-clicker',
  standalone: true,
  template: '<button class="row-button" (click)="emit()(\'click\')">go</button>',
})
class ItemClickerComponent {
  readonly emit = input<(event: string) => void>(() => undefined);
}

/** Fires `host.emit('click')` — the `injectRenderHost()` path. */
@Component({
  selector: 'render-test-item-host-clicker',
  standalone: true,
  template: '<button class="row-button" (click)="host.emit(\'click\')">go</button>',
})
class ItemHostClickerComponent {
  readonly host = injectRenderHost();
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

function mount(
  spec: Spec,
  options: {
    items: unknown[];
    registry: AngularRegistry;
    handlers?: Record<string, (params: Record<string, unknown>) => unknown>;
  },
) {
  const store = signalStateStore({ items: options.items });
  const calls: { action: string; params: Record<string, unknown> }[] = [];
  const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {};
  for (const name of Object.keys(options.handlers ?? {})) {
    handlers[name] = (params: Record<string, unknown>) => {
      calls.push({ action: name, params });
      return options.handlers?.[name]?.(params);
    };
  }
  const HostCmp = host(spec);
  TestBed.configureTestingModule({
    imports: [HostCmp],
    providers: [
      {
        provide: RENDER_CONTEXT,
        useValue: { store, registry: options.registry, functions: {}, handlers },
      },
    ],
  });
  const fixture = TestBed.createComponent(HostCmp);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    store,
    calls,
    text: (selector = '.item') =>
      [...root.querySelectorAll(selector)].map((n) => n.textContent?.trim()),
    clickRow: (index: number) => {
      root.querySelectorAll<HTMLButtonElement>('.row-button')[index].click();
      fixture.detectChanges();
    },
  };
}

function repeatSpec(element: Record<string, unknown>): Spec {
  return {
    root: 'rows',
    elements: { rows: { repeat: { statePath: '/items' }, ...element } },
  } as unknown as Spec;
}

describe('RenderElementComponent — repeat scope drives readiness and props', () => {
  it('renders each item of an object array through an $item-bound prop', () => {
    const h = mount(
      repeatSpec({ type: 'text', props: { content: { $item: 'label' } } }),
      {
        items: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }],
        registry: defineAngularRegistry({ text: ItemTextComponent }),
      },
    );
    expect(h.text()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('renders each item of a string array through a whole-item $item prop', () => {
    const h = mount(repeatSpec({ type: 'text', props: { content: { $item: '' } } }), {
      items: ['Alpha', 'Beta'],
      registry: defineAngularRegistry({ text: ItemTextComponent }),
    });
    expect(h.text()).toEqual(['Alpha', 'Beta']);
  });

  it('resolves $bindItem props through each instance basePath', () => {
    const h = mount(
      repeatSpec({ type: 'text', props: { content: { $bindItem: 'label' } } }),
      {
        items: [{ label: 'Alpha' }, { label: 'Beta' }],
        registry: defineAngularRegistry({ text: ItemTextComponent }),
      },
    );
    expect(h.text()).toEqual(['Alpha', 'Beta']);
  });

  it('shows the fallback only for the items whose props are genuinely undefined', () => {
    const h = mount(
      repeatSpec({ type: 'text', props: { content: { $item: 'label' } } }),
      {
        items: [{ label: 'Alpha' }, {}, { label: 'Gamma' }],
        registry: defineAngularRegistry({
          text: { component: ItemTextComponent, fallback: ItemSkeletonComponent },
        }),
      },
    );
    expect(h.text()).toEqual(['Alpha', 'Gamma']);
    expect(h.text('.skeleton')).toEqual(['loading']);
  });

  it('runs a registry Standard Schema per repeated item', () => {
    const h = mount(
      repeatSpec({ type: 'text', props: { content: { $item: 'label' } } }),
      {
        items: [{ label: 'Alpha' }, { label: 42 }, { label: 'Gamma' }],
        registry: defineAngularRegistry({
          text: {
            component: ItemTextComponent,
            fallback: ItemSkeletonComponent,
            schema: z.object({ content: z.string() }),
          },
        }),
      },
    );
    expect(h.text()).toEqual(['Alpha', 'Gamma']);
    expect(h.text('.skeleton')).toEqual(['loading']);
  });

  it('keeps the per-item visible condition working alongside $item-bound props', () => {
    const h = mount(
      repeatSpec({
        type: 'text',
        props: { content: { $item: 'label' } },
        visible: { $item: 'active', eq: true },
      }),
      {
        items: [
          { label: 'Alpha', active: true },
          { label: 'Beta', active: false },
          { label: 'Gamma', active: true },
        ],
        registry: defineAngularRegistry({ text: ItemTextComponent }),
      },
    );
    expect(h.text()).toEqual(['Alpha', 'Gamma']);
  });

  it('resolves $item-bound action params in the clicked item scope', () => {
    const h = mount(
      repeatSpec({
        type: 'clicker',
        props: {},
        on: { click: { action: 'pick', params: { id: { $item: 'id' } } } },
      }),
      {
        items: [{ id: 'a' }, { id: 'b' }],
        registry: defineAngularRegistry({ clicker: ItemClickerComponent }),
        handlers: { pick: () => undefined },
      },
    );
    h.clickRow(1);
    expect(h.calls).toEqual([{ action: 'pick', params: { id: 'b' } }]);
  });

  it('resolves $item-bound action params for injectRenderHost() emitters', () => {
    const h = mount(
      repeatSpec({
        type: 'clicker',
        props: {},
        on: { click: { action: 'pick', params: { id: { $item: 'id' } } } },
      }),
      {
        items: [{ id: 'a' }, { id: 'b' }],
        registry: defineAngularRegistry({ clicker: ItemHostClickerComponent }),
        handlers: { pick: () => undefined },
      },
    );
    h.clickRow(0);
    expect(h.calls).toEqual([{ action: 'pick', params: { id: 'a' } }]);
  });
});
