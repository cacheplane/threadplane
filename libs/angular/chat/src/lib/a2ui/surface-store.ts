import { computed, signal, type Signal } from '@angular/core';
import type {
  A2uiMessage, A2uiSurface, A2uiComponent,
  A2uiCreateSurface, A2uiUpdateComponents, A2uiUpdateDataModel, A2uiDeleteSurface,
} from '@threadplane/a2ui';
import { setByPointer, deleteByPointer } from '@threadplane/a2ui';
import type { A2uiComponentView } from './component-view';
import { extractBindings } from './extract-bindings';

/** Pre-commit staging state for a surface: everything received before the
 * commit condition (createSurface seen AND a `root` component defined). */
interface SurfaceBuffer {
  create?: A2uiCreateSurface;
  components: Map<string, A2uiComponent>;
  componentViews: Map<string, A2uiComponentView>;
  /** Pending data model deltas accumulated before commit. `del` marks a
   * v0.9 delete (envelope with omitted `value`). */
  dataModelDeltas: { path?: string; value?: unknown; del?: boolean }[];
}

/** Chat-side state for a surface — wraps the wire-format `A2uiSurface`
 * with the per-component projection the progressive renderer consumes.
 * Both maps are kept in sync; the wire shape preserves existing
 * `surfaceToSpec` semantics, the view shape carries readiness. */
export interface A2uiSurfaceState {
  readonly surface: A2uiSurface;
  readonly componentViews: ReadonlyMap<string, A2uiComponentView>;
}

/** Applies A2UI envelopes and exposes reactive wire surfaces and component readiness projections. */
export interface A2uiSurfaceStore {
  apply(message: A2uiMessage): void;
  /**
   * Live-stream entry point. Iterates envelopes and feeds each through
   * `apply()`. Records the tool_call_id so the wrapped-content classifier
   * can short-circuit duplicate dispatch when the final AIMessage arrives.
   */
  applyPartialArgs(toolCallId: string, envelopes: readonly A2uiMessage[]): void;
  /** True if a tool_call_id has produced live envelopes via applyPartialArgs. */
  isPartialLive(toolCallId: string): boolean;
  /** Wire-format surfaces, for downstream consumers (e.g. surfaceToSpec). */
  readonly surfaces: Signal<Map<string, A2uiSurface>>;
  surface(surfaceId: string): Signal<A2uiSurface | undefined>;
  /** Chat-side projections with per-component readiness. */
  readonly surfaceStates: Signal<Map<string, A2uiSurfaceState>>;
  surfaceState(surfaceId: string): Signal<A2uiSurfaceState | undefined>;
}

/** Component-envelope keys that are protocol structure, not renderable props. */
const RESERVED_VIEW_PROP_KEYS = new Set([
  'id', 'component', 'catalogId', 'weight', 'accessibility', 'checks',
]);

/** Returns true if `path` (in `$.a.b.c` form) resolves to a defined,
 * non-null value inside `dataModel`. Used to decide per-component
 * readiness. */
function isResolved(dataModel: Record<string, unknown>, path: string): boolean {
  const segments = path.startsWith('$.') ? path.slice(2).split('.') : path.split('.');
  let cur: unknown = dataModel;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur !== undefined && cur !== null;
}

/** Resolve `{$.path}` references in a value against the data model.
 * Strings that look like a single full reference are replaced with
 * the resolved value; partial-reference strings get string-substituted;
 * nested objects/arrays are recursed. */
function resolveProps(value: unknown, dataModel: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const full = value.match(/^\{(\$\.[^{}]{1,512})\}$/);
    if (full) {
      const segs = full[1].slice(2).split('.');
      let cur: unknown = dataModel;
      for (const s of segs) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[s];
      }
      return cur;
    }
    // Bounded, brace-free class keeps the scan linear on adversarial
    // LLM-authored strings (CodeQL js/polynomial-redos).
    return value.replace(/\{(\$\.[^{}]{1,512})\}/g, (_, path: string) => {
      const segs = path.slice(2).split('.');
      let cur: unknown = dataModel;
      for (const s of segs) {
        if (cur == null || typeof cur !== 'object') return '';
        cur = (cur as Record<string, unknown>)[s];
      }
      return cur == null ? '' : String(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveProps(v, dataModel));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveProps(v, dataModel);
    }
    return out;
  }
  return value;
}

/** Resolve a flat v0.9 component into the renderable prop bag: reserved
 * protocol keys stripped, `{$.path}` references substituted. */
function resolveViewProps(
  component: A2uiComponent,
  dataModel: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(component as unknown as Record<string, unknown>)) {
    if (RESERVED_VIEW_PROP_KEYS.has(k)) continue;
    out[k] = resolveProps(v, dataModel);
  }
  return out;
}

function projectView(component: A2uiComponent): A2uiComponentView {
  return {
    id: component.id,
    type: typeof component.component === 'string' ? component.component : 'Unknown',
    bindings: extractBindings(component),
    ready: false,
    props: {},
    def: component,
  };
}

/** Apply one v0.9 data-model mutation (set at path, whole-model replace,
 * or delete-at-path when `value` is omitted). */
function applyDataModelDelta(
  dataModel: Record<string, unknown>,
  delta: { path?: string; value?: unknown; del?: boolean },
): Record<string, unknown> {
  const path = delta.path && delta.path !== '/' ? delta.path : undefined;
  if (delta.del) {
    return path ? deleteByPointer(dataModel, path) : {};
  }
  if (!path) {
    return (delta.value ?? {}) as Record<string, unknown>;
  }
  return setByPointer(dataModel, path, delta.value);
}

/**
 * Create an {@link A2uiSurfaceStore} — the per-conversation store that buffers
 * streamed A2UI v0.9 envelopes, tracks each surface's data model + lifecycle
 * state, and exposes them as signals for rendering. One store backs a chat
 * thread's A2UI surfaces.
 *
 * A surface becomes visible once its `createSurface` envelope has arrived AND
 * a component with id `root` has been defined (the v0.9 progressive-rendering
 * rule). Everything received earlier is buffered; afterwards, components merge
 * incrementally by id and data-model updates apply immediately.
 *
 * @returns A fresh, empty {@link A2uiSurfaceStore}.
 * @example
 * ```ts
 * const store = createA2uiSurfaceStore();
 * const surfaces = store.surfaces; // Signal<Map<string, A2uiSurface>>
 * ```
 */
export function createA2uiSurfaceStore(): A2uiSurfaceStore {
  const surfacesSignal = signal<Map<string, A2uiSurface>>(new Map());
  const surfaceStatesSignal = signal<Map<string, A2uiSurfaceState>>(new Map());
  const buffers = new Map<string, SurfaceBuffer>();

  function bufferOf(surfaceId: string): SurfaceBuffer {
    let b = buffers.get(surfaceId);
    if (!b) {
      b = { components: new Map(), componentViews: new Map(), dataModelDeltas: [] };
      buffers.set(surfaceId, b);
    }
    return b;
  }

  function publish(surface: A2uiSurface, views: Map<string, A2uiComponentView>): void {
    const nextSurfaces = new Map(surfacesSignal());
    nextSurfaces.set(surface.surfaceId, surface);
    surfacesSignal.set(nextSurfaces);
    const nextStates = new Map(surfaceStatesSignal());
    nextStates.set(surface.surfaceId, { surface, componentViews: views });
    surfaceStatesSignal.set(nextStates);
  }

  /** Recompute readiness/props for every view against `dataModel`,
   * honoring the monotonic ready rule. */
  function refreshViews(
    views: ReadonlyMap<string, A2uiComponentView>,
    dataModel: Record<string, unknown>,
  ): Map<string, A2uiComponentView> {
    const next = new Map<string, A2uiComponentView>();
    for (const [id, v] of views) {
      const allResolved = v.bindings.every((p) => isResolved(dataModel, p));
      // Monotonic: once ready=true, stays true even if a later update
      // clears a referenced path.
      const nextReady = v.ready || allResolved;
      next.set(id, {
        ...v,
        ready: nextReady,
        props: nextReady ? resolveViewProps(v.def, dataModel) : v.props,
      });
    }
    return next;
  }

  /** Commit the buffer to a live surface if the v0.9 render condition holds:
   * createSurface seen AND a `root` component defined. */
  function tryCommit(surfaceId: string): void {
    const b = buffers.get(surfaceId);
    if (!b || !b.create || !b.components.has('root')) return;

    let dataModel: Record<string, unknown> = {};
    for (const d of b.dataModelDeltas) {
      dataModel = applyDataModelDelta(dataModel, d);
    }

    const surface: A2uiSurface = {
      surfaceId,
      catalogId: b.create.catalogId,
      ...(b.create.theme ? { theme: b.create.theme } : {}),
      ...(b.create.sendDataModel !== undefined ? { sendDataModel: b.create.sendDataModel } : {}),
      components: new Map(b.components),
      dataModel,
    };
    publish(surface, refreshViews(b.componentViews, dataModel));
    buffers.delete(surfaceId);
  }

  function apply(message: A2uiMessage): void {
    if ('createSurface' in message) {
      const create = message.createSurface;
      const live = surfacesSignal().get(create.surfaceId);
      if (live) {
        // v0.9 calls createSurface-on-existing an agent error; tolerate it
        // as an idempotent refresh of the surface's create-time fields.
        const state = surfaceStatesSignal().get(create.surfaceId);
        const surface: A2uiSurface = {
          ...live,
          catalogId: create.catalogId,
          ...(create.theme !== undefined ? { theme: create.theme } : {}),
          ...(create.sendDataModel !== undefined ? { sendDataModel: create.sendDataModel } : {}),
        };
        publish(surface, new Map(state?.componentViews ?? []));
        return;
      }
      bufferOf(create.surfaceId).create = create;
      tryCommit(create.surfaceId);
      return;
    }
    if ('updateComponents' in message) {
      const upd = message.updateComponents as A2uiUpdateComponents;
      const live = surfacesSignal().get(upd.surfaceId);
      if (live) {
        // Incremental merge by id into the live surface.
        const components = new Map(live.components);
        const state = surfaceStatesSignal().get(upd.surfaceId);
        const views = new Map(state?.componentViews ?? []);
        for (const c of upd.components) {
          components.set(c.id, c);
          views.set(c.id, projectView(c));
        }
        const surface: A2uiSurface = { ...live, components };
        publish(surface, refreshViews(views, surface.dataModel));
        return;
      }
      const b = bufferOf(upd.surfaceId);
      for (const c of upd.components) {
        b.components.set(c.id, c);
        b.componentViews.set(c.id, projectView(c));
      }
      tryCommit(upd.surfaceId);
      return;
    }
    if ('updateDataModel' in message) {
      const upd = message.updateDataModel as A2uiUpdateDataModel;
      const delta = { path: upd.path, value: upd.value, del: !('value' in upd) || upd.value === undefined };
      const live = surfacesSignal().get(upd.surfaceId);
      if (live) {
        const dataModel = applyDataModelDelta(live.dataModel, delta);
        const surface: A2uiSurface = { ...live, dataModel };
        const state = surfaceStatesSignal().get(upd.surfaceId);
        publish(surface, refreshViews(state?.componentViews ?? new Map(), dataModel));
      } else {
        bufferOf(upd.surfaceId).dataModelDeltas.push(delta);
      }
      return;
    }
    if ('deleteSurface' in message) {
      const del = message.deleteSurface as A2uiDeleteSurface;
      buffers.delete(del.surfaceId);
      const next = new Map(surfacesSignal());
      next.delete(del.surfaceId);
      surfacesSignal.set(next);
      const nextStates = new Map(surfaceStatesSignal());
      nextStates.delete(del.surfaceId);
      surfaceStatesSignal.set(nextStates);
      return;
    }
  }

  function surface(surfaceId: string): Signal<A2uiSurface | undefined> {
    return computed(() => surfacesSignal().get(surfaceId));
  }

  function surfaceState(surfaceId: string): Signal<A2uiSurfaceState | undefined> {
    return computed(() => surfaceStatesSignal().get(surfaceId));
  }

  const liveTools = new Set<string>();

  function applyPartialArgs(
    toolCallId: string,
    envelopes: readonly A2uiMessage[],
  ): void {
    liveTools.add(toolCallId);
    for (const env of envelopes) {
      apply(env);
    }
  }

  function isPartialLive(toolCallId: string): boolean {
    return liveTools.has(toolCallId);
  }

  return {
    apply,
    applyPartialArgs,
    isPartialLive,
    surfaces: surfacesSignal.asReadonly(),
    surface,
    surfaceStates: surfaceStatesSignal.asReadonly(),
    surfaceState,
  };
}
