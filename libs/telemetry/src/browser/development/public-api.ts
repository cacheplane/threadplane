// The development runtime the Angular chat and render entry points use. It is
// its own entry point so that importing it never brings in the opt-in PostHog
// service of `@threadplane/telemetry/browser`, whose lazy `posthog-js` import a
// development server must resolve even when the application never calls it.
export {
  createDevelopmentRuntime,
  setDevelopmentCollectionEnabled,
  getDevelopmentCollectionDiagnostics,
  DEVELOPMENT_COLLECTION_POLICY,
  registerDevelopmentRuntimePolicy,
  isDevelopmentRuntimeEnabled,
} from './runtime';
export type {
  DevelopmentRuntime,
  DevelopmentRuntimeOptions,
  DevelopmentMilestone,
} from './types';
