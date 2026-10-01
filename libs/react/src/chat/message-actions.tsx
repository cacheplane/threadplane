'use client';

/** An explicitly authored action; IDs must be unique within the group. */
export interface MessageAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

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
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="tp-message-actions__action"
          disabled={disabled || action.disabled}
          onClick={() => {
            if (!disabled && !action.disabled) action.onSelect();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
