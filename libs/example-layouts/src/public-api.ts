import { installEmbeddedTheme } from './lib/install-embedded-theme';

export { ExampleChatLayoutComponent } from './lib/example-chat-layout.component';
export { ExampleSplitLayoutComponent } from './lib/example-split-layout.component';
export { ExampleTranscriptDirective } from './lib/example-transcript.directive';
export { installEmbeddedTheme } from './lib/install-embedded-theme';

/*
 * Auto-install theme sync on module evaluation.
 *
 * Every cockpit example app imports at least one symbol from this
 * library (a layout component, typically). The act of importing
 * evaluates this module and triggers the side effect below — so apps'
 * `main.ts` files stay free of cockpit-specific boilerplate.
 *
 * `installEmbeddedTheme()` is benign when not iframed: it sets
 * `data-theme="dark"` + applies cssVars on `<html>`, posts to
 * `window.parent` (which equals `window` standalone, so the message
 * goes to self), and listens for `tplane:theme` events that don't
 * arrive unless a host (cockpit's `<ThemedFrame>`) is broadcasting.
 *
 * Guarded on `typeof document` so SSR doesn't crash.
 */
if (typeof document !== 'undefined') {
  installEmbeddedTheme();
}
