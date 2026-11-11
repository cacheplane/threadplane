'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** One explicitly authored presentation action; IDs must be unique per card. The first action is the primary one. */
export interface ApprovalCardAction {
  readonly id: string;
  /** Name the action, such as "Save note", and the alternative, such as "Don't save". */
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

/** Borrowed decision presentation; matching, commands and pending state belong to the app. */
export interface ApprovalCardProps {
  readonly children: ReactNode;
  readonly actions: readonly ApprovalCardAction[];
  /** The request in plain words, such as "Save the comparison note to your workspace?" */
  readonly title?: string;
  readonly disabled?: boolean;
  /**
   * Marks an action that cannot be undone: danger tint, the lead "This can't be undone." and a danger
   * primary button. Name the exact effect in the first action, such as "Delete 12 drafts".
   */
  readonly destructive?: boolean;
  /** Moves focus to the first action when the card appears. Defaults to true. */
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * Inline approval panel with an app-authored body and explicit actions: a warning panel led by
 * "Waiting for your approval.", or a danger panel for a destructive action. Place it at the end of
 * the transcript, for example through `Chat`'s `approval` slot.
 */
export function ApprovalCard({
  children,
  actions,
  title = 'Approval request',
  disabled = false,
  destructive = false,
  autoFocus = true,
  className,
}: ApprovalCardProps) {
  const heading = useId();
  const firstAction = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Once, when the card appears.
    if (autoFocus) firstAction.current?.focus();
  }, []);
  return (
    <section
      className={['tp-approval-card', 'tp-status-panel', className]
        .filter(Boolean)
        .join(' ')}
      data-tone={destructive ? 'danger' : 'warning'}
      aria-labelledby={heading}
    >
      <p className="tp-status-panel__lead">
        {destructive ? "This can't be undone." : 'Waiting for your approval.'}
      </p>
      <h2 id={heading} className="tp-approval-card__title">
        {title}
      </h2>
      <div className="tp-approval-card__body">{children}</div>
      <div className="tp-approval-card__actions">
        {actions.map((action, index) => (
          <button
            key={action.id}
            ref={index === 0 ? firstAction : undefined}
            type="button"
            className={[
              'tp-approval-card__action',
              index === 0 &&
                (destructive
                  ? 'tp-approval-card__action--danger'
                  : 'tp-approval-card__action--primary'),
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={disabled || action.disabled}
            onClick={() => {
              if (!disabled && !action.disabled) action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The one-line record an answered approval leaves in the transcript: "Approved: Save note". */
export interface ApprovalRecordProps {
  readonly verdict: 'approved' | 'declined';
  /** What was approved, such as "Save note". Omit for just "Approved" or "Declined". */
  readonly label?: string;
  readonly className?: string;
}

/** Muted transcript line for an answered approval. The app decides when to render it. */
export function ApprovalRecord({ verdict, label, className }: ApprovalRecordProps) {
  const verb = verdict === 'approved' ? 'Approved' : 'Declined';
  return (
    <p
      className={['tp-approval-record', className].filter(Boolean).join(' ')}
      data-verdict={verdict}
    >
      {label?.trim() ? `${verb}: ${label.trim()}` : verb}
    </p>
  );
}
