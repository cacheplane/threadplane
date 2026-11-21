export const CHAT_TYPING_INDICATOR_STYLES = `
  /* Sit in the same centered column as chat-message-list so the dots
     don't flash at the scroll container's left edge before the assistant
     message renders. */
  :host {
    display: block;
    padding: 0 var(--tplane-chat-space-6) var(--tplane-chat-space-3);
    max-width: var(--tplane-chat-max-width);
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .chat-typing__dots { display: inline-flex; gap: 4px; align-items: center; }
  .chat-typing__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tplane-chat-text-muted);
    animation: tplane-chat-typing-dot 1.4s ease-in-out infinite both;
  }
  .chat-typing__dot:nth-child(2) { animation-delay: 0.2s; }
  .chat-typing__dot:nth-child(3) { animation-delay: 0.4s; }
`;
