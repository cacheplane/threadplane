// libs/chat/src/lib/styles/chat-input.styles.ts
export const CHAT_INPUT_STYLES = `
:host {
  display: block;
  width: 100%;
  padding: 0 var(--tplane-chat-edge-pad);
  box-sizing: border-box;
}

.chat-input__container {
  width: 100%;
  max-width: var(--tplane-chat-max-width);
  margin: 0 auto;
}

.chat-input__pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--tplane-chat-surface);
  border: 1px solid var(--tplane-chat-separator);
  border-radius: var(--tplane-chat-radius-launcher);
  padding: 8px 8px 8px 16px;
  min-height: 56px;
  box-sizing: border-box;
  transition: border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
}
/* The textarea draws no outline of its own; the pill carries the focus ring. */
.chat-input__pill:focus-within {
  outline: 2px solid var(--tplane-chat-focus-ring);
  outline-offset: 2px;
}

.chat-input__hint > span {
  display: block;
  margin: 6px 16px 0;
  font-size: var(--tplane-chat-font-size-sm);
  color: var(--tplane-chat-text-muted);
}

.chat-input__textarea {
  flex: 1 1 auto;
  min-width: 0;
  /* An initially hidden popup can measure zero before its first opening. */
  min-height: 1.5em;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--tplane-chat-text);
  font: inherit;
  font-size: 1rem;
  line-height: 1.5;
  padding: 0;
  field-sizing: content;
  overflow-y: auto;
}
/* Hint copy must not grow an empty composer; actual drafts still wrap. */
.chat-input__textarea:placeholder-shown { white-space: nowrap; overflow-x: hidden; }
.chat-input__textarea::placeholder { color: var(--tplane-chat-text-muted); }
.chat-input__textarea::-webkit-scrollbar { width: 4px; }
.chat-input__textarea::-webkit-scrollbar-thumb { background: var(--tplane-chat-separator); border-radius: var(--tplane-chat-radius-sm); }

.chat-input__controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.chat-input__send,
.chat-input__send--stop {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  padding: 0;
}
.chat-input__send {
  background: var(--tplane-chat-text);
  color: var(--tplane-chat-bg);
}
.chat-input__send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--tplane-chat-text-muted);
}
.chat-input__send:not(:disabled):hover { transform: scale(1.05); }
.chat-input__send svg { width: 16px; height: 16px; }

/* Stop is the live action while a reply runs, so it takes the enabled Send
   fill rather than the muted tone that reads as unavailable. */
.chat-input__send--stop {
  background: var(--tplane-chat-text);
  color: var(--tplane-chat-bg);
}
.chat-input__send--stop:hover { transform: scale(1.05); }
/* Forced colours drop the circular fills, leaving a bare glyph; a system-colour
   border keeps both controls recognisable as buttons. */
@media (forced-colors: active) {
  .chat-input__send, .chat-input__send--stop { border: 1px solid ButtonText; }
  .chat-input__send:disabled { border-color: GrayText; }
}
.chat-input__send--stop svg { width: 14px; height: 14px; }
`;
