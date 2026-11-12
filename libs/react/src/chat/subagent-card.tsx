'use client';
import type { ReactNode } from 'react';
import {
  ToolActivity,
  type ToolActivityInfo,
  type ToolSourcePlacement,
} from './tool-activity.js';

/** Explicit presentation state supplied by an application or adapter, never inferred from literal payloads. */
export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'unknown';

/** One message a child agent produced, with the tool activity that message requested. */
export interface SubagentMessageInfo {
  readonly id: string;
  /** Literal child text. Empty or absent text renders nothing. */
  readonly text?: string;
  /** Backend-supplied reasoning display text. */
  readonly reasoning?: string;
  readonly activities?: readonly ToolActivityInfo[];
}

/** Readonly evidence about one child agent. Does not own execution, sessions or persistence. */
export interface SubagentInfo {
  readonly id: string;
  /** The root tool call that started this child; `MessageList` renders the card in that call's place. */
  readonly toolCallId?: string;
  readonly name?: string;
  readonly description?: string;
  readonly status: SubagentStatus;
  readonly messages: readonly SubagentMessageInfo[];
  /** Safe user-facing copy for a failed child; diagnostic text stays with the app. */
  readonly errorSummary?: string;
}

const labels: Record<SubagentStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
  unknown: 'Status unavailable',
};

/** Borrowed child evidence, an optional card class and an optional app-owned text renderer. */
export interface SubagentCardProps {
  readonly subagent: SubagentInfo;
  readonly className?: string;
  /** Replace literal child text, for example with app-owned Markdown. Keep stable. */
  readonly renderText?: (message: SubagentMessageInfo) => ReactNode;
  /**
   * Where sources declared by the child's calls appear. Defaults to links under each call. `panel`
   * shows none here, for a message whose Sources panel lists them; `MessageList` and `Chat` do this.
   */
  readonly sources?: ToolSourcePlacement;
}

/** A child agent's name, status and message count, with its messages and tool activity behind one disclosure. */
export function SubagentCard({
  subagent,
  className,
  renderText,
  sources,
}: SubagentCardProps) {
  const count = subagent.messages.length;
  return (
    <section
      className={['tp-subagent-card', className].filter(Boolean).join(' ')}
      data-status={subagent.status}
      data-subagent-id={subagent.id}
    >
      <details className="tp-subagent-card__details">
        <summary>
          <span className="tp-subagent-card__name">
            {subagent.name ?? 'Subagent'}
          </span>
          <span className="tp-subagent-card__status">
            {labels[subagent.status]}
          </span>
          <span className="tp-subagent-card__count">
            {count} {count === 1 ? 'message' : 'messages'}
          </span>
        </summary>
        <div className="tp-subagent-card__body">
          {subagent.description && (
            <p className="tp-subagent-card__description">
              {subagent.description}
            </p>
          )}
          {subagent.messages.map((message) => (
            <div
              key={message.id}
              className="tp-subagent-card__message"
              data-message-id={message.id}
            >
              {message.reasoning && (
                <p className="tp-subagent-card__reasoning">
                  {message.reasoning}
                </p>
              )}
              {renderText
                ? renderText(message)
                : message.text && (
                    <p className="tp-subagent-card__text">{message.text}</p>
                  )}
              {message.activities?.map((activity) => (
                <ToolActivity
                  key={activity.id}
                  activity={activity}
                  sources={sources}
                />
              ))}
            </div>
          ))}
        </div>
      </details>
      {subagent.status === 'error' && (
        <p className="tp-subagent-card__error" role="alert">
          {subagent.errorSummary ??
            'This subagent could not finish. Open it to see what it did.'}
        </p>
      )}
    </section>
  );
}
