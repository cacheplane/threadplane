// Connects agents to the development-install collector.
//
// `@threadplane/angular` builds every agent but may not import the telemetry
// package, and a backend's session knows neither. This package may import
// both, so loading it registers the collector with the agent layer: an app
// that provides an agent and renders anything from this package is connected
// with no further setup. Registering is inert. The collector itself decides
// whether anything is collected: only in an Angular development build, in a
// browser, for an agent whose session allows it, and never after an opt-out.
import { ɵsetAgentDevelopmentHost } from '@threadplane/angular';
import {
  createDevelopmentRuntime,
  registerDevelopmentRuntimePolicy,
  type DevelopmentRuntimeOptions,
} from '@threadplane/telemetry/browser';

ɵsetAgentDevelopmentHost({
  // The collector checks the integration, package name and version itself and
  // stays silent for anything it does not know.
  createRuntime: (install) =>
    createDevelopmentRuntime(install as DevelopmentRuntimeOptions),
  registerPolicy: registerDevelopmentRuntimePolicy,
});
