import { bootstrapApplication } from '@angular/platform-browser';
import type {
  ApplicationConfig,
  InjectionToken,
  Provider,
  Type,
} from '@angular/core';
import {
  GENERATED_RUNTIME_PARENT_ORIGINS,
  installRuntimeBridge,
} from '@threadplane/cockpit-runtime-bridge';
import type { RuntimeBridgeConfiguration } from '@threadplane/cockpit-runtime-bridge';
import { readCockpitConfigFromIframe } from './distinct-id';
import {
  COCKPIT_RUNTIME_CONNECTION,
  type CockpitRuntimeConnection,
} from './runtime-connection';

export type CockpitRuntimeBootstrapTarget =
  | Readonly<{ adapter: 'none' }>
  | Readonly<{
      adapter: 'ag-ui';
      sharedUrl: string;
      operationReporterToken: CockpitRuntimeOperationReporterToken;
    }>
  | Readonly<{
      adapter: 'langgraph';
      sharedApiUrl: string;
      assistantId: string;
      operationReporterToken: CockpitRuntimeOperationReporterToken;
    }>;

export type CockpitRuntimeOperationFailureReporter = (
  code: 'unauthorized' | 'network_blocked'
) => void;

export type CockpitRuntimeOperationReporterToken =
  InjectionToken<CockpitRuntimeOperationFailureReporter>;

export type CockpitBootstrapOptions = Readonly<{
  runtime: CockpitRuntimeBootstrapTarget;
  allowedParentOrigins?: readonly string[];
}>;

class RuntimeConfigurationError extends Error {
  constructor() {
    super('The embedded runtime could not accept its configuration.');
    this.name = 'RuntimeConfigurationError';
  }
}

function sharedConnection(
  runtime: Exclude<CockpitRuntimeBootstrapTarget, { adapter: 'none' }>
): CockpitRuntimeConnection {
  return runtime.adapter === 'ag-ui'
    ? Object.freeze({ adapter: 'ag-ui', url: runtime.sharedUrl })
    : Object.freeze({
        adapter: 'langgraph',
        apiUrl: runtime.sharedApiUrl,
        assistantId: runtime.assistantId,
      });
}

function resolveConnection(
  runtime: Exclude<CockpitRuntimeBootstrapTarget, { adapter: 'none' }>,
  configuration: RuntimeBridgeConfiguration
): CockpitRuntimeConnection {
  if (configuration.status === 'error') throw new RuntimeConfigurationError();
  if (
    configuration.status === 'default' ||
    configuration.target.kind === 'shared'
  ) {
    return sharedConnection(runtime);
  }
  if (runtime.adapter === 'ag-ui' && configuration.target.kind === 'ag-ui') {
    return Object.freeze({
      adapter: 'ag-ui',
      url: configuration.target.endpoint,
    });
  }
  if (
    runtime.adapter === 'langgraph' &&
    configuration.target.kind === 'langsmith'
  ) {
    return Object.freeze({
      adapter: 'langgraph',
      apiUrl: configuration.target.apiUrl,
      assistantId: runtime.assistantId,
      // The developer-supplied deployment key rides as the SDK's own header
      // for this session; the adapter no longer accepts a key by name.
      clientOptions: Object.freeze({
        defaultHeaders: Object.freeze({ 'x-api-key': configuration.target.apiKey }),
      }),
    });
  }
  throw new RuntimeConfigurationError();
}

function operationReporterProvider(
  runtime: Exclude<CockpitRuntimeBootstrapTarget, { adapter: 'none' }>,
  configuration: RuntimeBridgeConfiguration
): Provider | null {
  if (configuration.status !== 'configured') return null;
  return {
    provide: runtime.operationReporterToken,
    useValue: configuration.reportOperationFailure,
  };
}

/**
 * Entry helper for every Cockpit Angular example.
 *
 * When the cockpit harness URL params are present, telemetry is wired in.
 * When absent, bootstraps without telemetry — the provider and its posthog-js
 * dependency stay outside the loaded module graph.
 *
 * This helper owns the page's single Angular bootstrap. Call it once from the
 * entry point so the page installs exactly one runtime bridge listener.
 */
export async function bootstrapWithCockpitHarness(
  component: Type<unknown>,
  appConfig: ApplicationConfig,
  options?: CockpitBootstrapOptions
): Promise<void> {
  const compatibleRuntime =
    options?.runtime.adapter !== undefined &&
    options.runtime.adapter !== 'none';
  const runtimeBridge = compatibleRuntime
    ? installRuntimeBridge(undefined, {
        allowedParentOrigins:
          options?.allowedParentOrigins ?? GENERATED_RUNTIME_PARENT_ORIGINS,
      })
    : installRuntimeBridge();
  const harness = readCockpitConfigFromIframe();

  try {
    const runtimeProviders: Provider[] = [];
    if (compatibleRuntime) {
      const configuration = await runtimeBridge.awaitConfiguration();
      runtimeProviders.push({
        provide: COCKPIT_RUNTIME_CONNECTION,
        useValue: resolveConnection(options.runtime, configuration),
      });
      const reporterProvider = operationReporterProvider(
        options.runtime,
        configuration
      );
      if (reporterProvider !== null) runtimeProviders.push(reporterProvider);
    }
    const providers = harness
      ? [
          ...runtimeProviders,
          ...(appConfig.providers ?? []),
          (await import('./provide-cockpit-telemetry')).provideCockpitTelemetry(
            harness
          ),
        ]
      : [...runtimeProviders, ...(appConfig.providers ?? [])];
    await bootstrapApplication(component, { ...appConfig, providers });
  } catch (error) {
    try {
      runtimeBridge.markError('bootstrap_failed');
    } catch {
      // Preserve the original bootstrap/configuration failure.
    }
    try {
      runtimeBridge.dispose();
    } catch {
      // Disposal is best-effort; never replace the original failure.
    }
    throw error;
  }

  runtimeBridge.markReady();
}
