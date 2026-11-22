import { inject, InjectionToken } from '@angular/core';
import { ɵCHAT_ROOT_STYLES as CHAT_ROOT_STYLES } from '@threadplane/angular/chat/shared';
import { registerChatDevelopmentHost } from '../agent/development-host';

/**
 * What the chat UI sets up once per application: the root style tokens every
 * chat component's styles read, and the development-install collector's
 * registration with the agent layer.
 *
 * Nothing runs when the package is imported, so a bundler may drop any part of
 * `@threadplane/angular/chat` an app does not use. The first chat component
 * created injects this token, which runs the setup in that application's
 * injector, against its `DOCUMENT`, so the tokens are rendered on the server
 * too. The collector stays here, not in `@threadplane/angular/chat/shared`: the
 * entry points chat loads on demand share that one, and through it the
 * telemetry runtime would load with every chat app, even one that never shows
 * them.
 */
export const ɵCHAT_RUNTIME = new InjectionToken<true>('ɵCHAT_RUNTIME', {
  providedIn: 'root',
  factory: () => {
    inject(CHAT_ROOT_STYLES);
    registerChatDevelopmentHost();
    return true;
  },
});

/** Sets up the chat UI for this application, once. Call in an injection context. */
export function injectChatRuntime(): true {
  return inject(ɵCHAT_RUNTIME);
}
