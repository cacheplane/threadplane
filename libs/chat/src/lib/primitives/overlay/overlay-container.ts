// libs/chat/src/lib/primitives/overlay/overlay-container.ts

const CONTAINER_CLASS = 'chat-overlay-container';
const STYLE_ID = 'chat-overlay-structure';

// Structural CSS, injected once into <head> (same pattern as ROOT_TOKEN_STYLES
// in chat-tokens.ts) so consumers need not import any stylesheet.
const STRUCTURE_CSS = `
.${CONTAINER_CLASS} {
  position: fixed;
  inset: 0;
  z-index: var(--tplane-chat-z-overlay-container, 1000);
  pointer-events: none;
}
.chat-overlay-pane {
  position: absolute;
  pointer-events: auto;
}
`;

/** Returns the single shared overlay container appended to <body>, creating it
 *  (and injecting structural CSS) on first call. */
export function getOverlayContainer(doc: Document): HTMLElement {
  const existing = doc.querySelector<HTMLElement>('.' + CONTAINER_CLASS);
  if (existing) return existing;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STRUCTURE_CSS;
    doc.head.appendChild(style);
  }

  const container = doc.createElement('div');
  container.className = CONTAINER_CLASS;
  doc.body.appendChild(container);
  return container;
}
