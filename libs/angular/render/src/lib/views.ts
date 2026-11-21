import { Type } from '@angular/core';
import type { AngularRegistry, RenderViewEntry } from './render.types';
import { defineAngularRegistry } from './define-angular-registry';

/**
 * A registry of view components available for generative UI rendering.
 * Each entry is either a bare component Type (legacy shape) or a
 * `RenderViewEntry` with the shape `{ component, fallback? }`.
 */
export type ViewRegistry = Readonly<Record<string, Type<unknown> | RenderViewEntry>>;

/**
 * Creates a view registry from a name → component map.
 *
 * @example
 * ```ts
 * const registry = views({ metric: MetricCardComponent, chart: ChartComponent });
 * // providers: [provideViews(registry)]
 * ```
 */
export function views(map: Record<string, Type<unknown> | RenderViewEntry>): ViewRegistry {
  return Object.freeze({ ...map });
}

/**
 * Adds views to a registry without overwriting existing entries.
 * New keys are added; keys that already exist in `base` are preserved.
 *
 * @example
 * ```ts
 * const extended = withViews(a2uiBasicCatalog(), { MyWidget: MyWidgetComponent });
 * ```
 */
export function withViews(
  base: ViewRegistry,
  additions: Record<string, Type<unknown> | RenderViewEntry>,
): ViewRegistry {
  return Object.freeze({ ...additions, ...base });
}

/**
 * Replaces views in a registry. Keys in `overrides` win over `base`.
 * Use this to swap an existing renderer; use `withViews` to add NEW
 * node types without touching existing entries.
 *
 * @example
 * ```ts
 * const themed = overrideViews(a2uiBasicCatalog(), { Card: MyCardComponent });
 * ```
 */
export function overrideViews(
  base: ViewRegistry,
  overrides: Record<string, Type<unknown> | RenderViewEntry>,
): ViewRegistry {
  return Object.freeze({ ...base, ...overrides });
}

/**
 * Removes views from a registry by name.
 *
 * @example
 * ```ts
 * const trimmed = withoutViews(a2uiBasicCatalog(), 'Video', 'AudioPlayer');
 * ```
 */
export function withoutViews(
  base: ViewRegistry,
  ...names: string[]
): ViewRegistry {
  const result = { ...base };
  for (const name of names) delete result[name];
  return Object.freeze(result);
}

/**
 * Converts a ViewRegistry to an AngularRegistry for use with RenderSpecComponent.
 *
 * @example
 * ```ts
 * const registry = toRenderRegistry(views({ metric: MetricCardComponent }));
 * ```
 */
export function toRenderRegistry(registry: ViewRegistry): AngularRegistry {
  return defineAngularRegistry(registry);
}
