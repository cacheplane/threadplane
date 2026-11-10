// libs/chat/src/lib/styles/chat-welcome.styles.ts
export const CHAT_WELCOME_STYLES = `
  :host {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 0;
    padding: var(--tplane-chat-welcome-padding, 24px);
    box-sizing: border-box;
    animation: tplane-chat-welcome-mount var(--tplane-chat-motion-duration-slow) var(--tplane-chat-motion-ease) both;
  }
  .chat-welcome__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--tplane-chat-welcome-gap, 1.25rem);
    width: 100%;
    max-width: var(--tplane-chat-welcome-max-width, 36rem);
    text-align: center;
  }
  .chat-welcome__beacon {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%,
      var(--tplane-chat-text) 0%,
      var(--tplane-chat-text-muted) 70%,
      transparent 100%);
    animation: tplane-chat-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    margin-bottom: 8px;
  }
  .chat-welcome__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--tplane-chat-text);
    line-height: 1.3;
  }
  @media (min-width: 768px) {
    .chat-welcome__title { font-size: 1.5rem; }
  }
  .chat-welcome__input {
    width: 100%;
    margin-top: 0.5rem;
  }
  .chat-welcome__suggestions {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 4px;
  }
  /* Consumers commonly project chips wrapped in a single <div
     chatWelcomeSuggestions> element. In that case the slot's flex gap
     applies between divs (one of them) — not between the chips inside.
     Apply the same flex layout one level down so the chips actually
     get spacing. Safe no-op when chips are projected directly. */
  .chat-welcome__suggestions > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .chat-welcome__suggestions:empty { display: none; }
`;

export const CHAT_WELCOME_SUGGESTION_STYLES = `
  :host { display: inline-block; }
  .chat-welcome-suggestion {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 10px 16px;
    background: var(--tplane-chat-surface);
    border: 1px solid var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-launcher);
    color: var(--tplane-chat-text);
    font-family: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    text-align: center;
    cursor: pointer;
    transition: background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-welcome-suggestion:hover {
    background: var(--tplane-chat-surface-alt);
    border-color: var(--tplane-chat-text-muted);
  }
  .chat-welcome-suggestion:active { transform: scale(0.98); }
  .chat-welcome-suggestion:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-welcome-suggestion__label { white-space: nowrap; }
  .chat-welcome-suggestion__chevron { display: none; }
`;
