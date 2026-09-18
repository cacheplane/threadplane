export const CHAT_ERROR_STYLES = `
  :host { display: block; }
  .chat-error {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.5rem;
    background: var(--tplane-chat-error-bg);
    border: 1px solid var(--tplane-chat-error-border);
    color: var(--tplane-chat-error-text);
    border-radius: var(--tplane-chat-radius-card);
    padding: 8px 12px;
    font-size: var(--tplane-chat-font-size-sm);
    margin: 0 var(--tplane-chat-space-6) var(--tplane-chat-space-2);
  }
  .chat-error__icon { flex-shrink: 0; width: 16px; height: 16px; margin-top: 2px; }
  .chat-error__msg { flex: 1; min-width: 0; word-break: break-word; }
  .chat-error__detail {
    flex-basis: 100%;
    margin-left: calc(16px + 0.5rem);
    font-size: var(--tplane-chat-font-size-sm);
    opacity: 0.85;
  }
  .chat-error__retry, .chat-error__check {
    flex-shrink: 0;
    background: transparent;
    color: var(--tplane-chat-error-text);
    border: 1px solid var(--tplane-chat-error-border);
    border-radius: var(--tplane-chat-radius-card);
    padding: 2px 10px;
    font-size: var(--tplane-chat-font-size-sm);
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease;
    white-space: nowrap;
  }
  .chat-error__retry:hover, .chat-error__check:hover {
    background: var(--tplane-chat-error-border);
    color: var(--tplane-chat-error-text);
  }
  .chat-error__retry:focus-visible, .chat-error__check:focus-visible {
    outline: 2px solid var(--tplane-chat-error-border);
    outline-offset: 2px;
  }
`;
