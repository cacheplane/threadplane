export { provideThreadplaneTelemetry } from './provide';
export { ThreadplaneTelemetryService } from './service';
export { THREADPLANE_TELEMETRY_CONFIG } from './tokens';
export type {
  ThreadplaneTelemetryConfig,
  ThreadplaneTelemetryEvent,
  ThreadplaneTelemetryEventPayload,
  ThreadplaneTelemetrySink,
} from './tokens';
export type {
  ThreadplaneBrowserEvent,
  ThreadplaneBrowserRuntimeTelemetry,
  ThreadplaneBrowserStreamErrorTelemetry,
  ThreadplaneBrowserStreamTelemetry,
} from './service';
export { isLocalAnalyticsHost, shouldCaptureAnalytics } from './properties';
export type { CaptureConfig } from './properties';
// Re-exported through the package name, so this entry point and
// `@threadplane/telemetry/browser/development` share one module instance (the
// runtime keeps module state). A relative path would inline a second copy.
/* eslint-disable @nx/enforce-module-boundaries */
export {
  createDevelopmentRuntime,
  setDevelopmentCollectionEnabled,
  getDevelopmentCollectionDiagnostics,
  DEVELOPMENT_COLLECTION_POLICY,
  registerDevelopmentRuntimePolicy,
  isDevelopmentRuntimeEnabled,
} from '@threadplane/telemetry/browser/development';
export type {
  DevelopmentRuntime,
  DevelopmentRuntimeOptions,
  DevelopmentMilestone,
} from '@threadplane/telemetry/browser/development';
/* eslint-enable @nx/enforce-module-boundaries */
