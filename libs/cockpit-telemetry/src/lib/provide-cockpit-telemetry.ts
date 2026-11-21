import {
  makeEnvironmentProviders,
  type EnvironmentProviders,
  ENVIRONMENT_INITIALIZER,
  inject,
} from '@angular/core';
import { COCKPIT_TELEMETRY_CONFIG, type CockpitTelemetryConfig } from './tokens';
import { CockpitTelemetryService } from './cockpit-telemetry.service';
import { ActivationAggregator } from './activation-aggregator';

export function provideCockpitTelemetry(
  config: CockpitTelemetryConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: COCKPIT_TELEMETRY_CONFIG, useValue: config },
    ActivationAggregator,
    // AgentLifecycleRegistry is `providedIn: 'root'` in @threadplane/angular:
    // re-providing it here would shadow the instance every agent registers into.
    CockpitTelemetryService,
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useFactory: () => {
        const svc = inject(CockpitTelemetryService);
        return () => svc.init();
      },
    },
  ]);
}
