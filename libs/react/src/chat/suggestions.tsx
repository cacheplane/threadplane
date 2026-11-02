'use client';

/** A caller-authored literal suggestion with stable identity. */
export interface SuggestionItem {
  /** Stable, unique identity within the group. */
  readonly id: string;
  /** Literal visible button label. */
  readonly label: string;
  /** Exact value passed to onSelect without transformation. */
  readonly value: string;
  /** Prevents selection only when strictly true. */
  readonly disabled?: boolean;
}

/** Configures a controlled group without owning draft or submission state. */
export interface SuggestionsProps {
  /** Caller-authored items; duplicate IDs throw TypeError. */
  readonly suggestions: readonly SuggestionItem[];
  /** Receives the exact value on an enabled, unclaimed click. */
  readonly onSelect: (value: string) => void;
  /** Disables all items only when strictly true. */
  readonly disabled?: boolean;
  /** Accessible group label, defaulting to Suggested replies. */
  readonly label?: string;
  /** Additional classes on the group. */
  readonly className?: string;
}

/** Presents explicit choices; callers own draft, focus and submission. */
export function Suggestions({
  suggestions,
  onSelect,
  disabled,
  label = 'Suggested replies',
  className,
}: SuggestionsProps) {
  const ids = new Set<string>();
  for (const item of suggestions) {
    if (ids.has(item.id)) throw new TypeError('Duplicate suggestion ID');
    ids.add(item.id);
  }
  if (suggestions.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={['tp-suggestions', className].filter(Boolean).join(' ')}
    >
      {suggestions.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tp-suggestions__button"
          disabled={disabled === true || item.disabled === true}
          onClick={(event) => {
            if (
              disabled === true ||
              item.disabled === true ||
              event.defaultPrevented
            )
              return;
            onSelect(item.value);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
