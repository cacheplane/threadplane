import { describe, it, expect } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Spec, StateStore } from '@json-render/core';

import { RenderElementComponent } from './render-element.component';
import { RenderSpecComponent } from './render-spec.component';
import { defineAngularRegistry } from './define-angular-registry';
import { signalStateStore } from './signal-state-store';
import { provideRender } from './provide-render';
import { RENDER_CONTEXT } from './contexts/render-context';
import { RENDER_LIFECYCLE } from './lifecycle';
import type { RenderEvent, RenderLifecycleEvent, RenderStateChangeEvent } from './render-event';

/** A container that actually mounts its children, as a real registry entry does. */
@Component({
  selector: 'render-test-container',
  standalone: true,
  imports: [RenderElementComponent],
  template: `
    @for (key of childKeys(); track key) {
      <render-element [elementKey]="key" [spec]="spec()!" />
    }
  `,
})
class ContainerComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | null>(null);
}

@Component({
  selector: 'render-test-leaf',
  standalone: true,
  template: '<span class="leaf">{{ label() }}</span>',
})
class LeafComponent {
  readonly label = input<string>('');
}

function spec(children: string[]): Spec {
  return {
    root: 'shell',
    elements: {
      shell: { type: 'Container', props: {}, children },
      a: { type: 'Leaf', props: { label: 'a' } },
      b: { type: 'Leaf', props: { label: 'b' } },
    },
  } as unknown as Spec;
}

@Component({
  standalone: true,
  imports: [RenderSpecComponent],
  template: `<render-spec
    [spec]="spec"
    [registry]="registry"
    [store]="store"
    (events)="events.push($event)"
  />`,
})
class EventsHost {
  spec: Spec = spec(['a', 'b']);
  readonly registry = defineAngularRegistry({
    Container: ContainerComponent,
    Leaf: LeafComponent,
  });
  store: StateStore = signalStateStore({ count: 0 });
  readonly events: RenderEvent[] = [];
}

function lifecycleEvents(events: RenderEvent[]): RenderLifecycleEvent[] {
  return events.filter((e): e is RenderLifecycleEvent => e.type === 'lifecycle');
}

describe('element-scope lifecycle events', () => {
  it('emits a mounted event for every element the renderer mounts', () => {
    TestBed.configureTestingModule({ imports: [EventsHost] });
    const fx = TestBed.createComponent(EventsHost);
    fx.detectChanges();

    const mounted = lifecycleEvents(fx.componentInstance.events).filter(
      (e) => e.event === 'mounted',
    );
    expect(mounted.filter((e) => e.scope === 'spec')).toHaveLength(1);
    expect(
      mounted
        .filter((e) => e.scope === 'element')
        .map((e) => ({ key: e.elementKey, type: e.elementType }))
        .sort((x, y) => String(x.key).localeCompare(String(y.key))),
    ).toEqual([
      { key: 'a', type: 'Leaf' },
      { key: 'b', type: 'Leaf' },
      { key: 'shell', type: 'Container' },
    ]);
  });

  it('emits an element destroyed event when an element leaves the tree', () => {
    const events: RenderEvent[] = [];

    @Component({
      standalone: true,
      imports: [RenderElementComponent],
      template: `
        @if (show()) {
          <render-element [elementKey]="'a'" [spec]="spec" />
        }
      `,
    })
    class ToggleHost {
      readonly show = signal(true);
      readonly spec = spec(['a']);
    }

    TestBed.configureTestingModule({
      imports: [ToggleHost],
      providers: [
        {
          provide: RENDER_CONTEXT,
          useValue: {
            store: signalStateStore({}),
            registry: defineAngularRegistry({ Leaf: LeafComponent }),
            functions: {},
            handlers: {},
            emitEvent: (e: RenderEvent) => events.push(e),
          },
        },
      ],
    });
    const fx = TestBed.createComponent(ToggleHost);
    fx.detectChanges();
    expect(
      lifecycleEvents(events).map((e) => `${e.event}:${e.elementKey}`),
    ).toEqual(['mounted:a']);

    fx.componentInstance.show.set(false);
    fx.detectChanges();

    expect(
      lifecycleEvents(events).map((e) => `${e.event}:${e.elementKey}`),
    ).toEqual(['mounted:a', 'destroyed:a']);
    expect(lifecycleEvents(events)[1].elementType).toBe('Leaf');
  });

  it('feeds mountCount and lastMountAt in RenderLifecycleService', () => {
    TestBed.configureTestingModule({
      imports: [EventsHost],
      providers: [provideRender({})],
    });
    const fx = TestBed.createComponent(EventsHost);
    fx.detectChanges();
    const lifecycle = TestBed.inject(RENDER_LIFECYCLE);
    // 1 spec mount + 3 element mounts.
    expect(lifecycle.mountCount()).toBe(4);
    expect(lifecycle.lastMountAt()).not.toBeNull();
  });
});

describe('stateChange events report the mutated path', () => {
  it('reports the real path and value for a signalStateStore', () => {
    TestBed.configureTestingModule({ imports: [EventsHost] });
    const fx = TestBed.createComponent(EventsHost);
    fx.detectChanges();
    const host = fx.componentInstance;
    host.events.length = 0;

    host.store.set('/count', 7);

    const changes = host.events.filter(
      (e): e is RenderStateChangeEvent => e.type === 'stateChange',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('/count');
    expect(changes[0].value).toBe(7);
    expect(changes[0].snapshot).toEqual({ count: 7 });
  });

  it('falls back to the root path and full snapshot for a foreign store', () => {
    let state: Record<string, unknown> = { count: 0 };
    const listeners = new Set<() => void>();
    const foreign: StateStore = {
      get: (path: string) => state[path.replace(/^\//, '')],
      set: (path: string, value: unknown) => {
        state = { ...state, [path.replace(/^\//, '')]: value };
        for (const l of listeners) l();
      },
      update: () => undefined,
      getSnapshot: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
    };

    TestBed.configureTestingModule({ imports: [EventsHost] });
    const fx = TestBed.createComponent(EventsHost);
    fx.componentInstance.store = foreign;
    fx.detectChanges();
    const host = fx.componentInstance;
    host.events.length = 0;

    foreign.set('/count', 3);

    const changes = host.events.filter(
      (e): e is RenderStateChangeEvent => e.type === 'stateChange',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('/');
    expect(changes[0].value).toEqual({ count: 3 });
  });
});
