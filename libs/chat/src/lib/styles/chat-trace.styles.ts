// libs/chat/src/lib/styles/chat-trace.styles.ts
export const CHAT_TRACE_STYLES = `
  :host { display: block; font-size: var(--tplane-chat-font-size-sm); }
  .chat-trace__header {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    user-select: none;
    color: var(--tplane-chat-text-muted);
    background: transparent;
    border: 0;
    padding: 0;
    width: 100%;
    min-height: 24px;
    text-align: left;
    font: inherit;
  }
  .chat-trace__header:focus-visible {
    outline: 2px solid var(--tplane-chat-primary);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .chat-trace__chevron {
    width: 12px;
    height: 12px;
    transition: transform 200ms ease;
    flex-shrink: 0;
  }
  :host([data-expanded="true"]) .chat-trace__chevron { transform: rotate(90deg); }
  .chat-trace__label { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; }
  :host([data-state="running"]) .chat-trace__label { animation: tplane-chat-pulse 1.5s ease-in-out infinite; }
  :host([data-state="error"]) .chat-trace__label { color: var(--tplane-chat-error-text); }
  .chat-trace__content {
    padding-left: 1rem;
    padding-top: 0.375rem;
    margin-left: 0.375rem;
    border-left: 1px solid var(--tplane-chat-separator);
    max-height: 250px;
    overflow: auto;
  }
`;
