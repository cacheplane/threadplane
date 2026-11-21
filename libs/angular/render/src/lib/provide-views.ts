import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { ViewRegistry } from './views';

/** Injection token for the component view registry installed by provideViews. */
export const VIEW_REGISTRY = new InjectionToken<ViewRegistry>('VIEW_REGISTRY');

/**
 * Register a {@link ViewRegistry} for the render engine so generative-UI specs
 * can resolve element `type`s to Angular components. Provide at the application
 * (or a feature route's) environment injector.
 *
 * @param registry - Map of spec element types to the components that render them,
 *   typically built with `views()` / `withViews()`.
 * @returns Environment providers to spread into the `providers` array.
 * @example
 * ```ts
 * bootstrapApplication(App, {
 *   providers: [provideViews(views({ metric: MetricCardComponent }))],
 * });
 * ```
 */
export function provideViews(registry: ViewRegistry) {
  return makeEnvironmentProviders([
    { provide: VIEW_REGISTRY, useValue: registry },
  ]);
}
