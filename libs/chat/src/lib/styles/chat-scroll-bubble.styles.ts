// libs/chat/src/lib/styles/chat-scroll-bubble.styles.ts
export const CHAT_SCROLL_BUBBLE_STYLES = `
  :host {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 8px;
    z-index: 2;
    pointer-events: none;
  }
  .chat-scroll-bubble {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0 12px;
    border-radius: var(--tplane-chat-radius-launcher);
    background: var(--tplane-chat-surface);
    border: 1px solid var(--tplane-chat-separator);
    color: var(--tplane-chat-text);
    cursor: pointer;
    transition: transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-scroll-bubble:hover { transform: scale(1.05); }
  .chat-scroll-bubble__dots { display: inline-flex; gap: 4px; align-items: center; }
  .chat-scroll-bubble__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tplane-chat-text-muted);
    animation: tplane-chat-typing-dot 1.4s ease-in-out infinite both;
  }
  .chat-scroll-bubble__dot:nth-child(2) { animation-delay: 0.2s; }
  .chat-scroll-bubble__dot:nth-child(3) { animation-delay: 0.4s; }
  .chat-scroll-bubble__arrow {
    width: 16px;
    height: 16px;
    display: block;
  }
`;
