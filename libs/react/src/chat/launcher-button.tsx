'use client';

/** A round button that asks to open a chat; the owner holds the open state. */
export interface LauncherButtonProps {
  readonly onClick: () => void;
  /** The button's accessible name. Defaults to "Open chat". */
  readonly label?: string;
  /** Whether the chat it opens is showing, when the owner wants that announced. */
  readonly expanded?: boolean;
  /** The id of the element it opens. */
  readonly controls?: string;
  readonly className?: string;
}

/**
 * A native icon button for opening a chat. It places itself nowhere and keeps
 * no state: position it with `className`, and open the chat in `onClick`.
 */
export function LauncherButton({
  onClick,
  label = 'Open chat',
  expanded,
  controls,
  className,
}: LauncherButtonProps) {
  return (
    <button
      type="button"
      className={['tp-launcher-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={() => onClick()}
    >
      <svg
        className="tp-launcher-button__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
