'use client';
import { useId, useState, type ReactNode } from 'react';

/** The execution state a trace shows. */
export type TraceState = 'pending' | 'running' | 'done' | 'error';

/** Presentation options for one collapsible step of work; the owner supplies its state. */
export interface TraceProps {
  /** What the step is; it names the toggle. */
  readonly label: ReactNode;
  /** Defaults to `pending`. A `running` or `error` trace opens by itself. */
  readonly state?: TraceState;
  /** Decorative content before the label. */
  readonly icon?: ReactNode;
  /** Short content after the label, such as a duration. */
  readonly meta?: ReactNode;
  /** Whether a `pending` or `done` trace starts open. */
  readonly defaultExpanded?: boolean;
  readonly className?: string;
  /** The detail shown while the trace is open. */
  readonly children?: ReactNode;
}

const opens = (state: TraceState) => state === 'running' || state === 'error';

/**
 * A disclosure for one step of work. It is open while `running` or in `error`
 * and otherwise follows `defaultExpanded`, until the reader toggles it; their
 * choice then holds until the trace next enters `running` or `error`. It owns
 * only that choice: no work, timers or subscriptions.
 */
export function Trace({
  label,
  state = 'pending',
  icon,
  meta,
  defaultExpanded = false,
  className,
  children,
}: TraceProps) {
  const id = useId();
  const [choice, setChoice] = useState({
    state,
    expanded: null as boolean | null,
  });
  let current = choice;
  if (choice.state !== state) {
    // Entering running or error from another state lets the trace open again.
    current = { state, expanded: opens(state) ? null : choice.expanded };
    setChoice(current);
  }
  const expanded = current.expanded ?? (opens(state) || defaultExpanded);
  return (
    <div
      className={['tp-trace', className].filter(Boolean).join(' ')}
      data-state={state}
      data-expanded={expanded}
    >
      <button
        type="button"
        className="tp-trace__header"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        onClick={() => setChoice({ state, expanded: !expanded })}
      >
        <svg
          className="tp-trace__chevron"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span className="tp-trace__label">
          {icon === undefined ? null : (
            <span className="tp-trace__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <span className="tp-trace__text">{label}</span>
        </span>
        {meta === undefined ? null : (
          <>
            {/* Keeps the label and meta apart in the toggle's accessible name. */}{' '}
            <span className="tp-trace__meta">{meta}</span>
          </>
        )}
      </button>
      <div
        id={`${id}-content`}
        className="tp-trace__content"
        hidden={!expanded}
      >
        {children}
      </div>
    </div>
  );
}
