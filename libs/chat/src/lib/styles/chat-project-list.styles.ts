// libs/chat/src/lib/styles/chat-project-list.styles.ts
export const CHAT_PROJECT_LIST_STYLES = `
  :host { display: block; padding: var(--tplane-chat-space-2); }
  .chat-project-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .chat-project-list__item-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .chat-project-list__item {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 32px;
    padding: 6px 12px;
    border-radius: var(--tplane-chat-radius-button);
    cursor: pointer;
    color: var(--tplane-chat-text);
    font-size: var(--tplane-chat-font-size-sm);
    background: transparent;
    border: 0;
    text-align: left;
    box-sizing: border-box;
    transition: background-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-project-list__item:hover { background: color-mix(in srgb, var(--tplane-chat-text) 5%, transparent); }
  .chat-project-list__item[data-active="true"] {
    background: var(--tplane-chat-surface-alt);
    font-weight: 500;
  }
  .chat-project-list__kebab {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    color: var(--tplane-chat-text-muted);
    border-radius: var(--tplane-chat-radius-sm);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
    padding: 0;
    line-height: 1;
    font-size: 18px;
  }
  .chat-project-list__item-wrap:hover .chat-project-list__kebab,
  .chat-project-list__item-wrap:focus-within .chat-project-list__kebab {
    opacity: 1;
  }
  .chat-project-list__kebab:hover {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  .chat-project-list__kebab:focus-visible {
    opacity: 1;
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-project-list__edit {
    flex: 1 1 auto;
    border: 1px solid var(--tplane-chat-primary);
    border-radius: var(--tplane-chat-radius-button);
    background: var(--tplane-chat-bg);
    color: var(--tplane-chat-text);
    font: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    padding: 6px 10px;
    min-height: 32px;
    outline: none;
    box-sizing: border-box;
  }
  .chat-project-list__new {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
    border: 0;
    padding: 10px 16px;
    border-radius: var(--tplane-chat-radius-button);
    font-family: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    font-weight: 400;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    width: 100%;
  }
  .chat-project-list__new:hover {
    background: color-mix(in srgb, var(--tplane-chat-text) 8%, var(--tplane-chat-surface-alt));
    color: var(--tplane-chat-text);
  }
`;
