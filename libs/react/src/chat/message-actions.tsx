'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageRating, type MessageRatingValue } from './message-rating.js';
import { writeClipboard } from '../markdown/clipboard.js';

/** An explicitly authored action; IDs must be unique within the group. */
export interface MessageAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** App-authored noninteractive decorative content; nullish and boolean values omit the icon. */
  readonly icon?: ReactNode;
  /** Visually hides the label with opt-in styles when true and an icon is supplied. */
  readonly iconOnly?: boolean;
}

/** Supplies message action buttons, an optional group-wide disabled state, and an accessible group label. */
export interface MessageActionsProps {
  readonly actions: readonly MessageAction[];
  readonly disabled?: boolean;
  readonly label?: string;
  readonly className?: string;
}

/** Borrowed action presentation. Commands, clipboard and feedback belong to the app. */
export function MessageActions({
  actions,
  disabled = false,
  label = 'Message actions',
  className,
}: MessageActionsProps) {
  if (!actions.length) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={['tp-message-actions', className].filter(Boolean).join(' ')}
    >
      {actions.map((action) => {
        const hasIcon = action.icon != null && typeof action.icon !== 'boolean';
        const iconOnly = action.iconOnly === true && hasIcon;
        return (
          <button
            key={action.id}
            type="button"
            className={[
              'tp-message-actions__action',
              iconOnly && 'tp-message-actions__action--icon-only',
            ]
              .filter(Boolean)
              .join(' ')}
            title={iconOnly ? action.label : undefined}
            disabled={disabled || action.disabled}
            onClick={() => {
              if (!disabled && !action.disabled) action.onSelect();
            }}
          >
            {hasIcon && (
              <span className="tp-message-actions__icon" aria-hidden="true">
                {action.icon}
              </span>
            )}
            <span className="tp-message-actions__label">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What `MessageList` and `Chat` accept as `messageActions`. */
export type BuiltInMessageActions =
  | boolean
  | {
      /** Called with the copied text after the clipboard accepted it. */
      readonly onCopy?: (content: string, messageId: string) => void;
      /** Adds thumbs up and down; called with the new rating, or null when it is cleared. */
      readonly onRate?: (
        rating: MessageRatingValue | null,
        messageId: string
      ) => void;
      /**
       * Adds Regenerate; called with the message to answer again. `Chat` fills
       * this in from a session that has `regenerate`, so set it only to handle
       * the action yourself.
       */
      readonly onRegenerate?: (messageId: string) => void;
    };

/** Built-in Copy, and rating when asked, under one finished assistant message. Not part of the public entry. */
export function BuiltInActions({
  messageId,
  content,
  options,
  running = false,
}: {
  readonly messageId: string;
  readonly content: string;
  readonly options: Exclude<BuiltInMessageActions, false>;
  /** A run is active, so a new one cannot start. */
  readonly running?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<MessageRatingValue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const onCopy = options === true ? undefined : options.onCopy;
  const onRate = options === true ? undefined : options.onRate;
  const onRegenerate = options === true ? undefined : options.onRegenerate;
  const copyLabel = copied ? 'Copied' : 'Copy';
  return (
    <div role="group" aria-label="Message actions" className="tp-message-actions tp-message-actions--built-in">
      <button
        type="button"
        className="tp-message-actions__action tp-message-actions__action--icon-only"
        data-copied={copied ? '' : undefined}
        title={copyLabel}
        onClick={(event) => {
          writeClipboard(event.currentTarget.ownerDocument, content).then(
            (written) => {
              if (!written || !mounted.current) return;
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 2000);
              onCopy?.(content, messageId);
            },
            () => undefined
          );
        }}
      >
        <span className="tp-message-actions__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            {copied ? (
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            ) : (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </>
            )}
          </svg>
        </span>
        <span className="tp-message-actions__label">{copyLabel}</span>
      </button>
      {onRegenerate && (
        <button
          type="button"
          className="tp-message-actions__action tp-message-actions__action--icon-only"
          title="Regenerate"
          disabled={running}
          onClick={() => {
            if (!running) onRegenerate(messageId);
          }}
        >
          <span className="tp-message-actions__icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
          </span>
          <span className="tp-message-actions__label">Regenerate</span>
        </button>
      )}
      {onRate && (
        <MessageRating
          messageId={messageId}
          value={rating}
          onValueChange={(next, id) => {
            setRating(next);
            onRate(next, id);
          }}
        />
      )}
    </div>
  );
}
