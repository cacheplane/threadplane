import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { THREADPLANE_TELEMETRY_CONFIG, type ThreadplaneTelemetryConfig } from './tokens';
import { ThreadplaneTelemetryService } from './service';

/**
 * Configure ThreadplaneTelemetryService for an Angular app.
 *
 * Set `enabled: true` to enable this service's capture methods.
 * Delivery goes through `sink`, `endpoint`, or the legacy
 * PostHog options configured on `ThreadplaneTelemetryConfig`.
 */
export function provideThreadplaneTelemetry(config: ThreadplaneTelemetryConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: THREADPLANE_TELEMETRY_CONFIG, useValue: config },
    ThreadplaneTelemetryService,
  ]);
}
