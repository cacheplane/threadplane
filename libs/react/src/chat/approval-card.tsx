'use client';
import { useId, type ReactNode } from 'react';

/** One explicitly authored presentation action; IDs must be unique per card. */
export interface ApprovalCardAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

/** Borrowed decision presentation; matching, commands and pending state belong to the app. */
export interface ApprovalCardProps {
  readonly children: ReactNode;
  readonly actions: readonly ApprovalCardAction[];
  readonly title?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Inline approval presentation with app-authored body and explicit actions. */
export function ApprovalCard({
  children,
  actions,
  title = 'Approval request',
  disabled = false,
  className,
}: ApprovalCardProps) {
  const heading = useId();
  return (
    <section
      className={['tp-approval-card', className].filter(Boolean).join(' ')}
      aria-labelledby={heading}
    >
      <h2 id={heading} className="tp-approval-card__title">
        {title}
      </h2>
      <div className="tp-approval-card__body">{children}</div>
      <div className="tp-approval-card__actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="tp-approval-card__action"
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
