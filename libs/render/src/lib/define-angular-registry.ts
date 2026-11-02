import { Type } from '@angular/core';
import type { AngularRegistry, NormalizedEntry, RenderViewEntry } from './render.types';
import { DefaultFallbackComponent } from './default-fallback.component';

type RegistryInput = Record<string, Type<unknown> | RenderViewEntry>;

function normalize(entry: Type<unknown> | RenderViewEntry): NormalizedEntry {
  if (typeof entry === 'function') {
    return { component: entry, fallback: DefaultFallbackComponent };
  }
  return {
    component: entry.component,
    fallback: entry.fallback ?? DefaultFallbackComponent,
    schema: entry.schema,
    description: entry.description,
  };
}

/**
 * Build an {@link AngularRegistry} from a plain object mapping tool-call names
 * to Angular components (or fully specified {@link RenderViewEntry} objects).
 *
 * The returned registry is consumed by `provideRender` to drive dynamic
 * component rendering.
 *
 * **Entry forms**
 * - Bare `Type<unknown>` — the component is paired with the built-in
 *   `DefaultFallbackComponent` while its props are still streaming.
 * - `RenderViewEntry` object — lets you supply a custom `fallback` component,
 *   an optional Standard Schema (`schema`) used as a mount-readiness gate, and
 *   an optional `description` for model-facing tool registration.
 *
 * **Registry accessor**
 * The returned object exposes a single `getEntry(name: string)` accessor that
 * returns the fully-normalized `NormalizedEntry` (component + fallback +
 * optional schema + optional description) or `undefined` when the name is not
 * registered. Use `names()` to enumerate all registered names.
 *
 * @param componentMap - Object whose keys are tool-call names and whose values
 *   are either bare Angular component classes or {@link RenderViewEntry} objects.
 * @returns An {@link AngularRegistry} with `getEntry` and `names` accessors.
 * @example
 * ```ts
 * import { defineAngularRegistry } from '@threadplane/render';
 * import { DayCardComponent } from './day-card.component';
 * import { LoadingSpinnerComponent } from './loading-spinner.component';
 * import { z } from 'zod';
 *
 * export const registry = defineAngularRegistry({
 *   // Bare component — uses DefaultFallbackComponent while streaming.
 *   summary_card: SummaryCardComponent,
 *
 *   // Full entry — custom fallback + schema-gated mounting.
 *   day_card: {
 *     component: DayCardComponent,
 *     fallback: LoadingSpinnerComponent,
 *     schema: z.object({ label: z.string(), day: z.number() }),
 *     description: 'Renders a single itinerary day card.',
 *   },
 * });
 *
 * // Look up a registered entry at runtime:
 * const entry = registry.getEntry('day_card'); // NormalizedEntry | undefined
 * ```
 */
export function defineAngularRegistry(componentMap: RegistryInput): AngularRegistry {
  const map = new Map<string, NormalizedEntry>();
  for (const [name, entry] of Object.entries(componentMap)) {
    map.set(name, normalize(entry));
  }
  return {
    getEntry: (name: string) => map.get(name),
    names: () => [...map.keys()],
  };
}
