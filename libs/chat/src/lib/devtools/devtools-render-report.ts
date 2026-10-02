import { DestroyRef, inject, isDevMode, type Provider } from '@angular/core';
import {
  ɵRENDER_DEVTOOLS,
  type ɵRenderDevtoolsHook,
  type ɵRenderElementState,
  type ɵRenderResolution,
} from '@threadplane/render';
declare const ngDevMode: boolean;

/**
 * The render report the AG-UI DevTools extension validates (U4 of its UI
 * inspector design). Dispatched as the same `threadplane:devtools`
 * `CustomEvent` as the signals report, told apart by `kind`. Names, keys,
 * types and states only — never prop values.
 */
export interface RenderDevtoolsReport {
  v: 1;
  kind: 'render';
  /** The A2UI `surfaceId`, or `'spec:' + root key` for a json-render spec; 1–128 chars. */
  surface: string;
  /** Per page, from 1, across every surface. */
  seq: number;
  /** The registry's names, at most 500, each 1–128 chars. */
  registry: string[];
  /** At most 2,000 elements, root first. */
  elements: { key: string; type: string; state: ɵRenderElementState }[];
  /** `performance.now()` when the report was built. */
  tMs: number;
}

export const MAX_RENDER_SURFACE_LENGTH = 128;
export const MAX_RENDER_NAME_LENGTH = 128;
export const MAX_RENDER_REGISTRY = 500;
export const MAX_RENDER_ELEMENTS = 2000;
/** Changes within this window after the first one coalesce into one report. */
export const RENDER_REPORT_WINDOW_MS = 50;

/** A render hook that can be torn down with the surface that provided it. */
export interface RenderDevtoolsReporter extends ɵRenderDevtoolsHook {
  dispose(): void;
}

type DevtoolsWindow = Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

let pageSeq = 0;

/**
 * Creates the development-only render reporter for one rendered surface, or
 * `null` in production builds, outside a browser, or when the page set
 * `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true` — the signals emitter's
 * gate and opt-out.
 *
 * `surfaceId` names the surface; when it returns nothing, the surface is
 * `'spec:' + root key`. Changes coalesce for {@link RENDER_REPORT_WINDOW_MS},
 * and a report is dispatched only when the surface's resolution differs from
 * the last one this reporter dispatched.
 *
 * @internal Seam between `@threadplane/render` and the AG-UI DevTools extension; not a public API.
 */
export function ɵcreateRenderDevtoolsReporter(
  surfaceId: () => string | null | undefined = () => undefined,
): RenderDevtoolsReporter | null {
  // Production builds define ngDevMode as false, which folds this branch away
  // and with it the reporter (see scripts/verify-devtools-bundle.mjs).
  if ((typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode()) {
    return createDevelopmentReporter(surfaceId);
  }
  return null;
}

/**
 * Provides the render hook to the `<render-spec>` in a component's view, torn
 * down with the component. `surfaceId` runs in the provider's injection
 * context and returns the getter for the surface's id.
 *
 * @internal Used by `<a2ui-surface>` and `<chat-generative-ui>`.
 */
export function ɵprovideRenderDevtools(
  surfaceId?: () => () => string | null | undefined,
): Provider {
  return {
    provide: ɵRENDER_DEVTOOLS,
    useFactory: (): RenderDevtoolsReporter | null => {
      if (!((typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode())) return null;
      const reporter = ɵcreateRenderDevtoolsReporter(surfaceId?.());
      if (reporter) inject(DestroyRef).onDestroy(() => reporter.dispose());
      return reporter;
    },
  };
}

function createDevelopmentReporter(
  surfaceId: () => string | null | undefined,
): RenderDevtoolsReporter | null {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return null;
  if (optedOut()) return null;

  let pending: (() => ɵRenderResolution | null) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '';
  let disposed = false;

  const flush = (): void => {
    timer = undefined;
    const read = pending;
    pending = null;
    if (!read || disposed || optedOut()) return;
    let report: RenderDevtoolsReport | null;
    try {
      const resolution = read();
      report = resolution ? toReport(resolution, surfaceId()) : null;
    } catch {
      // Devtools must never break the surface it describes.
      return;
    }
    if (!report) return;
    const signature = JSON.stringify([report.surface, report.registry, report.elements]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    pageSeq += 1;
    report.seq = pageSeq;
    try {
      window.dispatchEvent(new CustomEvent('threadplane:devtools', { detail: report }));
    } catch {
      // A throwing listener must never break the surface that reported.
    }
  };

  return {
    changed(read) {
      if (disposed) return;
      pending = read;
      if (timer === undefined) timer = setTimeout(flush, RENDER_REPORT_WINDOW_MS);
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Bounds a resolution to the contract. Nothing is truncated into a different
 * name: a surface id that does not fit means no report; a registry name, key
 * or type that does not fit drops that name or element; past the caps, the
 * extras are dropped in order (registry order, then the resolution's
 * root-first order).
 */
function toReport(resolution: ɵRenderResolution, id: string | null | undefined): RenderDevtoolsReport | null {
  const surface = typeof id === 'string' && id.length > 0 ? id : `spec:${resolution.root}`;
  if (!fits(surface, MAX_RENDER_SURFACE_LENGTH)) return null;

  const registry: string[] = [];
  const names = new Set<string>();
  for (const name of resolution.registry) {
    if (registry.length >= MAX_RENDER_REGISTRY) break;
    if (!fits(name, MAX_RENDER_NAME_LENGTH) || names.has(name)) continue;
    names.add(name);
    registry.push(name);
  }

  const elements: RenderDevtoolsReport['elements'] = [];
  for (const { key, type, state } of resolution.elements) {
    if (elements.length >= MAX_RENDER_ELEMENTS) break;
    if (!fits(key, MAX_RENDER_NAME_LENGTH) || !fits(type, MAX_RENDER_NAME_LENGTH)) continue;
    elements.push({ key, type, state });
  }

  return { v: 1, kind: 'render', surface, seq: 0, registry, elements, tMs: now() };
}

function fits(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function optedOut(): boolean {
  try {
    return (window as DevtoolsWindow).__THREADPLANE_DEVTOOLS_DISABLED__ === true;
  } catch {
    return true;
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
