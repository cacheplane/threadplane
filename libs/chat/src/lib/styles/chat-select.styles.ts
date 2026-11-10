// libs/chat/src/lib/styles/chat-select.styles.ts
export const CHAT_SELECT_STYLES = `
  :host {
    display: inline-block;
    position: relative;
  }
  .chat-select__trigger {
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--tplane-chat-radius-launcher);
    background: transparent;
    color: var(--tplane-chat-text-muted);
    font: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    transition: background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-select__trigger:hover:not(:disabled) {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  .chat-select__trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .chat-select__chevron {
    width: 12px;
    height: 12px;
    transition: transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
    flex: none;
  }
  .chat-select__trigger.is-open .chat-select__chevron {
    transform: rotate(180deg);
  }
  /* The menu is rendered inside the chat connected-overlay pane (a body-level
     portal), so it no longer positions itself — the overlay primitive places
     the pane. It keeps only its own box styling here. Min/max width can be
     overridden per consumer via the overlay panelClass (see chat-select
     panelClass input). */
  .chat-select__menu {
    min-width: 180px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--tplane-chat-surface);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    box-shadow: var(--tplane-chat-elevation-float);
    padding: 4px;
    box-sizing: border-box;
  }
  .chat-select__option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    border-radius: var(--tplane-chat-radius-card);
    color: var(--tplane-chat-text);
    font: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    cursor: pointer;
  }
  .chat-select__option-desc {
    font-size: var(--tplane-chat-font-size-xs);
    color: var(--tplane-chat-text-muted);
    line-height: 1.3;
    white-space: normal;
  }
  .chat-select__option:hover:not(:disabled) {
    background: var(--tplane-chat-surface-alt);
  }
  .chat-select__option:focus-visible {
    background: var(--tplane-chat-surface-alt);
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: -2px;
  }
  .chat-select__option.is-active {
    background: var(--tplane-chat-surface-alt);
    font-weight: 500;
  }
  .chat-select__option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;
