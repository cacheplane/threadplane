// libs/chat/src/lib/styles/chat-message.styles.ts
export const CHAT_MESSAGE_STYLES = `
  :host { display: block; }
  .chat-message__speaker {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  :host([data-role="user"]) {
    display: block;
    margin-top: 0.5rem;
  }
  :host([data-role="user"][data-prev-role="assistant"]) { margin-top: 1.5rem; }
  :host([data-role="user"]) .chat-message__bubble {
    /* Right-align the user bubble. */
    margin-left: auto;
    max-width: 80%;
  }
  /*
   * Assistant bubbles get the 80% cap on the bubble itself.
   */
  :host([data-role="assistant"]) .chat-message__bubble {
    max-width: 80%;
  }
  :host([data-role="assistant"]) {
    display: block;
    position: relative;
    margin-top: 1.5rem;
    color: var(--tplane-chat-text);
    line-height: 1.55;
    font-size: var(--tplane-chat-font-size);
    max-width: 100%;
  }
  :host([data-role="assistant"]):first-child { margin-top: 0; }

  .chat-message__bubble {
    width: fit-content;
    padding: 8px 12px;
    border-radius: var(--tplane-chat-radius-bubble);
    background: var(--tplane-chat-primary);
    color: var(--tplane-chat-on-primary);
    white-space: pre-wrap;
    line-height: var(--tplane-chat-line-height-tight);
    font-size: var(--tplane-chat-font-size);
    overflow-wrap: break-word;
  }

  .chat-message__assistant-body {
    padding: 0 12px 0 4px;
    overflow-wrap: break-word;
  }

  .chat-message__caret {
    display: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    vertical-align: middle;
    margin-left: 4px;
    margin-bottom: 2px;
    background: radial-gradient(circle at 30% 30%,
      var(--tplane-chat-text) 0%,
      var(--tplane-chat-text-muted) 70%,
      transparent 100%);
    box-shadow: 0 0 6px var(--tplane-chat-text-muted);
    animation: tplane-chat-caret-fade-in 200ms ease-out 300ms forwards,
               tplane-chat-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) 500ms infinite;
    opacity: 0;
  }
  :host([data-role="assistant"][data-current="true"][data-streaming="true"]) .chat-message__caret {
    display: inline-block;
  }

  .chat-message__plain { /* system / tool fallback */ }

  .chat-message__controls {
    display: none;
    gap: 1rem;
    opacity: 0;
    transition: opacity 200ms ease;
    pointer-events: none;
  }
  :host([data-role="assistant"]) .chat-message__controls {
    display: flex;
  }
  :host([data-role="assistant"]:hover) .chat-message__controls,
  :host([data-role="assistant"]:focus-within) .chat-message__controls,
  :host([data-current="true"]) .chat-message__controls {
    opacity: 1;
    pointer-events: auto;
  }
  /* Must match chat-message-actions' reveal query: if only the inner row is
     revealed, its buttons are tappable inside this still-transparent wrapper. */
  @media (max-width: 768px), (hover: none) {
    :host([data-role="assistant"]) .chat-message__controls { opacity: 1; pointer-events: auto; }
  }
  .chat-message__control-btn {
    width: 20px;
    height: 20px;
    border: 0;
    background: transparent;
    color: var(--tplane-chat-primary);
    cursor: pointer;
    padding: 0;
    transition: transform 200ms ease;
  }
  .chat-message__control-btn:hover { transform: scale(1.05); }
  .chat-message__control-btn:focus-visible {
    outline: 2px solid var(--tplane-chat-primary);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .chat-message__control-btn svg { width: 16px; height: 16px; pointer-events: none; }
`;
