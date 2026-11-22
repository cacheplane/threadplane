import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { ensureChatRootStyles } from './chat-tokens';

/**
 * The root style tokens every chat component's styles read, added to the
 * application's document once, by the first chat component created.
 *
 * Nothing runs when a package is imported, so a bundler may drop any part of
 * the chat UI an app does not use. The token runs in that application's
 * injector, against its `DOCUMENT`, so the tokens are rendered on the server
 * too. The chat UI's own setup, `ɵCHAT_RUNTIME` in `@threadplane/angular/chat`,
 * injects this and also connects the development collector; the entry points
 * the chat UI loads on demand need only the styles.
 */
export const ɵCHAT_ROOT_STYLES = new InjectionToken<true>('ɵCHAT_ROOT_STYLES', {
  providedIn: 'root',
  factory: () => {
    // An injector with no platform has no DOCUMENT; the browser's is used then.
    ensureChatRootStyles(inject(DOCUMENT, { optional: true }) ?? undefined);
    return true;
  },
});

/** Adds the chat root style tokens to this application, once. Call in an injection context. */
export function injectChatRootStyles(): true {
  return inject(ɵCHAT_ROOT_STYLES);
}
