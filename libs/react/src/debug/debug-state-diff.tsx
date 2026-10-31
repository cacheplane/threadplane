import { compareDebugStates } from './state-diff.js';
import type { DebugValue } from './types.js';

export interface StateDiffProps {
  readonly before: DebugValue;
  readonly after: DebugValue;
  readonly label?: string;
  readonly className?: string;
}

/** A passive comparison of supplied plain data. Import debug/styles.css explicitly. */
export function StateDiff({
  before,
  after,
  label = 'State changes',
  className,
}: StateDiffProps) {
  const comparison = compareDebugStates(before, after);
  return (
    <section
      aria-label={label}
      className={['tp-debug-state-diff', className].filter(Boolean).join(' ')}
    >
      <h3>{label}</h3>
      {comparison.status === 'ready' ? (
        comparison.count === 0 ? (
          <p>No changes in the supplied states.</p>
        ) : (
          <>
            <p>
              Paths use JSON Pointer; the empty string identifies the root.
              Changes to arrays show whole arrays.
            </p>
            <pre aria-label={`${label} JSON`}>{comparison.text}</pre>
          </>
        )
      ) : (
        <p role="status">
          {comparison.status === 'invalid'
            ? 'Comparison unavailable: supplied states contain invalid plain data.'
            : comparison.status === 'input-limit'
            ? 'Comparison unavailable: supplied states exceed comparison limits.'
            : 'Comparison unavailable: changes exceed display limits.'}
        </p>
      )}
    </section>
  );
}
