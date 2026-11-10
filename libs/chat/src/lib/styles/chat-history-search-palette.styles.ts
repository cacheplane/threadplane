// libs/chat/src/lib/styles/chat-history-search-palette.styles.ts
export const CHAT_HISTORY_SEARCH_PALETTE_STYLES = `
  :host { display: contents; }
  .chat-history-search-palette__scrim {
    position: fixed;
    inset: 0;
    background: var(--tplane-chat-scrim);
    z-index: var(--tplane-chat-z-modal-scrim, 1100);
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .chat-history-search-palette {
    position: fixed;
    top: 15vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 90vw);
    max-height: 70vh;
    background: var(--tplane-chat-bg);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
    z-index: var(--tplane-chat-z-modal, 1101);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .chat-history-search-palette__input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--tplane-chat-separator);
  }
  .chat-history-search-palette__icon {
    width: 18px;
    height: 18px;
    color: var(--tplane-chat-text-muted);
    flex-shrink: 0;
  }
  .chat-history-search-palette__input {
    flex: 1 1 auto;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--tplane-chat-text);
    font: inherit;
    font-size: 1rem;
  }
  .chat-history-search-palette__input:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
    border-radius: var(--tplane-chat-radius-sm);
  }
  .chat-history-search-palette__input::placeholder {
    color: var(--tplane-chat-text-muted);
  }
  .chat-history-search-palette__close {
    background: transparent;
    border: 0;
    padding: 4px;
    color: var(--tplane-chat-text-muted);
    cursor: pointer;
    border-radius: var(--tplane-chat-radius-sm);
  }
  .chat-history-search-palette__close:hover { color: var(--tplane-chat-text); }
  .chat-history-search-palette__list {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 4px;
    margin: 0;
    list-style: none;
  }
  .chat-history-search-palette__row {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: var(--tplane-chat-radius-card);
    cursor: pointer;
  }
  .chat-history-search-palette__row[aria-selected="true"] {
    background: var(--tplane-chat-surface-alt);
  }
  .chat-history-search-palette__row-title {
    color: var(--tplane-chat-text);
    font-size: var(--tplane-chat-font-size);
  }
  .chat-history-search-palette__row-subtitle {
    color: var(--tplane-chat-text-muted);
    font-size: var(--tplane-chat-font-size-sm);
    margin-top: 2px;
  }
  .chat-history-search-palette__empty,
  .chat-history-search-palette__hint {
    padding: 24px 16px;
    color: var(--tplane-chat-text-muted);
    text-align: center;
    font-size: var(--tplane-chat-font-size-sm);
  }
  .chat-history-search-palette__skeleton {
    padding: 8px 4px;
  }
  .chat-history-search-palette__skeleton-row {
    height: 36px;
    margin: 4px 0;
    background: var(--tplane-chat-surface-alt);
    border-radius: var(--tplane-chat-radius-card);
    animation: tplane-chat-pulse 1.4s ease-in-out infinite;
  }
`;
