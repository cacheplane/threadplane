'use client';

import type { ReactNode } from 'react';

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
