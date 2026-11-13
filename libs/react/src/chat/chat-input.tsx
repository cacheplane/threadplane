'use client';
import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

/** Configures a controlled or local message draft, submission and stop callbacks, and composer labels. */
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
  /**
   * Explains a send that did nothing: pressing Enter with a draft while `busy`
   * keeps the draft, and a status region below the input says a response is
   * still running until it ends or the draft is cleared. `true` uses the
   * default sentence and a string replaces it. Off unless set.
   */
  readonly runningHint?: boolean | string;
  /**
   * App-owned notice above the input surface, such as a paused or read-only
   * state. Announce it yourself when it should be spoken, for example with
   * `role="status"`.
   */
  readonly banner?: ReactNode;
  /**
   * App-owned content between the banner and the input surface, such as files
   * chosen for the next message. The composer never reads, sends or clears it.
   */
  readonly attachments?: ReactNode;
  /**
   * App-owned content before the draft, inside the input surface. Slot content
   * sits inside the composer form: give its buttons `type="button"` unless they
   * should send, and it stays enabled when `disabled` or `busy` is set.
   */
  readonly leading?: ReactNode;
  /** App-owned controls between the draft and the built-in Stop and Send. */
  readonly trailing?: ReactNode;
  /** App-owned content below the input surface and hint, such as a status or disclaimer. */
  readonly footer?: ReactNode;
  readonly id?: string;
  readonly className?: string;
}
const present = (node: ReactNode) => node != null && node !== false;

/** Imperative access to focus the composer's textarea. */
export interface ChatInputHandle {
  focus(): void;
}

/** Auto-sizing composer that submits nonblank drafts and clears its local draft or requests an empty controlled value unless onSubmit returns false. */
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
      runningHint = false,
      banner,
      attachments,
      leading,
      trailing,
      footer,
      id,
      className,
    },
    ref
  ) {
    const generated = useId();
    const inputId = id ?? `${generated}-input`;
    const hintId = `${generated}-hint`;
    const hasHint = present(hint);
    const sendButton = useRef<HTMLButtonElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const stopButton = useRef<HTMLButtonElement | null>(null);
    const returnFocus = useRef(false);
    const stopRef = useCallback((button: HTMLButtonElement | null) => {
      const previous = stopButton.current;
      if (!button && previous?.ownerDocument.activeElement === previous) {
        returnFocus.current = true;
      }
      stopButton.current = button;
    }, []);
    const [own, setOwn] = useState(defaultValue);
    const draft = value ?? own;
    const [blocked, setBlocked] = useState(false);
    useEffect(() => {
      if (!busy) setBlocked(false);
    }, [busy]);
    const setDraft = (next: string) => {
      if (next.trim().length === 0) setBlocked(false);
      if (value === undefined) setOwn(next);
      onValueChange?.(next);
    };
    useImperativeHandle(
      ref,
      () => ({ focus: () => textarea.current?.focus() }),
      []
    );
    useIsomorphicLayoutEffect(() => {
      if (busy || !returnFocus.current) return;
      returnFocus.current = false;
      const el = textarea.current;
      if (el && el.ownerDocument.activeElement === el.ownerDocument.body) {
        el.focus();
      }
    }, [busy]);
    const resize = useCallback(() => {
      const el = textarea.current;
      if (!el) return;
      el.style.height = 'auto';
      const viewport = el.ownerDocument.defaultView?.visualViewport;
      const height = viewport?.scale === 1 ? viewport.height : window.innerHeight;
      const cap = Math.min(height * 0.4, 320);
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
      if (el.ownerDocument.activeElement === el && el.selectionStart === el.value.length) {
        el.scrollTop = el.scrollHeight;
      }
    }, []);
    useIsomorphicLayoutEffect(resize, [draft, resize]);
    useIsomorphicLayoutEffect(() => {
      const el = textarea.current;
      if (!el) return;
      let dimensions = '';
      let frame: number | undefined;
      const scheduleResize = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        // Parent shells may apply a viewport-dependent CSS cap in a later
        // listener. Measure and reveal the caret after that cap is in place.
        frame = requestAnimationFrame(() => {
          frame = undefined;
          resize();
        });
      };
      const observer =
        typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(() => {
              const style = getComputedStyle(el);
              const next = `${el.clientWidth}:${style.fontSize}:${style.lineHeight}:${style.fontFamily}`;
              if (next === dimensions) return;
              dimensions = next;
              // Resize after observer delivery; writing the observed height
              // inside its callback causes a delivery loop in WebKit.
              scheduleResize();
            });
      observer?.observe(el);
      window.addEventListener('resize', resize);
      const viewport = window.visualViewport;
      viewport?.addEventListener('resize', scheduleResize);
      return () => {
        observer?.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener('resize', resize);
        viewport?.removeEventListener('resize', scheduleResize);
      };
    }, [resize]);
    const canSend = !busy && !disabled && draft.trim().length > 0;
    const send = () => {
      if (!canSend) {
        // The draft stays put; say why nothing was sent.
        if (busy && !disabled && draft.trim().length > 0) setBlocked(true);
        return;
      }
      const input = textarea.current;
      const form = input?.form;
      const document = input?.ownerDocument;
      // App-owned slot content may hold its own submit button; only the
      // built-in Send owns the focus this composer restores.
      const submit = sendButton.current;
      const focused = document?.activeElement;
      const ownedFocus = input != null && (focused === input || focused === submit);
      const stillOwnsFocus = () => {
        const active = document?.activeElement;
        return active === input || active === submit || (
          active === document?.body && focused === submit && submit != null &&
          (!submit.isConnected || submit.disabled)
        );
      };
      if (onSubmit(draft) === false) return;
      setDraft('');
      // Application callbacks may deliberately hand focus to another control.
      const retainedFocus = ownedFocus && stillOwnsFocus();
      requestAnimationFrame(() => {
        if (
          retainedFocus && input?.isConnected && form?.isConnected &&
          textarea.current === input && input.form === form && stillOwnsFocus()
        ) input.focus();
      });
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
        {present(banner) && (
          <div className="tp-chat-input__banner">{banner}</div>
        )}
        {present(attachments) && (
          <div className="tp-chat-input__attachments">{attachments}</div>
        )}
        <div className="tp-chat-input__pill">
          {present(leading) && (
            <div className="tp-chat-input__leading">{leading}</div>
          )}
          <textarea
            dir="auto"
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
            {present(trailing) && (
              <div className="tp-chat-input__trailing">{trailing}</div>
            )}
            {busy && onStop && (
              <button
                ref={stopRef}
                type="button"
                className="tp-chat-input__stop"
                title="Stop"
                onClick={onStop}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect
                    x="7"
                    y="7"
                    width="10"
                    height="10"
                    rx="1.5"
                    fill="currentColor"
                  />
                </svg>
                <span className="tp-chat-sr-only">Stop</span>
              </button>
            )}
            <button
              ref={sendButton}
              type="submit"
              className="tp-chat-input__send"
              title="Send"
              disabled={!canSend}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M12 19V5m-7 7 7-7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="tp-chat-sr-only">Send</span>
            </button>
          </div>
        </div>
        {hasHint && (
          <p id={hintId} className="tp-chat-input__hint">
            {hint}
          </p>
        )}
        {runningHint !== false && (
          // Always mounted, so the sentence is announced when it appears.
          <div className="tp-chat-input__running-hint" role="status">
            {blocked && busy && (
              <span>
                {runningHint === true
                  ? 'A response is still running. Stop it to send now, or send when it finishes.'
                  : runningHint}
              </span>
            )}
          </div>
        )}
        {present(footer) && (
          <div className="tp-chat-input__footer">{footer}</div>
        )}
      </form>
    );
  }
);
