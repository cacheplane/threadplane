export const CHAT_SUGGESTIONS_STYLES = `
  :host { display: block; }
  .chat-suggestions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .chat-suggestion {
    padding: 6px 10px;
    font-size: var(--tplane-chat-font-size-xs);
    border-radius: var(--tplane-chat-radius-bubble);
    border: 1px solid var(--tplane-chat-muted);
    background: transparent;
    color: var(--tplane-chat-text);
    cursor: pointer;
    transition: transform var(--tplane-chat-motion-duration-slow) var(--tplane-chat-motion-ease);
  }
  .chat-suggestion:hover { transform: scale(1.03); }
  .chat-suggestion:disabled { cursor: wait; opacity: 0.6; }
`;
