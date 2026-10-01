import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  output,
} from '@angular/core';
import type { ComputedFunction, Spec, StateStore } from '@json-render/core';
import { DEVELOPMENT_COLLECTION_POLICY } from '@threadplane/telemetry/browser';

import { RenderElementComponent } from './render-element.component';
import { RENDER_CONFIG } from './provide-render';
import { VIEW_REGISTRY } from './provide-views';
import { toRenderRegistry } from './views';
import { RENDER_CONTEXT } from './contexts/render-context';
import type { RenderContext } from './contexts/render-context';
import type { AngularRegistry } from './render.types';
import { signalStateStore, type SignalStateStore } from './signal-state-store';
import type { RenderEvent } from './render-event';
import { RenderLifecycleService } from './render-lifecycle.service';
import { makeGuardedEmit } from './internals/guarded-emit';
import {
  connectRenderDevtools,
  createRenderDevtoolsTracker,
  RENDER_DEVTOOLS_TRACKER,
  ɵRENDER_DEVTOOLS,
  type RenderDevtoolsTracker,
} from './devtools/render-devtools';
declare const ngDevMode: boolean;

/**
 * Top-level entry point for rendering a json-render spec.
 *
 * Accepts the spec, registry, store, functions, handlers, and loading
 * as inputs. Provides `RENDER_CONTEXT` to child `RenderElementComponent`
 * instances via `viewProviders`.
 *
 * Falls back to `RENDER_CONFIG` (from `provideRender()`) for registry
 * and store defaults when inputs are not provided.
 *
 * @example
 * ```html
 * <render-spec [spec]="spec()" [registry]="registry" [store]="store" />
 * ```
 */
@Component({
  selector: 'render-spec',
  standalone: true,
  imports: [RenderElementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [
    {
      provide: DEVELOPMENT_COLLECTION_POLICY,
      useFactory: () => {
        const host = inject(RenderSpecComponent);
        const parent = inject(DEVELOPMENT_COLLECTION_POLICY, { optional: true, skipSelf: true });
        const config = inject(RENDER_CONFIG, { optional: true });
        return () => (parent?.() ?? true) && host.telemetry() !== false && config?.telemetry !== false;
      },
    },
    {
      provide: RENDER_CONTEXT,
      useFactory: () => inject(RenderSpecComponent)._context(),
    },
    {
      provide: RENDER_DEVTOOLS_TRACKER,
      useFactory: () => inject(RenderSpecComponent)._devtoolsTracker,
    },
    // A spec nested inside one of this spec's views reports only through a
    // hook provided closer to it, never through this spec's.
    { provide: ɵRENDER_DEVTOOLS, useValue: null },
  ],
  template: `
    @if (spec()?.root; as rootKey) {
      <render-element [elementKey]="rootKey" [spec]="spec()!" />
    }
  `,
})
export class RenderSpecComponent implements OnInit {
  readonly spec = input<Spec | null>(null);
  readonly registry = input<AngularRegistry | undefined>(undefined);
  readonly store = input<StateStore | undefined>(undefined);
  readonly functions = input<Record<string, ComputedFunction> | undefined>(undefined);
  readonly handlers = input<Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> | undefined>(undefined);
  readonly loading = input<boolean>(false);
  readonly events = output<RenderEvent>();
  /** Disable automatic development collection for this render tree. */
  readonly telemetry = input<boolean | undefined>(undefined);

  private readonly config = inject(RENDER_CONFIG, { optional: true });
  private readonly viewRegistry = inject(VIEW_REGISTRY, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly lifecycle = inject(RenderLifecycleService, { optional: true });
  private readonly devtoolsHook = inject(ɵRENDER_DEVTOOLS, { optional: true, skipSelf: true });

  /** Development only: the live elements the devtools hook reports, or null
   * when no hook is provided. Production builds fold this to null.
   * @internal */
  readonly _devtoolsTracker: RenderDevtoolsTracker | null =
    (typeof ngDevMode === 'undefined' || ngDevMode) && this.devtoolsHook
      ? createRenderDevtoolsTracker()
      : null;

  private destroyed = false;

  /**
   * True once this component is destroyed OR mid-teardown. Reads the live
   * `DestroyRef` state, which Angular flips at the very START of view
   * teardown — BEFORE any `onDestroy` hook runs, and crucially before the
   * `events` OutputEmitterRef's own destroy hook marks itself dead.
   *
   * The manual `destroyed` flag alone is set too late: it flips inside our
   * own `onDestroy` callback (below), which runs AFTER the output's destroy
   * hook. That left the final `destroyed`-lifecycle emit — and any late async
   * handler/store emit racing teardown — slipping through to an already-dead
   * OutputEmitterRef → dev-mode NG0953. Gating every emit on
   * `destroyRef.destroyed` closes that window. See guarded-emit.ts.
   */
  private isDestroyed(): boolean {
    return this.destroyed || this.destroyRef.destroyed;
  }

  /** Guarded OutputRef emit — no-ops after destroy (NG0953). */
  private readonly guardedEmit = makeGuardedEmit<RenderEvent>(
    (e) => this.events.emit(e),
    () => this.isDestroyed(),
  );

  /** Internal store, lazily created once and reused across spec changes. */
  private _internalStore: StateStore | undefined;

  private getOrCreateInternalStore(): StateStore {
    if (!this._internalStore) {
      this._internalStore = signalStateStore(this.spec()?.state ?? {});
    }
    return this._internalStore;
  }

  /** Resolved store: input > config > internal (from spec.state). */
  private readonly resolvedStore = computed<StateStore>(() => {
    const inputStore = this.store();
    if (inputStore) return inputStore;
    const configStore = this.config?.store;
    if (configStore) return configStore;
    return this.getOrCreateInternalStore();
  });

  /** Resolved registry: input > config > VIEW_REGISTRY token > empty fallback. */
  private readonly resolvedRegistry = computed<AngularRegistry>(() => {
    const inputRegistry = this.registry();
    if (inputRegistry) return inputRegistry;
    const configRegistry = this.config?.registry;
    if (configRegistry) return configRegistry;
    if (this.viewRegistry) return toRenderRegistry(this.viewRegistry);
    // Fallback: empty registry
    return { getEntry: () => undefined, names: () => [] };
  });

  /** Wraps input handlers to emit RenderHandlerEvent after execution. */
  private readonly wrappedHandlers = computed(() => {
    const inputHandlers = this.handlers() ?? this.config?.handlers;
    if (!inputHandlers) return undefined;
    const wrapped: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> = {};
    for (const [name, handler] of Object.entries(inputHandlers)) {
      wrapped[name] = (params: Record<string, unknown>) => {
        const result = handler(params);
        if (result instanceof Promise) {
          result.then(
            (r) => {
              this.emitTapped({ type: 'handler', action: name, params, result: r });
            },
            () => {
              this.emitTapped({ type: 'handler', action: name, params, result: undefined });
            },
          );
        } else {
          this.emitTapped({ type: 'handler', action: name, params, result });
        }
        return result;
      };
    }
    return wrapped;
  });

  /** Emits a RenderEvent through the events output and notifies the
   * lifecycle service (single tap point — all events flow through here). */
  private readonly emitTapped = (event: RenderEvent): void => {
    this.guardedEmit(event);
    if (this.isDestroyed() || !this.lifecycle) return;
    switch (event.type) {
      case 'lifecycle':
        this.lifecycle.notifyLifecycle({
          kind: event.scope,
          type: event.event,
          elementType: event.elementType,
        });
        break;
      case 'stateChange':
        this.lifecycle.notifyStateChange();
        break;
      case 'handler':
        this.lifecycle.notifyHandlerInvoked(event.action);
        break;
    }
  };

  /** Emits a RenderEvent through the events output. */
  private readonly emitEvent = (event: RenderEvent) => {
    this.emitTapped(event);
  };

  /** The RenderContext provided to children via viewProviders. */
  readonly _context = computed<RenderContext>(() => ({
    registry: this.resolvedRegistry(),
    store: this.resolvedStore(),
    functions: this.functions() ?? this.config?.functions,
    handlers: this.wrappedHandlers(),
    emitEvent: this.emitEvent,
    loading: this.loading(),
  }));

  constructor() {
    if ((typeof ngDevMode === 'undefined' || ngDevMode) && this.devtoolsHook && this._devtoolsTracker) {
      connectRenderDevtools(this.devtoolsHook, this._devtoolsTracker, {
        spec: this.spec,
        registry: this.resolvedRegistry,
        destroyed: () => this.isDestroyed(),
      });
    }

    // Subscribe to store changes and emit state change events
    effect(() => {
      const store = this.resolvedStore();
      const unsub = store.subscribe(() => {
        const snapshot = store.getSnapshot() as Record<string, unknown>;
        // `StateStore.subscribe` carries no path, so a foreign store can only
        // report the root and the whole snapshot. `signalStateStore()` records
        // its last mutation, which lets us name the path that actually changed.
        const change = (store as SignalStateStore).lastChange?.();
        this.emitTapped({
          type: 'stateChange',
          path: change?.path ?? '/',
          value: change ? change.value : snapshot,
          snapshot,
        });
      });
      this.destroyRef.onDestroy(unsub);
    });

    this.destroyRef.onDestroy(() => {
      // Mark destroyed BEFORE emitting: by now Angular has already torn down
      // the `events` output, so the guard must suppress this final emit too
      // (otherwise NG0953). The lifecycle service ignores 'destroyed' anyway.
      this.destroyed = true;
      this.emitTapped({ type: 'lifecycle', event: 'destroyed', scope: 'spec' });
    });
  }

  ngOnInit(): void {
    this.emitTapped({ type: 'lifecycle', event: 'mounted', scope: 'spec' });
  }
}
