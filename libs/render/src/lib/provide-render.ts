import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { RenderConfig } from './render.types';
import { RENDER_LIFECYCLE } from './lifecycle';
import { RenderLifecycleService } from './render-lifecycle.service';

/** Injection token for the registry, state, functions, handlers, and telemetry options registered by provideRender. */
export const RENDER_CONFIG = new InjectionToken<RenderConfig>('RENDER_CONFIG');

/**
 * Bootstrap `@threadplane/render` in an Angular application or standalone
 * component tree.
 *
 * Registers the shared {@link RenderConfig} token and the internal
 * `RenderLifecycleService` that coordinates mount/unmount events across
 * dynamically rendered components. Call this once in `bootstrapApplication`
 * (or the root `ApplicationConfig`).
 *
 * @param config Options bag that controls the render feature set:
 *   - `registry` — component registry returned by {@link defineAngularRegistry};
 *     maps tool-call names to Angular components.
 *   - `store` — optional `StateStore` for `\@json-render/core` state binding.
 *   - `functions` — optional map of computed functions available inside specs.
 *   - `handlers` — optional map of event handlers triggered by spec actions.
 * @returns An `EnvironmentProviders` value suitable for the `providers` array
 *   of `bootstrapApplication` or `ApplicationConfig`.
 * @example
 * ```ts
 * // main.ts
 * import { bootstrapApplication } from '@angular/platform-browser';
 * import { defineAngularRegistry, provideRender } from '@threadplane/render';
 * import { DayCardComponent } from './day-card.component';
 *
 * const registry = defineAngularRegistry({ day_card: DayCardComponent });
 *
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideRender({ registry }),
 *   ],
 * });
 * ```
 */
export function provideRender(config: RenderConfig) {
  return makeEnvironmentProviders([
    { provide: RENDER_CONFIG, useValue: config },
    RenderLifecycleService,
    { provide: RENDER_LIFECYCLE, useExisting: RenderLifecycleService },
  ]);
}
