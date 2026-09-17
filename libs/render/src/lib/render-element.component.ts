import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  isDevMode,
  OnInit,
  reflectComponentType,
  runInInjectionContext,
  signal,
  viewChildren,
  type Signal,
  type Type,
} from '@angular/core';
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Keep the postinstall module external through ng-packagr.
import { installationToken } from '#development-install';
declare const ngDevMode: boolean;
import { createDevelopmentRuntime, DEVELOPMENT_COLLECTION_POLICY } from '@threadplane/telemetry/browser';
import { THREADPLANE_PACKAGE_VERSION as packageVersion } from './package-version';
import {
  evaluateVisibility,
  resolveBindings,
  resolveElementProps,
} from '@json-render/core';
import type {
  ActionConfirm,
  ActionOnError,
  ActionOnSuccess,
  Spec,
  UIElement,
} from '@json-render/core';

import { RENDER_CONTEXT } from './contexts/render-context';
import { RENDER_HOST, type RenderHost } from './contexts/render-host';
import { REPEAT_SCOPE } from './contexts/repeat-scope';
import type { RepeatScope } from './contexts/repeat-scope';
import { buildPropResolutionContext } from './internals/prop-signal';
import { isElementReady } from './internals/element-readiness';
import type { AngularComponentRenderer, NormalizedEntry } from './render.types';

/** Cache of declared input names per component class. NgComponentOutlet
 * passes every key in its `inputs` prop to the target; Angular dev mode
 * raises NG0303 for any input the component doesn't declare. We strip
 * undeclared keys before mounting so simple view components (`StatCard`,
 * `Container`, etc.) don't get spammed with framework-only inputs
 * (`bindings`, `emit`, `loading`, `childKeys`, `spec`) they ignore. */
/** `null` means reflection failed (likely uncompiled / non-component) — in
 * that case we pass inputs through unmodified rather than swallow them.
 * An empty Set means the component genuinely declares zero inputs (e.g. a
 * pure presentational fallback) and ALL keys should be dropped. */
const declaredInputsCache = new WeakMap<Type<unknown>, Set<string> | null>();
function getDeclaredInputs(cls: Type<unknown>): Set<string> | null {
  if (declaredInputsCache.has(cls)) return declaredInputsCache.get(cls)!;
  const meta = reflectComponentType(cls);
  const result = meta ? new Set<string>(meta.inputs.map(i => i.templateName)) : null;
  declaredInputsCache.set(cls, result);
  return result;
}
function filterInputsForClass(
  cls: Type<unknown> | null,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (!cls) return inputs;
  const declared = getDeclaredInputs(cls);
  if (declared === null) return inputs;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (declared.has(k)) out[k] = v;
  }
  return out;
}

/** Anything carrying a callable `preventDefault` — a DOM `Event`, or a wrapper
 * a view component chose to hand to `emit`. */
function isEventLike(value: unknown): value is { preventDefault: () => void } {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { preventDefault?: unknown }).preventDefault === 'function'
  );
}

/** Honors `ActionBinding.preventDefault`. The payload a component passes to
 * `emit(event, payload)` is typed as a record, but in practice it is either
 * the DOM event itself or a record carrying it under `event`. */
function preventDefaultOn(payload: unknown): void {
  if (isEventLike(payload)) {
    payload.preventDefault();
    return;
  }
  const nested = (payload as Record<string, unknown> | undefined)?.['event'];
  if (isEventLike(nested)) nested.preventDefault();
}

/**
 * Recursive element renderer.
 *
 * For each element key it:
 * 1. Looks up the UIElement from spec.elements
 * 2. Resolves the component class from the registry
 * 3. Evaluates visibility
 * 4. Resolves prop expressions and bindings
 * 5. Renders via NgComponentOutlet with resolved inputs
 *
 * For elements with `repeat`, it iterates over the state array,
 * creating a child Injector with RepeatScope for each item.
 */
@Component({
  selector: 'render-element',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: RENDER_HOST, useFactory: (el: RenderElementComponent) => el.host, deps: [RenderElementComponent] },
  ],
  template: `
    @if (!element()?.repeat) {
      @if (visible()) {
        <ng-container
          *ngComponentOutlet="mountClass(); inputs: filteredResolvedInputs(); injector: parentInjector"
        />
      }
    } @else {
      @for (repeatInjector of repeatInjectors(); track $index) {
        @if (repeatVisible()[$index]) {
          <ng-container
            *ngComponentOutlet="
              repeatMountClasses()[$index];
              inputs: filteredRepeatInputs()[$index];
              injector: repeatInjector
            "
          />
        }
      }
    }
  `,
})
export class RenderElementComponent implements OnInit {
  readonly elementKey = input.required<string>();
  readonly spec = input.required<Spec>();

  private readonly ctx = inject(RENDER_CONTEXT);
  private readonly repeatScope = inject(REPEAT_SCOPE, { optional: true });
  readonly parentInjector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly collectionPolicy = inject(DEVELOPMENT_COLLECTION_POLICY, { optional: true });
  private readonly outlets = viewChildren(NgComponentOutlet);
  private readonly observedInstances = new WeakSet<object>();
  private readonly development = createDevelopmentRuntime({
    integration: 'render', packageName: '@threadplane/render', packageVersion,
    installationToken: (typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode() ? installationToken : null,
    enabled: () => this.collectionPolicy?.() ?? true,
  });

  private destroyed = false;

  constructor() {
    // One session observation per boot; guards and dedupe live inside touch().
    this.development.touch();
    this.destroyRef.onDestroy(() => this.development.dispose());
    afterEveryRender(() => {
      // Evidence is the mounted outlet itself: an element that is hidden,
      // unready, unknown or repeating over an empty array either renders no
      // outlet at all or renders the fallback, and the identity check below
      // rejects both. That holds per repeat item too, where a single
      // element-level readiness flag never could.
      if (this.destroyed) return;
      const component = this.componentClass();
      if (!component) return;
      for (const outlet of this.outlets()) {
        const instance = outlet.componentInstance;
        if (outlet.ngComponentOutlet !== component || !instance || this.observedInstances.has(instance)) continue;
        this.observedInstances.add(instance);
        this.development.milestone('generative_ui.rendered');
      }
    });
    this.destroyRef.onDestroy(() => {
      const el = this.element();
      if (el && this.ctx.emitEvent) {
        this.ctx.emitEvent({
          type: 'lifecycle',
          event: 'destroyed',
          scope: 'element',
          elementKey: this.elementKey(),
          elementType: el.type,
        });
      }
      this.destroyed = true;
    });

    // Latch mountedReal=true once the real component is selected. Lives in
    // an effect (not the computed) because Angular forbids signal writes
    // inside computed — they're for derivation only. Effects are the
    // idiomatic place for "signal change → signal write" side effects.
    effect(() => {
      if (this.mountedReal()) return;
      const el = this.element();
      if (!el || el.repeat) return;
      // Only latch when notReady is false AND a real component is registered.
      if (!this.notReady() && this.entry()?.component) {
        this.mountedReal.set(true);
      }
    });

    // The same latch, one flag per repeat index. Indexes are the identity the
    // `@for` block tracks, so a component instance and its latch line up.
    effect(() => {
      const el = this.element();
      if (!el?.repeat || !this.entry()?.component) return;
      const raw = this.repeatRawNotReady();
      const latched = this.repeatMountedReal();
      const next = raw.map((notReady, index) => (latched[index] ?? false) || !notReady);
      if (next.length !== latched.length || next.some((v, i) => v !== latched[i])) {
        this.repeatMountedReal.set(next);
      }
    });
  }

  ngOnInit(): void {
    const el = this.element();
    if (el && this.ctx.emitEvent) {
      this.ctx.emitEvent({
        type: 'lifecycle',
        event: 'mounted',
        scope: 'element',
        elementKey: this.elementKey(),
        elementType: el.type,
      });
    }
  }

  /** The UIElement definition from the spec. Only propagates when reference changes. */
  readonly element: Signal<UIElement | undefined> = computed(
    () => this.spec()?.elements?.[this.elementKey()],
    { equal: Object.is },
  );

  /** The full normalized registry entry for this element type. */
  readonly entry = computed<NormalizedEntry | undefined>(() => {
    const el = this.element();
    return el ? this.ctx.registry.getEntry(el.type) : undefined;
  });

  /** The Angular component class for this element type. */
  readonly componentClass = computed<AngularComponentRenderer | null>(() => {
    const el = this.element();
    if (!el) return null;
    return this.entry()?.component ?? null;
  });

  /** Prop resolution context built from store + repeat scope. */
  private readonly propCtx = computed(() =>
    buildPropResolutionContext(
      this.ctx.store,
      this.repeatScope ?? undefined,
      this.ctx.functions,
    ),
  );

  /** Once real mounts, never revert to fallback even if a state-bound
   *  prop later becomes undefined. Per-instance monotonic gate. */
  private readonly mountedReal = signal<boolean>(false);

  /** True when the element is not yet ready to mount the real component.
   *  Delegates to `isElementReady` which checks:
   *  1. Any undefined-valued resolved prop (state binding still loading).
   *  2. A sync Standard-Schema gate if the registry entry declares a schema.
   *  Framework-injected keys (bindings, emit, loading, childKeys, spec) are
   *  excluded — only consumer-resolved props matter for readiness. */
  readonly notReady = computed<boolean>(() => {
    if (this.mountedReal()) return false;
    const el = this.element();
    if (!el || !el.props) return false;
    const resolved = resolveElementProps(el.props, this.propCtx());
    return !isElementReady(this.entry(), resolved);
  });

  /** Picks fallback or real based on notReady. The mountedReal latch is
   *  driven by a constructor effect (not this computed) — Angular forbids
   *  signal writes inside computed. */
  readonly mountClass = computed<AngularComponentRenderer | null>(() => {
    const el = this.element();
    if (!el) return null;
    const real = this.entry()?.component ?? null;
    if (this.notReady()) {
      return this.entry()?.fallback ?? null;
    }
    return real;
  });

  /** Whether the element is visible (non-repeat path). */
  readonly visible = computed(() => {
    const el = this.element();
    if (!el) return false;
    if (this.mountClass() === null) return false;
    return evaluateVisibility(el.visible, this.propCtx());
  });

  /** Invokes the element's `on[event]` handler bindings, honoring every field
   *  of `ActionBinding`: `preventDefault`, `confirm`, `params` (resolved
   *  through the same expression resolver the element props use) and the
   *  `onSuccess` / `onError` follow-ups.
   *
   *  `repeatIndex` names which repeated instance fired, so `{ $item: … }`
   *  params resolve in that row's scope rather than the parent's. */
  private invokeHandlers(
    event: string,
    payload?: Record<string, unknown>,
    repeatIndex?: number,
  ): void {
    const el = this.element();
    if (!el?.on) return;
    const binding = el.on[event];
    if (!binding) return;
    const bindings = Array.isArray(binding) ? binding : [binding];
    for (const b of bindings) {
      if (b.preventDefault) preventDefaultOn(payload);
      if (b.confirm && !this.askForConfirmation(b.confirm)) continue;

      const handler = this.ctx.handlers?.[b.action];
      if (!handler) continue;

      // `params` are DynamicValues: `{ $state: '/x' }`, `{ $item: 'y' }` and
      // friends resolve against the store and this element's repeat scope,
      // exactly as an element prop would. The payload wins on key collisions.
      const resolved = resolveElementProps(
        (b.params ?? {}) as Record<string, unknown>,
        repeatIndex === undefined
          ? this.propCtx()
          : this.repeatPropCtxs()[repeatIndex] ?? this.propCtx(),
      );
      const params = { ...resolved, ...(payload ?? {}) };

      let result: unknown;
      try {
        result = runInInjectionContext(this.parentInjector, () => handler(params));
      } catch (error) {
        if (!b.onError) throw error;
        this.runOnError(b.onError, error);
        continue;
      }
      if (result instanceof Promise) {
        result.then(
          () => this.runOnSuccess(b.onSuccess),
          (error: unknown) => {
            if (!b.onError) return;
            this.runOnError(b.onError, error);
          },
        );
      } else {
        this.runOnSuccess(b.onSuccess);
      }
    }
  }

  /** Asks the user to confirm before running a binding's handler. Returns
   *  false only when a real `window.confirm` answered no — without a
   *  `defaultView` (server-side rendering) there is nobody to ask, so the
   *  handler proceeds. */
  private askForConfirmation(confirm: ActionConfirm): boolean {
    const view = this.document.defaultView;
    if (!view?.confirm) return true;
    return Boolean(view.confirm(confirm.message));
  }

  /** Runs an `ActionBinding.onSuccess` follow-up. */
  private runOnSuccess(onSuccess: ActionOnSuccess | undefined): void {
    if (!onSuccess || this.destroyed) return;
    if ('navigate' in onSuccess) {
      this.document.defaultView?.location.assign(onSuccess.navigate);
      return;
    }
    if ('set' in onSuccess) {
      for (const [path, value] of Object.entries(onSuccess.set)) {
        this.ctx.store.set(path, value);
      }
      return;
    }
    this.dispatchAction(onSuccess.action);
  }

  /** Runs an `ActionBinding.onError` follow-up. `'$error.message'` in a `set`
   *  map is replaced by the thrown error's message, matching `executeAction`
   *  in `@json-render/core`. */
  private runOnError(onError: ActionOnError, error: unknown): void {
    if (this.destroyed) return;
    if ('set' in onError) {
      const message = error instanceof Error ? error.message : String(error);
      for (const [path, value] of Object.entries(onError.set)) {
        this.ctx.store.set(path, value === '$error.message' ? message : value);
      }
      return;
    }
    this.dispatchAction(onError.action);
  }

  /** Dispatches a handler by name with no params — the follow-up form of
   *  `onSuccess` / `onError`. */
  private dispatchAction(name: string): void {
    const handler = this.ctx.handlers?.[name];
    if (!handler) return;
    runInInjectionContext(this.parentInjector, () => handler({}));
  }

  /** Element-scoped host injected by mounted view components via
   * injectRenderHost(). `set` writes the store; `emit` routes element
   * handlers; `result` surfaces a RenderResultEvent for this element. */
  readonly host: RenderHost = {
    set: (path: string, value: unknown) => { if (this.destroyed) return; this.ctx.store?.set(path, value); },
    emit: (event: string, payload?: Record<string, unknown>) => { if (this.destroyed) return; this.invokeHandlers(event, payload); },
    result: (value: unknown) => { if (this.destroyed) return; this.ctx.emitEvent?.({ type: 'result', value, elementKey: this.elementKey() }); },
  };

  /** The same host, bound to one repeated instance so `host.emit(…)` resolves
   * `$item` action params in that row's scope. */
  private hostForRepeatIndex(index: number): RenderHost {
    return {
      set: this.host.set,
      result: this.host.result,
      emit: (event: string, payload?: Record<string, unknown>) => {
        if (this.destroyed) return;
        this.invokeHandlers(event, payload, index);
      },
    };
  }

  /** Emit function passed to mounted view components as the `emit` framework
   * input. Delegates to the element's `on[event]` handler bindings. */
  private readonly emitFn = (event: string) => {
    this.invokeHandlers(event);
  };

  /** Resolved inputs for non-repeat elements. */
  readonly resolvedInputs = computed(() => {
    const el = this.element();
    if (!el) return {};
    const ctx = this.propCtx();
    const resolved = resolveElementProps(el.props ?? {}, ctx);
    const bindings = resolveBindings(el.props ?? {}, ctx);
    return {
      ...resolved,
      bindings,
      emit: this.emitFn,
      loading: this.ctx.loading ?? false,
      childKeys: el.children ?? [],
      spec: this.spec(),
    };
  });

  /** `resolvedInputs` filtered down to keys the target component actually
   * declares — silences NG0303 dev-mode warnings from framework-only
   * inputs (bindings/emit/loading/childKeys/spec) passed to simple view
   * components that don't declare them. */
  readonly filteredResolvedInputs = computed(() =>
    filterInputsForClass(this.mountClass() as Type<unknown> | null, this.resolvedInputs()),
  );

  // --- Repeat support ---

  /** Items from the state array for repeat elements. */
  private readonly repeatItems = computed<unknown[]>(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    const items = this.ctx.store.get(el.repeat.statePath);
    return Array.isArray(items) ? items : [];
  });

  /** One RepeatScope per repeat item, shared between injectors and inputs. */
  private readonly repeatScopes = computed(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    return this.repeatItems().map((item, index) => ({
      item,
      index,
      basePath: `${el.repeat!.statePath}/${index}`,
    } satisfies RepeatScope));
  });

  /** One prop-resolution context per repeat item. Every per-item derivation —
   *  props, bindings, readiness, visibility, action params — resolves through
   *  these, so `{ $item: … }`, `{ $index: … }` and `{ $bindItem: … }` see the
   *  row they belong to instead of the parent scope. */
  private readonly repeatPropCtxs = computed(() =>
    this.repeatScopes().map(scope =>
      buildPropResolutionContext(this.ctx.store, scope, this.ctx.functions),
    ),
  );

  /** One child Injector per repeat item, providing RepeatScope and a
   *  row-scoped RenderHost (so `injectRenderHost().emit(…)` carries the row). */
  readonly repeatInjectors = computed(() => {
    return this.repeatScopes().map((scope, index) =>
      Injector.create({
        providers: [
          { provide: REPEAT_SCOPE, useValue: scope },
          { provide: RENDER_HOST, useValue: this.hostForRepeatIndex(index) },
        ],
        parent: this.parentInjector,
      }),
    );
  });

  /** Per-index latch behind {@link repeatNotReady}; written by a constructor
   *  effect because Angular forbids signal writes inside a computed. */
  private readonly repeatMountedReal = signal<readonly boolean[]>([]);

  /** Per-item readiness before the mounted latch is applied. */
  private readonly repeatRawNotReady = computed<boolean[]>(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    const props = el.props;
    if (!props) return this.repeatPropCtxs().map(() => false);
    const entry = this.entry();
    return this.repeatPropCtxs().map(
      ctx => !isElementReady(entry, resolveElementProps(props, ctx)),
    );
  });

  /** Per-item counterpart of {@link notReady}: a row whose `$item`-bound props
   *  have not resolved yet shows the fallback while its ready siblings mount
   *  the real component. Latched per index, exactly as the single mount is. */
  readonly repeatNotReady = computed<boolean[]>(() => {
    const latched = this.repeatMountedReal();
    return this.repeatRawNotReady().map((notReady, index) =>
      latched[index] ? false : notReady,
    );
  });

  /** Per-item counterpart of {@link mountClass}. */
  readonly repeatMountClasses = computed<(AngularComponentRenderer | null)[]>(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    const entry = this.entry();
    const real = entry?.component ?? null;
    const fallback = entry?.fallback ?? null;
    return this.repeatNotReady().map(notReady => (notReady ? fallback : real));
  });

  /** Resolved inputs for each repeat item. */
  readonly repeatInputs = computed(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    return this.repeatPropCtxs().map((ctx, index) => {
      const resolved = resolveElementProps(el.props ?? {}, ctx);
      const bindings = resolveBindings(el.props ?? {}, ctx);
      return {
        ...resolved,
        bindings,
        emit: (event: string) => this.invokeHandlers(event, undefined, index),
        loading: this.ctx.loading ?? false,
        childKeys: el.children ?? [],
        spec: this.spec(),
      };
    });
  });

  /** `repeatInputs` filtered per-item to declared component inputs — against
   *  that item's own mount class, which may be the fallback while a sibling
   *  already shows the real component. */
  readonly filteredRepeatInputs = computed(() => {
    const classes = this.repeatMountClasses();
    return this.repeatInputs().map((inputs, index) =>
      filterInputsForClass(classes[index] as Type<unknown> | null, inputs),
    );
  });

  /** Per-item visibility for repeat elements. The element's own `visible`
   *  condition is evaluated once per item, in that item's scope, so
   *  `{ $item: … }` and `{ $index: … }` conditions can hide individual rows —
   *  the same rule the non-repeat branch applies to a single mount. */
  readonly repeatVisible = computed<boolean[]>(() => {
    const el = this.element();
    if (!el?.repeat) return [];
    const classes = this.repeatMountClasses();
    return this.repeatPropCtxs().map(
      (ctx, index) => classes[index] !== null && evaluateVisibility(el.visible, ctx),
    );
  });
}
