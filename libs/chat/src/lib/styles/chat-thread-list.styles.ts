export const CHAT_THREAD_LIST_STYLES = `
  :host { display: block; padding: var(--tplane-chat-space-2); }
  .chat-thread-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .chat-thread-list__item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 36px;
    padding: 8px 12px;
    border-radius: var(--tplane-chat-radius-button);
    cursor: pointer;
    color: var(--tplane-chat-text);
    font-size: var(--tplane-chat-font-size-sm);
    background: transparent;
    border: 0;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    transition: background-color 150ms ease;
  }
  .chat-thread-list__item:hover { background: color-mix(in srgb, var(--tplane-chat-text) 5%, transparent); }
  .chat-thread-list__item[data-active="true"] {
    background: var(--tplane-chat-surface-alt);
    font-weight: 500;
  }
  .chat-thread-list__item-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .chat-thread-list__item-time {
    font-size: var(--tplane-chat-font-size-xs);
    color: var(--tplane-chat-text-muted);
    display: block;
  }
  .chat-thread-list__new {
    display: block;
    width: 100%;
    height: 36px;
    margin-bottom: var(--tplane-chat-space-2);
    border: 1px dashed var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-button);
    background: transparent;
    color: var(--tplane-chat-primary);
    cursor: pointer;
    font-size: var(--tplane-chat-font-size-sm);
    box-sizing: border-box;
    transition: background 150ms ease;
  }
  .chat-thread-list__new:hover { background: var(--tplane-chat-surface-alt); }
  .chat-thread-list__item-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .chat-thread-list__item-wrap .chat-thread-list__item {
    flex: 1 1 auto;
    min-width: 0;
  }
  .chat-thread-list__kebab {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    color: var(--tplane-chat-text-muted);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 100ms ease;
    padding: 0;
    line-height: 1;
    font-size: 18px;
  }
  .chat-thread-list__item-wrap:hover .chat-thread-list__kebab,
  .chat-thread-list__item-wrap:focus-within .chat-thread-list__kebab {
    opacity: 1;
  }
  .chat-thread-list__kebab:hover {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  .chat-thread-list__kebab:focus-visible {
    opacity: 1;
    outline: 2px solid var(--tplane-chat-primary);
    outline-offset: 2px;
  }
  .chat-thread-list__initial {
    display: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    align-items: center;
    justify-content: center;
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
    font-weight: 500;
    font-size: 13px;
    flex-shrink: 0;
  }
  .chat-thread-list__item-pin {
    width: 11px;
    height: 11px;
    margin-right: 4px;
    color: var(--tplane-chat-text-muted);
    vertical-align: -1px;
    display: inline-block;
  }
  .chat-thread-list__edit {
    flex: 1 1 auto;
    border: 1px solid var(--tplane-chat-primary);
    border-radius: var(--tplane-chat-radius-button);
    background: var(--tplane-chat-bg);
    color: var(--tplane-chat-text);
    font: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    padding: 6px 10px;
    min-height: 36px;
    outline: none;
    box-sizing: border-box;
  }
  .chat-thread-list__pin-slot {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    margin-right: 4px;
    flex-shrink: 0;
    vertical-align: -1px;
  }
  .chat-thread-list__pin-slot .chat-thread-list__item-pin {
    position: absolute;
    inset: 0;
    width: 13px;
    height: 13px;
    opacity: 1;
    transition: opacity 100ms ease;
  }
  .chat-thread-list__pin-slot .chat-thread-list__grip {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--tplane-chat-text-muted);
    font-size: 11px;
    line-height: 1;
    letter-spacing: -1px;
    opacity: 0;
    transition: opacity 100ms ease;
    user-select: none;
    pointer-events: none;
  }
  .chat-thread-list__item-wrap:hover .chat-thread-list__pin-slot .chat-thread-list__item-pin,
  .chat-thread-list__item-wrap:focus-within .chat-thread-list__pin-slot .chat-thread-list__item-pin {
    opacity: 0;
  }
  .chat-thread-list__item-wrap:hover .chat-thread-list__pin-slot .chat-thread-list__grip,
  .chat-thread-list__item-wrap:focus-within .chat-thread-list__pin-slot .chat-thread-list__grip {
    opacity: 1;
  }
  .chat-thread-list__item-wrap[draggable="true"] { cursor: grab; }
  .chat-thread-list__item-wrap[draggable="true"]:active { cursor: grabbing; }

  .chat-thread-list__item-wrap[data-dragging="true"] {
    opacity: 0.4;
  }

  .chat-thread-list__item-wrap[data-drop-position="before"]::before,
  .chat-thread-list__item-wrap[data-drop-position="after"]::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--tplane-chat-primary);
    border-radius: 1px;
    pointer-events: none;
  }
  .chat-thread-list__item-wrap[data-drop-position="before"]::before { top: -1px; }
  .chat-thread-list__item-wrap[data-drop-position="after"]::after { bottom: -1px; }
`;
