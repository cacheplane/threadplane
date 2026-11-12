'use client';

/** Placeholder presentation for generated UI that is still being built; it owns no work. */
export interface GenerativeUiSkeletonProps {
  /** Readable text, also what assistive technology hears. Defaults to "Building UI…". */
  readonly label?: string;
  /** False keeps the placeholder silent when the owner already announces progress. */
  readonly announce?: boolean;
  readonly className?: string;
}

/**
 * A labelled card of decorative shimmer rows to show where generated UI will
 * appear. Mount it while the UI is being built and replace it when the UI is
 * ready; it reports nothing and acknowledges nothing.
 */
export function GenerativeUiSkeleton({
  label = 'Building UI…',
  announce = true,
  className,
}: GenerativeUiSkeletonProps) {
  return (
    <div
      className={['tp-genui-skeleton', className].filter(Boolean).join(' ')}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? true : undefined}
    >
      <span className="tp-genui-skeleton__label">{label}</span>
      <span className="tp-genui-skeleton__rows" aria-hidden="true">
        <span className="tp-genui-skeleton__row" />
        <span className="tp-genui-skeleton__row" />
        <span className="tp-genui-skeleton__row" />
      </span>
    </div>
  );
}
