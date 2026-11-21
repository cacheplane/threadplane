import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { registerChatDevelopmentHost } from '../agent/development-host';
import { ensureChatRootStyles } from './chat-tokens';

/**
 * What the chat UI sets up once per application: the root style tokens every
 * chat component's styles read, and the development-install collector's
 * registration with the agent layer.
 *
 * Nothing runs when the package is imported, so a bundler may drop any part of
 * `@threadplane/angular/chat` an app does not use. The first chat component
 * created injects this token, which runs the setup in that application's
 * injector, against its `DOCUMENT`, so the tokens are rendered on the server
 * too.
 */
export const ɵCHAT_RUNTIME = new InjectionToken<true>('ɵCHAT_RUNTIME', {
  providedIn: 'root',
  factory: () => {
    // An injector with no platform has no DOCUMENT; the browser's is used then.
    ensureChatRootStyles(inject(DOCUMENT, { optional: true }) ?? undefined);
    registerChatDevelopmentHost();
    return true;
  },
});

/** Sets up the chat UI for this application, once. Call in an injection context. */
export function injectChatRuntime(): true {
  return inject(ɵCHAT_RUNTIME);
}
