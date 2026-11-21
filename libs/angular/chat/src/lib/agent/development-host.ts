// Connects agents to the development-install collector.
//
// `@threadplane/angular`'s main entry point builds every agent but may not
// import the telemetry package, and a backend's session knows neither. The chat
// entry point may import both, so the chat runtime registers the collector with
// the agent layer when the first chat component is created: an app that
// provides an agent and renders chat is connected with no further setup. Calls
// a session made earlier wait for the registration. Registering is inert. The
// collector itself decides whether anything is collected: only in an Angular
// development build, in a browser, for an agent whose session allows it, and
// never after an opt-out.
import { ɵsetAgentDevelopmentHost } from '@threadplane/angular';
import {
  createDevelopmentRuntime,
  registerDevelopmentRuntimePolicy,
  type DevelopmentRuntimeOptions,
} from '@threadplane/telemetry/browser/development';

/** Registers the collector with the agent layer. Later calls do nothing. */
export function registerChatDevelopmentHost(): void {
  ɵsetAgentDevelopmentHost({
    // The collector checks the integration, package name and version itself and
    // stays silent for anything it does not know.
    createRuntime: (install) =>
      createDevelopmentRuntime(install as DevelopmentRuntimeOptions),
    registerPolicy: registerDevelopmentRuntimePolicy,
  });
}
