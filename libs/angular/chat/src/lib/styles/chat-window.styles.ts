// libs/angular/chat/src/lib/styles/chat-window.styles.ts
export const CHAT_WINDOW_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--tplane-chat-bg);
    color: var(--tplane-chat-text);
  }
  .chat-window__header {
    height: 56px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--tplane-chat-space-6);
    border-bottom: 1px solid var(--tplane-chat-separator);
    font-weight: 500;
    color: var(--tplane-chat-primary);
  }
  .chat-window__header:empty { display: none; }
  /* When the consumer doesn't project a header, balance the chat content
   * with breathing room at the top equivalent to the input gap at the bottom. */
  .chat-window__header:empty + .chat-window__body {
    padding-top: var(--tplane-chat-input-gap);
  }
  .chat-window__body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .chat-window__footer {
    position: relative;
    flex-shrink: 0;
    margin-top: var(--tplane-chat-input-gap);
  }
  .chat-window__footer:empty { display: none; }
  .chat-window__scroll-fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 32px;
    background: linear-gradient(180deg, transparent 0%, var(--tplane-chat-bg) 100%);
    pointer-events: none;
  }
`;
