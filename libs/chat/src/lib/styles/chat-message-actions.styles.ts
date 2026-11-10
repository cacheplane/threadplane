// libs/chat/src/lib/styles/chat-message-actions.styles.ts
//
// Action-button row underneath assistant messages. Hidden by default, fades
// in on hover/focus of the parent chat-message, always visible on narrow or
// hover-less (touch) devices.
export const CHAT_MESSAGE_ACTIONS_STYLES = `
  :host {
    display: flex;
    gap: 0.5rem;
    padding: 16px 0 12px 0;
    opacity: 0;
    transition: opacity 200ms ease;
    pointer-events: none;
  }
  :host-context(chat-message[data-role="assistant"]:hover),
  :host-context(chat-message[data-role="assistant"]:focus-within),
  :host-context(chat-message[data-role="assistant"][data-current="true"]) {
    opacity: 1;
    pointer-events: auto;
  }
  :host-context(chat-message[data-streaming="true"]) {
    /* Hide while the message is actively streaming. */
    opacity: 0 !important;
    pointer-events: none !important;
  }
  /* Touch-first devices of any width have no hover to reveal the row. */
  @media (max-width: 768px), (hover: none) {
    :host-context(chat-message[data-role="assistant"]) {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .chat-message-actions__btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    padding: 0;
    margin: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--tplane-chat-text-muted);
    cursor: pointer;
    transition: color 150ms ease, transform 150ms ease, background 150ms ease;
  }
  .chat-message-actions__btn:hover {
    color: var(--tplane-chat-text);
    transform: scale(1.05);
    background: var(--tplane-chat-surface-alt);
  }
  .chat-message-actions__btn:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-message-actions__btn.is-active {
    color: var(--tplane-chat-text);
    background: var(--tplane-chat-surface-alt);
  }
  .chat-message-actions__btn svg {
    width: 16px;
    height: 16px;
    pointer-events: none;
  }
  .chat-message-actions__check {
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    color: var(--tplane-chat-success);
  }
`;
