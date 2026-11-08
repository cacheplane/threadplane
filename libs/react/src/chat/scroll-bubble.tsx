'use client';

/** Presentation of a latest-activity action. The parent owns visibility. */
export type ScrollBubbleMode = 'streaming' | 'idle';

/** Passive action props; no session or scrolling owner is created. */
export interface ScrollBubbleProps {
  readonly mode: ScrollBubbleMode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly className?: string;
}

/** Requests an explicit jump to the latest transcript activity. */
export function ScrollBubble({
  mode,
  onClick,
  disabled,
  label,
  className,
}: ScrollBubbleProps) {
  const text = label ?? 'Scroll to latest';
  return (
    <button
      type="button"
      disabled={disabled}
      className={['tp-scroll-bubble', className].filter(Boolean).join(' ')}
      aria-label={
        label ??
        (mode === 'streaming' ? 'Scroll to latest, response in progress' : text)
      }
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {mode === 'streaming' ? (
        <span className="tp-scroll-bubble__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M10 3v14m-6-6 6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )}
      <span>{text}</span>
    </button>
  );
}
