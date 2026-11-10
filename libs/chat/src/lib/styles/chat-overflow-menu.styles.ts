// libs/chat/src/lib/styles/chat-overflow-menu.styles.ts
export const CHAT_OVERFLOW_MENU_STYLES = `
  :host { display: contents; }
  .chat-overflow-menu__scrim {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 59;
    border: 0;
    padding: 0;
    cursor: default;
  }
  .chat-overflow-menu {
    position: fixed;
    z-index: 60;
    min-width: 160px;
    padding: 4px;
    margin: 0;
    list-style: none;
    background: var(--tplane-chat-bg);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    box-shadow: var(--tplane-chat-elevation-float);
  }
  .chat-overflow-menu__item {
    display: block;
    padding: 8px 12px;
    border-radius: var(--tplane-chat-radius-sm);
    color: var(--tplane-chat-text);
    font-size: var(--tplane-chat-font-size-sm);
    cursor: pointer;
    user-select: none;
  }
  .chat-overflow-menu__item:hover {
    background: var(--tplane-chat-surface-alt);
  }
  .chat-overflow-menu__item:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: -2px;
  }
  .chat-overflow-menu__item--destructive {
    color: var(--tplane-chat-error-text);
  }
  .chat-overflow-menu__item--disabled {
    color: var(--tplane-chat-text-muted);
    cursor: not-allowed;
    pointer-events: none;
  }
`;
