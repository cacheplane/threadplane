// libs/chat/src/lib/styles/chat-citations.styles.ts

const CHAT_CITATION_SOURCE_VISUAL_STYLES = `
  .chat-citation-source-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--tplane-chat-radius-sm);
    border: 1px solid currentColor;
  }
  .chat-citation-source-icon svg {
    width: 12px;
    height: 12px;
    display: block;
  }
  .chat-citation-source-icon--sm {
    width: 14px;
    height: 14px;
    border-radius: var(--tplane-chat-radius-sm);
  }
  .chat-citation-source-icon--sm svg {
    width: 9px;
    height: 9px;
  }
  .chat-citation-source-icon--web {
    color: var(--tplane-chat-citation-type-web-fg);
    background: var(--tplane-chat-citation-type-web-bg);
    border-color: var(--tplane-chat-citation-type-web-border);
  }
  .chat-citation-source-icon--file {
    color: var(--tplane-chat-citation-type-file-fg);
    background: var(--tplane-chat-citation-type-file-bg);
    border-color: var(--tplane-chat-citation-type-file-border);
  }
  .chat-citation-source-icon--app {
    color: var(--tplane-chat-citation-type-app-fg);
    background: var(--tplane-chat-citation-type-app-bg);
    border-color: var(--tplane-chat-citation-type-app-border);
  }
  .chat-citation-source-icon--memory {
    color: var(--tplane-chat-citation-type-memory-fg);
    background: var(--tplane-chat-citation-type-memory-bg);
    border-color: var(--tplane-chat-citation-type-memory-border);
  }
  .chat-citation-source-icon--generic {
    color: var(--tplane-chat-citation-type-generic-fg);
    background: var(--tplane-chat-citation-type-generic-bg);
    border-color: var(--tplane-chat-citation-type-generic-border);
  }
  .chat-citation-type-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    max-width: 120px;
    box-sizing: border-box;
    padding: 1px 6px;
    border: 1px solid currentColor;
    border-radius: var(--tplane-chat-radius-launcher);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
  }
  .chat-citation-type-badge--web {
    color: var(--tplane-chat-citation-type-web-fg);
    background: var(--tplane-chat-citation-type-web-bg);
    border-color: var(--tplane-chat-citation-type-web-border);
  }
  .chat-citation-type-badge--file {
    color: var(--tplane-chat-citation-type-file-fg);
    background: var(--tplane-chat-citation-type-file-bg);
    border-color: var(--tplane-chat-citation-type-file-border);
  }
  .chat-citation-type-badge--app {
    color: var(--tplane-chat-citation-type-app-fg);
    background: var(--tplane-chat-citation-type-app-bg);
    border-color: var(--tplane-chat-citation-type-app-border);
  }
  .chat-citation-type-badge--memory {
    color: var(--tplane-chat-citation-type-memory-fg);
    background: var(--tplane-chat-citation-type-memory-bg);
    border-color: var(--tplane-chat-citation-type-memory-border);
  }
  .chat-citation-type-badge--generic {
    color: var(--tplane-chat-citation-type-generic-fg);
    background: var(--tplane-chat-citation-type-generic-bg);
    border-color: var(--tplane-chat-citation-type-generic-border);
  }
`;

/** Inline pill marker (chat-md-citation-reference). */
export const CHAT_CITATION_MARKER_STYLES = `
  :host { display: inline; }
  /* A plain inline box, not inline-flex: an atomic inline is a line-break
     opportunity on both sides, which strands the punctuation after a marker
     at the start of the next line. As inline text, its digits follow the
     normal rule of no break before . , ; : ) — in every engine. */
  .chat-citation-marker {
    display: inline;
    padding: 2px var(--tplane-chat-space-1);
    margin: 0 1px;
    font-size: var(--tplane-chat-font-size-xs);
    font-weight: 600;
    line-height: 1;
    text-align: center;
    color: var(--tplane-chat-citation-marker-fg);
    background: var(--tplane-chat-citation-marker-bg);
    border: 1px solid var(--tplane-chat-citation-marker-border);
    border-radius: var(--tplane-chat-citation-radius);
    /* translate does not apply to inline boxes; lift the pill the same 1px. */
    position: relative;
    top: -1px;
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-citation-marker:hover,
  .chat-citation-marker:focus-visible {
    background: var(--tplane-chat-citation-accent-soft);
    border-color: var(--tplane-chat-citation-accent-border);
    color: var(--tplane-chat-citation-accent);
  }
  .chat-citation-marker:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-citation-marker--unresolved {
    color: var(--tplane-chat-text-muted);
    background: transparent;
    border-style: dashed;
    cursor: default;
  }
  .chat-citation-marker--unresolved:hover {
    background: transparent;
    border-color: var(--tplane-chat-citation-marker-border);
    color: var(--tplane-chat-text-muted);
  }
  .chat-citation-marker--no-url {
    cursor: help;
  }
`;

/** Provenance preview card (chat-citation-preview), portaled into the overlay pane. */
export const CHAT_CITATION_PREVIEW_STYLES = `
  ${CHAT_CITATION_SOURCE_VISUAL_STYLES}
  :host { display: block; }
  .chat-citation-preview {
    width: 320px;
    max-width: calc(100vw - 24px);
    box-sizing: border-box;
    background: var(--tplane-chat-surface);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    box-shadow: var(--tplane-chat-elevation-float);
    padding: var(--tplane-chat-space-3);
    text-align: left;
    color: var(--tplane-chat-text);
  }
  .chat-citation-preview__head {
    display: flex;
    align-items: center;
    gap: var(--tplane-chat-space-2);
    margin-bottom: var(--tplane-chat-space-2);
  }
  .chat-citation-preview__fav {
    width: 16px; height: 16px;
    border-radius: var(--tplane-chat-radius-sm);
    flex: 0 0 auto;
    object-fit: cover;
  }
  .chat-citation-preview__fav--mono {
    display: flex; align-items: center; justify-content: center;
    color: var(--a2ui-on-primary); font-size: 10px; font-weight: 700;
  }
  .chat-citation-preview__domain {
    font-size: 12px;
    color: var(--tplane-chat-text-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chat-citation-preview__type {
    margin-left: auto;
    font-size: var(--tplane-chat-font-size-xs);
    flex: 0 0 auto;
  }
  .chat-citation-preview__title {
    font-size: 14px; font-weight: 600; line-height: 1.35;
    margin: 0 0 5px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .chat-citation-preview__snippet {
    font-size: 12.5px; color: var(--tplane-chat-text-muted); line-height: 1.5;
    margin: 0;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .chat-citation-preview__foot {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 10px; padding-top: 9px;
    border-top: 1px solid var(--tplane-chat-separator);
  }
  .chat-citation-preview__open {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; font-weight: 600;
    color: var(--tplane-chat-citation-accent);
    text-decoration: none;
  }
  .chat-citation-preview__open:hover { text-decoration: underline; }
  .chat-citation-preview__meta { font-size: var(--tplane-chat-font-size-xs); color: var(--tplane-chat-text-muted); }
`;

/** Sources panel (chat-citations) + detail card (chat-citations-card). */
export const CHAT_CITATIONS_PANEL_STYLES = `
  ${CHAT_CITATION_SOURCE_VISUAL_STYLES}
  :host { display: block; }
  .chat-citations {
    margin-top: var(--tplane-chat-space-5);
    padding-top: var(--tplane-chat-space-4);
    border-top: 1px solid var(--tplane-chat-separator);
  }
  .chat-citations__header {
    display: flex; align-items: center; gap: var(--tplane-chat-space-2);
    /* Padded hit area pulled back by the same amount, so the label stays on the
       text column and the focus ring has room around it. */
    box-sizing: border-box;
    width: calc(100% + 2 * var(--tplane-chat-space-1));
    margin: calc(-1 * var(--tplane-chat-space-1));
    margin-bottom: var(--tplane-chat-space-2);
    padding: var(--tplane-chat-space-1);
    background: none; border: 0;
    border-radius: var(--tplane-chat-radius-button);
    font: inherit; color: inherit;
    cursor: pointer; text-align: left;
  }
  .chat-citations__header:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 0;
  }
  .chat-citations__heading { font-size: var(--tplane-chat-font-size-sm); font-weight: 600; }
  .chat-citations__count {
    font-size: var(--tplane-chat-font-size-xs); font-weight: 600;
    color: var(--tplane-chat-text-muted);
    background: var(--tplane-chat-surface-alt);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-launcher);
    padding: 1px var(--tplane-chat-space-2);
  }
  .chat-citations__favstack { display: flex; margin-left: 2px; }
  .chat-citations__fav {
    width: 16px; height: 16px;
    border-radius: var(--tplane-chat-radius-sm);
    margin-left: -5px;
    border: 1.5px solid var(--tplane-chat-surface);
    object-fit: cover;
  }
  .chat-citations__fav:first-child { margin-left: 0; }
  .chat-citations__fav--mono {
    display: flex; align-items: center; justify-content: center;
    color: var(--a2ui-on-primary); font-size: 9px; font-weight: 700;
  }
  .chat-citations__source-icon {
    width: 16px; height: 16px;
    border-radius: var(--tplane-chat-radius-sm);
    margin-left: -5px;
    border-width: 1.5px;
  }
  .chat-citations__source-icon:first-child { margin-left: 0; }
  .chat-citations__source-icon svg {
    width: 10px; height: 10px;
  }
  .chat-citations__chevron {
    margin-left: auto;
    color: var(--tplane-chat-text-muted);
    transition: transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-citations__chevron.is-open { transform: rotate(180deg); }
  .chat-citations__list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 8px;
  }
  .chat-citations__item { margin: 0; }

  .chat-citations-card {
    display: flex; gap: var(--tplane-chat-space-2);
    padding: var(--tplane-chat-space-3);
    background: var(--tplane-chat-surface);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    text-decoration: none; color: inherit;
    cursor: pointer;
    transition: border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-citations-card:hover,
  .chat-citations-card:focus-visible {
    border-color: var(--tplane-chat-citation-accent-border);
  }
  .chat-citations-card:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-citations-card__index {
    flex: 0 0 auto;
    width: 18px; height: 18px;
    border-radius: var(--tplane-chat-radius-sm);
    background: var(--tplane-chat-surface-alt);
    border: 1px solid var(--tplane-chat-separator);
    color: var(--tplane-chat-text-muted);
    font-size: var(--tplane-chat-font-size-xs); font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    margin-top: 1px;
  }
  .chat-citations-card__body { min-width: 0; flex: 1; }
  .chat-citations-card__top {
    display: flex; align-items: center; gap: var(--tplane-chat-space-2); margin-bottom: var(--tplane-chat-space-1);
  }
  .chat-citations-card__fav {
    width: 14px; height: 14px; border-radius: var(--tplane-chat-radius-sm); flex: 0 0 auto; object-fit: cover;
  }
  .chat-citations-card__fav--mono {
    display: flex; align-items: center; justify-content: center;
    color: var(--a2ui-on-primary); font-size: 8px; font-weight: 700;
  }
  .chat-citations-card__domain { font-size: 11.5px; color: var(--tplane-chat-text-muted); }
  .chat-citations-card__type { margin-left: auto; font-size: 10.5px; }
  .chat-citations-card__title {
    font-size: 13.5px; font-weight: 600; line-height: 1.35;
    margin: 0 0 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chat-citations-card:hover .chat-citations-card__title { color: var(--tplane-chat-citation-accent); }
  .chat-citations-card__snippet {
    font-size: 12px; color: var(--tplane-chat-text-muted); line-height: 1.45;
    margin: 0;
    display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  }
`;
