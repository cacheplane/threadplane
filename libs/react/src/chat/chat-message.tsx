import type { ReactNode } from 'react';
import type { Role } from '@threadplane/core';

/** The existing provider message roles, shared with core. */
export type ChatMessageRole = Role;

/** Passive role presentation; content and controls remain consumer-owned. */
export interface ChatMessageProps {
  readonly role: ChatMessageRole;
  readonly current?: boolean;
  readonly streaming?: boolean;
  readonly speaker?: string;
  readonly label?: string;
  readonly children?: ReactNode;
  readonly beforeContent?: ReactNode;
  readonly afterContent?: ReactNode;
  readonly controls?: ReactNode;
  readonly className?: string;
}

/** A named message article with an independently directed body and explicit controls slot. */
export function ChatMessage({
  role,
  current = false,
  streaming = false,
  speaker = role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : '',
  label = `${role} message`,
  children,
  beforeContent,
  afterContent,
  controls,
  className,
}: ChatMessageProps) {
  return (
    <article
      className={['tp-chat-message', `tp-chat-message--${role}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      data-current={String(current)}
      data-streaming={String(streaming)}
    >
      {speaker !== '' && (
        <span className="tp-chat-message__speaker">{speaker}:</span>
      )}
      {beforeContent}
      <div className="tp-chat-message__body" dir="auto">
        {children}
        {role === 'assistant' && current && streaming && (
          <span className="tp-chat-message__caret" aria-hidden="true" />
        )}
      </div>
      {afterContent}
      {controls != null && typeof controls !== 'boolean' && (
        <div className="tp-chat-message__controls">{controls}</div>
      )}
    </article>
  );
}
