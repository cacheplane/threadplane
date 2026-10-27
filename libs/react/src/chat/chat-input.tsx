'use client';
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

export interface ChatInputProps {
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  /** Receives the draft as typed (trim only gates emptiness). Return false to keep it. */
  readonly onSubmit: (text: string) => boolean | void;
  readonly onStop?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** Enter sends and Shift+Enter adds a line. Ctrl/⌘+Enter always sends. */
  readonly submitOnEnter?: boolean;
  readonly label?: string;
  readonly placeholder?: string;
  readonly hint?: ReactNode;
  readonly id?: string;
  readonly className?: string;
}
export interface ChatInputHandle {
  focus(): void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      value,
      defaultValue = '',
      onValueChange,
      onSubmit,
      onStop,
      busy = false,
      disabled = false,
      submitOnEnter = true,
      label = 'Message',
      placeholder = 'Write a message…',
      hint,
      id,
      className,
    },
    ref
  ) {
    const generated = useId();
    const inputId = id ?? `${generated}-input`;
    const hintId = `${generated}-hint`;
    const hasHint = hint != null && hint !== false;
    const textarea = useRef<HTMLTextAreaElement>(null);
    const [own, setOwn] = useState(defaultValue);
    const draft = value ?? own;
    const setDraft = (next: string) => {
      if (value === undefined) setOwn(next);
      onValueChange?.(next);
    };
    useImperativeHandle(
      ref,
      () => ({ focus: () => textarea.current?.focus() }),
      []
    );
    useIsomorphicLayoutEffect(() => {
      const el = textarea.current;
      if (!el) return;
      el.style.height = 'auto';
      const cap = Math.min(window.innerHeight * 0.4, 320);
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    }, [draft]);
    const canSend = !busy && !disabled && draft.trim().length > 0;
    const send = () => {
      if (!canSend) return;
      if (onSubmit(draft) === false) return;
      setDraft('');
      requestAnimationFrame(() => textarea.current?.focus());
    };
    return (
      <form
        className={['tp-chat-input', className].filter(Boolean).join(' ')}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="tp-chat-input__label" htmlFor={inputId}>
          {label}
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          className="tp-chat-input__textarea"
          value={draft}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-describedby={hasHint ? hintId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const native = event.nativeEvent;
            if (native.isComposing || native.keyCode === 229) return;
            const modifier = event.ctrlKey || event.metaKey;
            if (!modifier && (!submitOnEnter || event.shiftKey)) return;
            event.preventDefault();
            send();
          }}
        />
        <div className="tp-chat-input__actions">
          {hasHint && (
            <p id={hintId} className="tp-chat-input__hint">
              {hint}
            </p>
          )}
          {busy && onStop && (
            <button
              type="button"
              className="tp-chat-input__stop"
              onClick={onStop}
            >
              Stop
            </button>
          )}
          <button
            type="submit"
            className="tp-chat-input__send"
            disabled={!canSend}
          >
            Send
          </button>
        </div>
      </form>
    );
  }
);
