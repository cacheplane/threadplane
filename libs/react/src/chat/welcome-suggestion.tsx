'use client';
import type { ReactNode } from 'react';

/** Configures a literal suggestion button whose selection remains caller controlled. */
export interface WelcomeSuggestionProps {
  /** Literal visible button label. */
  readonly label: string;
  /** Exact value passed to onSelect without trimming or transformation. */
  readonly value: string;
  /** Receives the raw value on an enabled, unclaimed native button click. */
  readonly onSelect: (value: string) => void;
  /** Optional literal tooltip and accessible description. */
  readonly description?: string;
  /** Decorative noninteractive phrasing content, hidden from assistive technology. */
  readonly icon?: ReactNode;
  /** Prevents selection only when strictly true. */
  readonly disabled?: boolean;
  /** Additional classes on the suggestion button. */
  readonly className?: string;
}

/** Emits a suggestion value without submitting a form or changing caller state. */
export function WelcomeSuggestion({
  label,
  value,
  onSelect,
  description,
  icon,
  disabled,
  className,
}: WelcomeSuggestionProps) {
  return (
    <button
      type="button"
      className={['tp-welcome-suggestion', className].filter(Boolean).join(' ')}
      title={description}
      aria-description={description}
      disabled={disabled === true}
      onClick={(event) => {
        if (disabled === true || event.defaultPrevented) return;
        onSelect(value);
      }}
    >
      <span className="tp-welcome-suggestion__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tp-welcome-suggestion__label">{label}</span>
      <span className="tp-welcome-suggestion__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
