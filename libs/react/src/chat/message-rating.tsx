'use client';

/** A positive or negative judgement of one response. */
export type MessageRatingValue = 'up' | 'down';

/** Controls the rating shown for one identified message and reports each requested change with that identity. */
export interface MessageRatingProps {
  readonly messageId: string;
  readonly value: MessageRatingValue | null;
  readonly onValueChange: (
    value: MessageRatingValue | null,
    messageId: string
  ) => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly upLabel?: string;
  readonly downLabel?: string;
  readonly className?: string;
}

const paths: Record<MessageRatingValue, readonly string[]> = {
  up: [
    'M7 11V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1h3z',
    'M7 11l4-7a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1.5H7',
  ],
  down: [
    'M17 13V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3z',
    'M17 13l-4 7a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-4H4a2 2 0 0 1-2-2l2-7A2 2 0 0 1 6 5h11',
  ],
};

/**
 * Controlled thumbs up and down for one response. The owner holds the rating
 * and decides whether a requested change is accepted, stored or sent; pressing
 * the current rating requests that it be cleared.
 */
export function MessageRating({
  messageId,
  value,
  onValueChange,
  disabled = false,
  label = 'Rate response',
  upLabel = 'Good response',
  downLabel = 'Poor response',
  className,
}: MessageRatingProps) {
  const option = (rating: MessageRatingValue, text: string) => (
    <button
      type="button"
      className="tp-message-actions__action tp-message-actions__action--icon-only tp-message-rating__option"
      data-rating={rating}
      aria-pressed={value === rating}
      title={text}
      disabled={disabled}
      onClick={() => {
        if (!disabled)
          onValueChange(value === rating ? null : rating, messageId);
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
          {paths[rating].map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
      <span className="tp-message-actions__label">{text}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={['tp-message-actions tp-message-rating', className]
        .filter(Boolean)
        .join(' ')}
      data-message-id={messageId}
    >
      {option('up', upLabel)}
      {option('down', downLabel)}
    </div>
  );
}
