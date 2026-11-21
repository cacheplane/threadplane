import type { Type } from '@angular/core';
import type { RenderViewEntry } from '@threadplane/angular/render';

/** Catalog entry for the A2UI surface renderer.
 *
 * `component` is mounted once all of the component's bindings (data
 * model paths referenced in its prop expressions) have resolved. While
 * any binding is unpopulated, the `fallback` is mounted instead. If
 * `fallback` is omitted, the lib's default fallback
 * (`A2uiDefaultFallbackComponent`) is mounted.
 *
 * This is a chat-side alias for the shared `RenderViewEntry` shape so
 * consumers of `@threadplane/angular/chat` don't have to import from `@threadplane/angular/render`. */
export type A2uiViewEntry = RenderViewEntry;

/** Catalog shape accepted by `<a2ui-surface>`. Each entry is either a
 * bare `Type<unknown>` (legacy shape — no per-component fallback) or
 * an `A2uiViewEntry`. */
export type A2uiViews = Readonly<Record<string, Type<unknown> | A2uiViewEntry>>;

/** Normalize a catalog entry to the `A2uiViewEntry` shape. Bare
 * `Type<unknown>` entries are wrapped as `{ component }`; entries
 * already in the discriminated shape are returned unchanged. */
export function normalizeViewEntry(
  entry: Type<unknown> | A2uiViewEntry,
): A2uiViewEntry {
  if (typeof entry === 'function') return { component: entry };
  return entry;
}
