import { afterEveryRender, InjectionToken, type Signal } from '@angular/core';
import type { Spec } from '@json-render/core';
import type { AngularRegistry } from '../render.types';

/**
 * How one spec element resolved:
 * - `unresolved` — the registry has no entry for its `type`, so nothing renders;
 * - `fallback` — the entry's fallback is shown because its props are not ready;
 * - `hidden` — nothing renders for it: `visible` is false, or it sits under an
 *   element that rendered no children (an unresolved, hidden or fallback
 *   parent), or nothing references it;
 * - `mounted` — the registered component is mounted.
 */
export type RenderElementState = 'mounted' | 'fallback' | 'unresolved' | 'hidden';

/** One element of a {@link RenderResolution}. Structure only, never props. */
export interface RenderResolvedElement {
  key: string;
  type: string;
  state: RenderElementState;
}

/** What a rendered spec resolved to: names and states, never prop values. */
export interface RenderResolution {
  /** The spec's root element key. */
  root: string;
  /** The registry's names, in registry order. */
  registry: string[];
  /** Every spec element: the root first, then depth-first through `children`,
   * then any element nothing references, in spec order. */
  elements: RenderResolvedElement[];
}

/**
 * Receives a rendered spec's resolution. `changed` is called after render
 * passes that may have changed it; `read` computes the resolution on demand,
 * so a receiver that debounces pays for one read per flush.
 */
export interface RenderDevtoolsHook {
  changed(read: () => RenderResolution | null): void;
}

/**
 * Development-only devtools hook for `<render-spec>`. When an ancestor
 * provides a non-null hook, the spec reports which elements mounted, showed
 * a fallback, did not resolve, or did not render.
 *
 * @internal Seam for `@threadplane/chat`'s render report; not a public API.
 */
export const ɵRENDER_DEVTOOLS = new InjectionToken<RenderDevtoolsHook | null>('ɵRENDER_DEVTOOLS');

/** The live state one `<render-element>` instance reports. */
export interface RenderElementRegistration {
  key: Signal<string>;
  state: Signal<RenderElementState>;
}

/** Collects the live `<render-element>` instances under one `<render-spec>`. */
export interface RenderDevtoolsTracker {
  /** Adds an instance; returns its removal. */
  register(registration: RenderElementRegistration): () => void;
  /** The instances currently registered. */
  registrations(): Iterable<RenderElementRegistration>;
}

/** Provided by `<render-spec>` to its elements; null unless the hook is on. */
export const RENDER_DEVTOOLS_TRACKER = new InjectionToken<RenderDevtoolsTracker | null>(
  'RENDER_DEVTOOLS_TRACKER',
);

export function createRenderDevtoolsTracker(): RenderDevtoolsTracker {
  const live = new Set<RenderElementRegistration>();
  return {
    register(registration) {
      live.add(registration);
      return () => live.delete(registration);
    },
    registrations: () => live,
  };
}

/** When one key renders more than once (a repeat, or two references), the
 * most-rendered state wins. */
const RANK: Record<RenderElementState, number> = { hidden: 0, unresolved: 1, fallback: 2, mounted: 3 };

/**
 * Resolves every element of `spec` from the live instances' states. Reads the
 * spec's structure only — `root`, the element keys, and each element's `type`
 * and `children` — and never an element's `props`. An element with no
 * registry entry is `unresolved`; one with an entry but no live instance
 * never rendered, so it is `hidden`.
 */
export function resolveRenderTree(
  spec: Spec,
  registry: AngularRegistry,
  registrations: Iterable<RenderElementRegistration>,
): RenderResolution | null {
  const root = spec?.root;
  const elements = spec?.elements;
  if (typeof root !== 'string' || !elements || typeof elements !== 'object') return null;

  const liveStates = new Map<string, RenderElementState>();
  for (const registration of registrations) {
    const key = registration.key();
    const state = registration.state();
    const previous = liveStates.get(key);
    if (previous === undefined || RANK[state] > RANK[previous]) liveStates.set(key, state);
  }

  const keys = Object.keys(elements);
  const present = new Set(keys);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (start: string): void => {
    const stack = [start];
    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      if (seen.has(key) || !present.has(key)) continue;
      seen.add(key);
      order.push(key);
      const children = (elements as Record<string, { children?: unknown }>)[key]?.children;
      if (!Array.isArray(children)) continue;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (typeof child === 'string') stack.push(child);
      }
    }
  };
  visit(root);
  for (const key of keys) visit(key);

  const resolved: RenderResolvedElement[] = order.map((key) => {
    const rawType = (elements as Record<string, { type?: unknown }>)[key]?.type;
    const type = typeof rawType === 'string' ? rawType : '';
    const state: RenderElementState =
      !type || !registry.getEntry(type) ? 'unresolved' : liveStates.get(key) ?? 'hidden';
    return { key, type, state };
  });

  return { root, registry: [...registry.names()], elements: resolved };
}

/** The renderer's own decisions for one `<render-element>`, read as signals. */
export interface RenderElementView {
  element: Signal<{ repeat?: unknown } | undefined>;
  entry: Signal<unknown>;
  visible: Signal<boolean>;
  notReady: Signal<boolean>;
  repeatVisible: Signal<boolean[]>;
  repeatNotReady: Signal<boolean[]>;
}

/**
 * One instance's state, from the signals its template already renders from —
 * never from the element's props. A repeat is `mounted` when any visible row
 * shows the real component, `fallback` when visible rows show only fallbacks,
 * and `hidden` when no row is visible (including an empty array).
 */
export function elementDevtoolsState(view: RenderElementView): RenderElementState {
  const element = view.element();
  if (!element || !view.entry()) return 'unresolved';
  if (!element.repeat) {
    if (!view.visible()) return 'hidden';
    return view.notReady() ? 'fallback' : 'mounted';
  }
  const visible = view.repeatVisible();
  const notReady = view.repeatNotReady();
  let state: RenderElementState = 'hidden';
  for (let index = 0; index < visible.length; index += 1) {
    if (!visible[index]) continue;
    if (!notReady[index]) return 'mounted';
    state = 'fallback';
  }
  return state;
}

/**
 * After every render pass, tells the hook the resolution may have changed;
 * the hook reads it when it flushes. Call in an injection context. A
 * module-level function rather than a component method, so production builds,
 * which never call it, drop it and everything it uses.
 */
export function connectRenderDevtools(
  hook: RenderDevtoolsHook,
  tracker: RenderDevtoolsTracker,
  source: { spec: Signal<Spec | null>; registry: Signal<AngularRegistry>; destroyed: () => boolean },
): void {
  const read = (): RenderResolution | null => {
    if (source.destroyed()) return null;
    const spec = source.spec();
    return spec ? resolveRenderTree(spec, source.registry(), tracker.registrations()) : null;
  };
  afterEveryRender(() => {
    if (!source.destroyed()) hook.changed(read);
  });
}
