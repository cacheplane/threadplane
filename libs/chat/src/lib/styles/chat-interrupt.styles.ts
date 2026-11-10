export const CHAT_INTERRUPT_STYLES = `
  :host { display: block; }
  .chat-interrupt {
    background: var(--tplane-chat-warning-bg);
    color: var(--tplane-chat-warning-text);
    border-left: 3px solid var(--tplane-chat-warning-text);
    border-radius: var(--tplane-chat-radius-card);
    padding: 12px 16px;
    margin: 0 var(--tplane-chat-space-6) var(--tplane-chat-space-2);
    font-size: var(--tplane-chat-font-size-sm);
  }
  .chat-interrupt__title { font-weight: 600; margin: 0 0 4px; display: flex; align-items: center; gap: 6px; }
  .chat-interrupt__body { margin: 0 0 8px; opacity: 0.95; }
  .chat-interrupt__actions { display: flex; gap: 8px; flex-wrap: wrap; }
  @media (forced-colors: active) {
    .chat-interrupt { border: 1px solid CanvasText; }
  }
`;
