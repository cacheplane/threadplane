// libs/chat/src/lib/styles/chat-tokens.ts

const LIGHT_TOKENS = `
  --tplane-chat-bg: rgb(255, 255, 255);
  --tplane-chat-surface: rgb(255, 255, 255);
  --tplane-chat-surface-alt: rgb(251, 251, 251);
  --tplane-chat-primary: rgb(28, 28, 28);
  --tplane-chat-on-primary: rgb(255, 255, 255);
  --tplane-chat-text: rgb(28, 28, 28);
  --tplane-chat-text-muted: rgb(115, 115, 115);
  --tplane-chat-separator: rgb(229, 229, 229);
  --tplane-chat-muted: rgb(200, 200, 200);
  --tplane-chat-error-bg: #fef2f2;
  --tplane-chat-error-border: #fecaca;
  --tplane-chat-error-text: #dc2626;
  --tplane-chat-destructive: #dc2626;
  --tplane-chat-warning-bg: #fffbeb;
  --tplane-chat-warning-text: #b45309;
  --tplane-chat-success: #16a34a;
  --tplane-chat-shadow-sm: 0 1px 2px rgba(0,0,0,.05);
  --tplane-chat-shadow-md: 0 4px 6px -1px rgba(0,0,0,.10), 0 2px 4px -1px rgba(0,0,0,.06);
  --tplane-chat-shadow-lg: 0 10px 15px -3px rgba(0,0,0,.10), 0 4px 6px -2px rgba(0,0,0,.05);

  /* --a2ui-* light variant */
  --a2ui-primary: #4f8df5;
  --a2ui-on-primary: #ffffff;
  --a2ui-primary-hover: #3a78e0;
  --a2ui-secondary: #5f6470;
  --a2ui-on-secondary: #ffffff;
  --a2ui-surface: #ffffff;
  --a2ui-on-surface: #1a1d23;
  --a2ui-surface-variant: rgba(0, 0, 0, 0.04);
  --a2ui-on-surface-variant: rgba(0, 0, 0, 0.6);
  --a2ui-outline: rgba(0, 0, 0, 0.12);
  --a2ui-outline-variant: rgba(0, 0, 0, 0.06);
  --a2ui-error: #dc2626;
  --a2ui-on-error: #ffffff;
  --a2ui-scrim: rgba(0, 0, 0, 0.4);
  --a2ui-elevation-0: none;
  --a2ui-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.06);
  --a2ui-elevation-2: 0 2px 4px rgba(0, 0, 0, 0.08);
  --a2ui-elevation-3: 0 4px 8px rgba(0, 0, 0, 0.10);
  --a2ui-elevation-4: 0 8px 16px rgba(0, 0, 0, 0.14);
  --a2ui-elevation-5: 0 16px 32px rgba(0, 0, 0, 0.18);

  /* --tplane-chat-citation-* — inline markers, preview card, sources panel */
  --tplane-chat-citation-accent: #1d4ed8;
  --tplane-chat-citation-accent-soft: #eaf1fd;
  --tplane-chat-citation-accent-border: #c9def8;
  --tplane-chat-citation-type-web-fg: var(--tplane-chat-citation-accent);
  --tplane-chat-citation-type-web-bg: var(--tplane-chat-citation-accent-soft);
  --tplane-chat-citation-type-web-border: var(--tplane-chat-citation-accent-border);
  --tplane-chat-citation-type-file-fg: #2f684c;
  --tplane-chat-citation-type-file-bg: #edf7f1;
  --tplane-chat-citation-type-file-border: #c8e4d2;
  --tplane-chat-citation-type-app-fg: #7a4d12;
  --tplane-chat-citation-type-app-bg: #fff5e3;
  --tplane-chat-citation-type-app-border: #f0d69f;
  --tplane-chat-citation-type-memory-fg: #67508f;
  --tplane-chat-citation-type-memory-bg: #f3effb;
  --tplane-chat-citation-type-memory-border: #ddd2f1;
  --tplane-chat-citation-type-generic-fg: #526071;
  --tplane-chat-citation-type-generic-bg: #f4f6f8;
  --tplane-chat-citation-type-generic-border: #dfe5ec;
  --tplane-chat-citation-marker-bg: #f1f2f4;
  --tplane-chat-citation-marker-border: var(--tplane-chat-separator);
  --tplane-chat-citation-marker-fg: #4b5563;
`;

const DARK_TOKENS = `
  --tplane-chat-bg: rgb(17, 17, 17);
  --tplane-chat-surface: rgb(28, 28, 28);
  --tplane-chat-surface-alt: rgb(44, 44, 44);
  --tplane-chat-primary: rgb(255, 255, 255);
  --tplane-chat-on-primary: rgb(28, 28, 28);
  --tplane-chat-text: rgb(245, 245, 245);
  --tplane-chat-text-muted: rgb(160, 160, 160);
  --tplane-chat-separator: rgb(45, 45, 45);
  --tplane-chat-muted: rgb(60, 60, 60);
  --tplane-chat-error-bg: rgb(45, 21, 21);
  --tplane-chat-error-border: #dc2626;
  --tplane-chat-error-text: #fca5a5;
  --tplane-chat-destructive: #ef4444;
  --tplane-chat-warning-bg: rgb(45, 35, 21);
  --tplane-chat-warning-text: #fbbf24;
  --tplane-chat-success: #4ade80;

  /* --a2ui-* dark variant (preserves current chat.css values) */
  --a2ui-primary: #4f8df5;
  --a2ui-on-primary: #ffffff;
  --a2ui-primary-hover: #6699f7;
  --a2ui-secondary: #8a92a3;
  --a2ui-on-secondary: #ffffff;
  --a2ui-surface: #1a1d23;
  --a2ui-on-surface: #ffffff;
  --a2ui-surface-variant: rgba(255, 255, 255, 0.05);
  --a2ui-on-surface-variant: rgba(255, 255, 255, 0.7);
  --a2ui-outline: rgba(255, 255, 255, 0.1);
  --a2ui-outline-variant: rgba(255, 255, 255, 0.05);
  --a2ui-error: #f5524f;
  --a2ui-on-error: #ffffff;
  --a2ui-scrim: rgba(0, 0, 0, 0.6);
  --a2ui-elevation-0: none;
  --a2ui-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --a2ui-elevation-2: 0 2px 4px rgba(0, 0, 0, 0.35);
  --a2ui-elevation-3: 0 4px 8px rgba(0, 0, 0, 0.4);
  --a2ui-elevation-4: 0 8px 16px rgba(0, 0, 0, 0.45);
  --a2ui-elevation-5: 0 16px 32px rgba(0, 0, 0, 0.5);

  /* --tplane-chat-citation-* dark variant */
  --tplane-chat-citation-accent: #6ea8ff;
  --tplane-chat-citation-accent-soft: rgba(79, 141, 245, 0.16);
  --tplane-chat-citation-accent-border: rgba(79, 141, 245, 0.38);
  --tplane-chat-citation-type-web-fg: var(--tplane-chat-citation-accent);
  --tplane-chat-citation-type-web-bg: var(--tplane-chat-citation-accent-soft);
  --tplane-chat-citation-type-web-border: var(--tplane-chat-citation-accent-border);
  --tplane-chat-citation-type-file-fg: #8bd3a9;
  --tplane-chat-citation-type-file-bg: rgba(47, 104, 76, 0.20);
  --tplane-chat-citation-type-file-border: rgba(139, 211, 169, 0.32);
  --tplane-chat-citation-type-app-fg: #f2c36f;
  --tplane-chat-citation-type-app-bg: rgba(122, 77, 18, 0.22);
  --tplane-chat-citation-type-app-border: rgba(242, 195, 111, 0.34);
  --tplane-chat-citation-type-memory-fg: #c4b5fd;
  --tplane-chat-citation-type-memory-bg: rgba(103, 80, 143, 0.26);
  --tplane-chat-citation-type-memory-border: rgba(196, 181, 253, 0.32);
  --tplane-chat-citation-type-generic-fg: #c9ccd1;
  --tplane-chat-citation-type-generic-bg: rgba(255,255,255,0.08);
  --tplane-chat-citation-type-generic-border: rgba(255,255,255,0.14);
  --tplane-chat-citation-marker-bg: rgba(255, 255, 255, 0.08);
  --tplane-chat-citation-marker-border: var(--tplane-chat-separator);
  --tplane-chat-citation-marker-fg: #c9ccd1;
`;

const GEOMETRY_TOKENS = `
  --tplane-chat-radius-bubble: 15px;
  --tplane-chat-radius-input: 20px;
  --tplane-chat-radius-card: 8px;
  --tplane-chat-radius-button: 8px;
  --tplane-chat-radius-launcher: 9999px;
  /* Distance from the viewport corner to the <chat-popup> launcher. The popup
     window tracks the horizontal offset so both move together. */
  --tplane-chat-launcher-offset-x: 1rem;
  --tplane-chat-launcher-offset-y: 1rem;
  --tplane-chat-max-width: 48rem;
  --tplane-chat-citation-radius: 6px;
`;

const TYPOGRAPHY_TOKENS = `
  --tplane-chat-font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  --tplane-chat-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --tplane-chat-font-size: 1rem;
  --tplane-chat-font-size-sm: 0.875rem;
  --tplane-chat-font-size-xs: 0.75rem;
  --tplane-chat-line-height: 1.6;
  --tplane-chat-line-height-tight: 1.5;
`;

const SPACING_TOKENS = `
  --tplane-chat-space-1: 4px;
  --tplane-chat-space-2: 8px;
  --tplane-chat-space-3: 12px;
  --tplane-chat-space-4: 16px;
  --tplane-chat-space-5: 20px;
  --tplane-chat-space-6: 24px;
  --tplane-chat-space-8: 32px;
  --tplane-chat-edge-pad: 16px;
  --tplane-chat-input-gap: 0.75rem;
  --tplane-chat-sidenav-width-expanded: 280px;
  --tplane-chat-sidenav-width-collapsed: 56px;
  --tplane-chat-sidenav-width-drawer: 280px;
`;

const LAYER_TOKENS = `
  /* Z-index layers — documented for consumers + future primitives.
   * Default values listed; overridable per-app via :root or :host.
   * Modal layers sit above drawer so palettes/dialogs stay reachable
   * when the drawer is open. */
  --tplane-chat-z-overlay-content: 30;   /* chat-sidebar panel, chat-popup window */
  --tplane-chat-z-drawer-scrim: 1000;    /* chat-sidenav-scrim backdrop */
  --tplane-chat-z-drawer: 1001;          /* chat-sidenav drawer mode host */
  --tplane-chat-z-modal-scrim: 1100;     /* chat-history-search-palette backdrop */
  --tplane-chat-z-modal: 1101;           /* chat-history-search-palette dialog */
`;

const EDGE_CLAIM_TOKENS = `
  /* Edge-claim primitive — peer-aware panel coexistence.
     Each docked panel publishes the edge it occupies via a
     data-threadplane-chat-* attribute on <html>; other panels read these
     custom properties to leave room. Defaults to 0px so consumers
     not using chat-sidebar/chat-debug see zero overhead.

     TWO LAYERS:
     1. Per-component claim vars (--tplane-chat-<component>-claim-<edge>)
        are read by PEERS only — never by the component that wrote
        them. This eliminates self-feedback (where a right-docked
        panel would offset itself by reading its own claim).
     2. Aggregate occupy-* vars are convenience reads for external
        consumers and for cases where any-panel-on-edge matters. */
  --tplane-chat-occupy-top:    0px;
  --tplane-chat-occupy-right:  0px;
  --tplane-chat-occupy-bottom: 0px;
  --tplane-chat-occupy-left:   0px;

  /* Per-component claims (peer-only reads). */
  --tplane-chat-sidebar-claim-right:  0px;
  --tplane-chat-debug-claim-top:      0px;
  --tplane-chat-debug-claim-right:    0px;
  --tplane-chat-debug-claim-bottom:   0px;
  --tplane-chat-debug-claim-left:     0px;

  /* Sizes the chat-debug dock contributes when it claims an edge.
     Split by orientation so consumers can override independently. */
  --tplane-chat-debug-panel-size-h: 40vh;
  --tplane-chat-debug-panel-size-w: 420px;
`;

const KEYFRAMES = `
  @keyframes tplane-chat-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes tplane-chat-typing-dot {
    0%, 80%, 100% { transform: scale(0.5); opacity: 0.5; }
    40% { transform: scale(1); opacity: 1; }
  }
  @keyframes tplane-chat-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes tplane-chat-caret-blink {
    0%, 50% { opacity: 1; }
    50.01%, 100% { opacity: 0; }
  }
  @keyframes tplane-chat-caret-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes tplane-chat-welcome-mount {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

/**
 * Component-scoped styles. Imported into every chat component's `styles`
 * array. Carries only:
 *   - `:host` font-family + color (so the component inherits text styling)
 *   - keyframes the components use
 *
 * Token *defaults* are NOT set on `:host` — they're set on `:root` via the
 * shared style element below (`ensureChatRootStyles()`). That shift is what
 * makes the documented `:root { --tplane-chat-*: ... }` consumer override
 * actually work, because direct-on-host token settings would shadow
 * inheritance regardless of CSS specificity.
 */
export const CHAT_HOST_TOKENS = `
  :host {
    font-family: var(--tplane-chat-font-family);
    color: var(--tplane-chat-text);
  }
`;
// Note: @keyframes are NOT placed in CHAT_HOST_TOKENS. Angular's emulated
// view encapsulation scopes @keyframes names per-component, which can
// desynchronise from animation property references when styles are
// concatenated across helper strings. They're injected globally via
// ROOT_TOKEN_STYLES below so the names match what `animation: tplane-chat-*`
// references in component styles (which Angular leaves untouched).

/**
 * Elements that loop an animation indefinitely. Under reduced motion each
 * one gets `animation: none` plus a static, fully visible state, because
 * the universal `iteration-count: 1` rule alone would freeze it mid-loop,
 * which reads as a bug.
 *
 * Every entry must target a class that a chat component actually renders
 * with an infinite animation; `chat-tokens.spec.ts` scans the component
 * styles and fails if this list misses one or names a class that no
 * longer exists.
 */
export const REDUCED_MOTION_LOOP_SELECTORS: readonly string[] = [
  '.tcc__pill[data-status="running"] svg',
  '.chat-typing__dot',
  '.chat-scroll-bubble__dot',
  '.chat-message__caret',
  '.chat-reasoning__pulse',
  '.chat-trace__label',
  '.chat-genui-skeleton__row',
  '.a2ui-default-fallback__row',
  '.chat-history-search-palette__skeleton-row',
  '.chat-sidenav__debug-dot--streaming',
  '.chat-welcome__beacon',
  'chat-debug .launcher__dot--streaming',
];

/**
 * WCAG 2.3.3 — honor the OS-level "Reduce Motion" preference. Collapses
 * every transition/animation in the chat lib (and the a2ui catalog,
 * which renders in the same document) to instant. The `!important`
 * flag intentionally overrides any inline `style="transition: ..."`
 * applied by future code — accessibility wins.
 *
 * Infinite-loop indicators (see `REDUCED_MOTION_LOOP_SELECTORS`) get
 * explicit `animation: none`.
 */
const REDUCED_MOTION_STYLES = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  ${REDUCED_MOTION_LOOP_SELECTORS.join(',\n  ')} {
    animation: none !important;
    opacity: 1 !important;
  }

  .tcc__pill[data-status="running"] svg {
    transform: none !important;
  }
}
`;

/**
 * Token defaults written to `<head>` once on first chat-component
 * construction. Wrapped in `@layer tplane-chat` so the consumer's unlayered
 * `:root { --tplane-chat-*: ... }` rule beats the lib's defaults regardless
 * of source order — the standard CSS pattern for framework defaults.
 *
 * Theme switching:
 *   - `prefers-color-scheme: dark` → dark by default.
 *   - `[data-theme="dark"]` on `<html>` / `<body>` / any wrapper
 *     forces dark.
 *   - `[data-theme="light"]` forces light.
 */
const A2UI_INVARIANT_TOKENS = `
  /* --a2ui-* theme-invariant tokens (spacing, typography, shape, motion, focus, aliases) */

  /* Spacing scale (4px base) */
  --a2ui-spacing-1: 4px;
  --a2ui-spacing-2: 8px;
  --a2ui-spacing-3: 12px;
  --a2ui-spacing-4: 16px;
  --a2ui-spacing-5: 24px;
  --a2ui-spacing-6: 32px;
  --a2ui-spacing-7: 40px;

  /* Typography (per Text usageHint) */
  --a2ui-typography-h1-size: 32px;
  --a2ui-typography-h1-weight: 700;
  --a2ui-typography-h1-line-height: 1.2;
  --a2ui-typography-h2-size: 24px;
  --a2ui-typography-h2-weight: 600;
  --a2ui-typography-h2-line-height: 1.3;
  --a2ui-typography-h3-size: 20px;
  --a2ui-typography-h3-weight: 600;
  --a2ui-typography-h3-line-height: 1.3;
  --a2ui-typography-h4-size: 18px;
  --a2ui-typography-h4-weight: 500;
  --a2ui-typography-h4-line-height: 1.4;
  --a2ui-typography-h5-size: 16px;
  --a2ui-typography-h5-weight: 500;
  --a2ui-typography-h5-line-height: 1.4;
  --a2ui-typography-body-size: 14px;
  --a2ui-typography-body-weight: 400;
  --a2ui-typography-body-line-height: 1.5;
  --a2ui-typography-caption-size: 12px;
  --a2ui-typography-caption-weight: 400;
  --a2ui-typography-caption-line-height: 1.4;
  --a2ui-typography-label-size: 12px;
  --a2ui-typography-label-weight: 500;

  /* Shape radius */
  --a2ui-shape-extra-small: 4px;
  --a2ui-shape-small: 8px;
  --a2ui-shape-medium: 12px;
  --a2ui-shape-large: 16px;
  --a2ui-shape-extra-large: 28px;

  /* Focus ring */
  --a2ui-focus-ring-color: var(--a2ui-primary);
  --a2ui-focus-ring-width: 2px;

  /* Motion */
  --a2ui-motion-duration-short: 100ms;
  --a2ui-motion-duration-medium: 200ms;
  --a2ui-motion-duration-long: 300ms;
  --a2ui-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --a2ui-motion-easing-emphasized: cubic-bezier(0.2, 0, 0, 1.4);

  /* Aliases (kept for back-compat) */
  --a2ui-card-bg: var(--a2ui-surface);
  --a2ui-input-bg: var(--a2ui-surface-variant);
  --a2ui-input-text: var(--a2ui-on-surface);
  --a2ui-label: var(--a2ui-on-surface-variant);
  --a2ui-caption: var(--a2ui-on-surface-variant);
  --a2ui-border: var(--a2ui-outline);
`;

export const ROOT_TOKEN_STYLES = `
@layer tplane-chat {
  :root {
    ${LIGHT_TOKENS}
    ${GEOMETRY_TOKENS}
    ${TYPOGRAPHY_TOKENS}
    ${SPACING_TOKENS}
    ${LAYER_TOKENS}
    ${EDGE_CLAIM_TOKENS}
    ${A2UI_INVARIANT_TOKENS}
  }
  @media (prefers-color-scheme: dark) {
    :root { ${DARK_TOKENS} }
  }
  :root[data-theme="light"],
  [data-theme="light"],
  :root[data-threadplane-chat-theme="light"],
  [data-threadplane-chat-theme="light"] { ${LIGHT_TOKENS} }
  :root[data-theme="dark"],
  [data-theme="dark"],
  :root[data-threadplane-chat-theme="dark"],
  [data-threadplane-chat-theme="dark"] { ${DARK_TOKENS} }

  /* Edge-claim attribute mappings.
     chat-sidebar sets data-threadplane-chat-sidebar="open" while its panel is open.
     chat-debug sets data-threadplane-chat-debug to its current dock while open. */
  :root[data-threadplane-chat-sidebar="open"] {
    --tplane-chat-sidebar-claim-right: var(--tplane-chat-sidebar-width-drawer, 28rem);
    --tplane-chat-occupy-right: var(--tplane-chat-sidebar-width-drawer, 28rem);
  }
  :root[data-threadplane-chat-debug="bottom"] {
    --tplane-chat-debug-claim-bottom: var(--tplane-chat-debug-panel-size-h, 40vh);
    --tplane-chat-occupy-bottom: var(--tplane-chat-debug-panel-size-h, 40vh);
  }
  :root[data-threadplane-chat-debug="right"] {
    --tplane-chat-debug-claim-right: var(--tplane-chat-debug-panel-size-w, 420px);
    --tplane-chat-occupy-right: var(--tplane-chat-debug-panel-size-w, 420px);
  }
  :root[data-threadplane-chat-debug="left"] {
    --tplane-chat-debug-claim-left: var(--tplane-chat-debug-panel-size-w, 420px);
    --tplane-chat-occupy-left: var(--tplane-chat-debug-panel-size-w, 420px);
  }
}
${KEYFRAMES}
${REDUCED_MOTION_STYLES}
`;

const STYLE_ELEMENT_ID = 'tplane-chat-root-tokens';

/**
 * Idempotent: appends a `<style id="tplane-chat-root-tokens">` to `<head>`
 * the first time it's called. Subsequent calls are no-ops.
 *
 * No-op outside the browser (server-side rendering).
 */
export function ensureChatRootStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = ROOT_TOKEN_STYLES;
  document.head.appendChild(style);
}

// Auto-inject on module evaluation. Every chat component imports
// `CHAT_HOST_TOKENS` from this file, so the first chat component to load
// triggers this once. Safe to evaluate eagerly: idempotent + SSR-guarded.
//
// Note: this side-effect call is the "fast path" — it normally fires
// during the first chat-component import on the client. But production
// bundlers with aggressive tree-shaking can drop it if they treat the
// published artifact as side-effect-free (the published `sideEffects`
// field doesn't match the bundled fesm filename, and TS-path consumers
// route through the source where it does match). The top-level chat
// compositions (`ChatComponent`, `ChatPopupComponent`,
// `ChatSidebarComponent`, `ChatDebugComponent`) also call this from
// their constructors so the injection is guaranteed even when the
// module-eval call gets stripped. Both paths are idempotent.
ensureChatRootStyles();
