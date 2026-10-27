// libs/chat/src/lib/styles/chat-reasoning.styles.ts
//
// Style block for the chat-reasoning primitive. Pill-shaped header with
// a chevron + label; expanded body sits below the header with a thin
// left border (matches the blockquote pattern in chat-markdown.styles).
// Muted text colors throughout so reasoning content recedes visually
// next to the response.
export const CHAT_REASONING_STYLES = `
  :host { display: block; margin: 0 0 0.5rem; }
  :host([data-has-content="false"]) { display: none; }

  .chat-reasoning__header {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 4px 10px;
    background: var(--tplane-chat-surface-alt);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: 9999px;
    color: var(--tplane-chat-text-muted);
    font-size: var(--tplane-chat-font-size-xs);
    font-family: inherit;
    cursor: pointer;
    line-height: 1.2;
    min-height: 24px;
    box-sizing: border-box;
  }
  .chat-reasoning__header:hover { color: var(--tplane-chat-text); }
  .chat-reasoning__header:focus-visible {
    outline: 2px solid var(--tplane-chat-primary);
    outline-offset: 2px;
  }

  .chat-reasoning__chevron {
    width: 10px;
    height: 10px;
    transition: transform 120ms ease;
  }
  :host([data-expanded="true"]) .chat-reasoning__chevron { transform: rotate(90deg); }

  .chat-reasoning__pulse {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tplane-chat-text-muted);
    animation: chat-reasoning-pulse 1.2s ease-in-out infinite;
  }
  @keyframes chat-reasoning-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .chat-reasoning__body {
    margin-top: 0.5rem;
    padding-left: 12px;
    border-left: 2px solid var(--tplane-chat-separator);
    color: var(--tplane-chat-text-muted);
  }
  .chat-reasoning__body chat-streaming-md { font-size: 0.95em; }
`;
