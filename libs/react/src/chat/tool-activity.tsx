'use client';
import type { ReactNode } from 'react';
import {
  activityFailures,
  confirmedOutcomes,
  outcomeSources,
  receiptOutcomes,
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome.js';
import { activitySummary } from './activity-summary.js';
import { StatusPanel } from './status-panel.js';
export type {
  ToolActivityOutcome,
  ToolActivityRetry,
  ToolActivitySource,
  ToolOutcomeCall,
  ToolOutcomeDecoder,
} from './tool-outcome.js';

/** Explicit presentation state supplied by an application or adapter, never inferred from literal payloads. */
export type ToolActivityPhase =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'stopped'
  | 'waiting'
  | 'unknown';
/** Observed delivery evidence; a pause does not establish approval. */
export type ToolActivityDelivery =
  | { readonly phase: 'streaming' }
  | {
      readonly phase: 'complete';
      readonly outcome:
        | 'success'
        | 'error'
        | 'aborted'
        | 'interrupted'
        | 'paused';
    };
/** Resolve unresolved activity against explicit delivery facts without changing execution state. */
export function toolActivityPhase(
  phase: ToolActivityPhase | undefined,
  delivery?: ToolActivityDelivery
): ToolActivityPhase {
  if (phase !== 'pending' && phase !== 'running') return phase ?? 'unknown';
  if (delivery?.phase !== 'complete') return phase;
  return delivery.outcome === 'aborted'
    ? 'stopped'
    : delivery.outcome === 'paused'
    ? 'waiting'
    : delivery.outcome === 'success' && phase === 'pending'
    ? 'pending'
    : 'unknown';
}
/** Readonly activity evidence. Does not own execution, approval, sessions or persistence. */
export interface ToolActivityInfo {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly phase?: ToolActivityPhase;
  readonly argumentsText?: string;
  readonly resultText?: string;
  readonly errorText?: string;
  /** Safe user-facing copy; diagnostic errorText stays in Details. */
  readonly errorSummary?: string;
  readonly durationMs?: number;
  /** App-authored preview, displayed only after explicit completion and outside technical Details. */
  readonly outcome?: ToolActivityOutcome;
}
const labels: Record<ToolActivityPhase, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
  stopped: 'Stopped',
  waiting: 'Waiting',
  unknown: 'Status unavailable',
};
/** Presentation evidence and an independently mounted rich-result/action slot. */
export interface ToolActivityProps {
  readonly activity: ToolActivityInfo;
  /** Rich results and approval actions stay mounted outside technical Details. */
  readonly children?: ReactNode;
  /** Application-owned handler for a declared retry. Without it no retry control renders. */
  readonly onRetry?: (activity: ToolActivityInfo) => void;
}
/** Human-readable activity with opt-in literal inspection and a persistent rich-result slot. */
export function ToolActivity({
  activity: input,
  children,
  onRetry,
}: ToolActivityProps) {
  // Direct primitive use gets the same failed-outcome display as projected rows.
  const activity = resolveToolOutcome(input, input.outcome);
  const phase = activity.phase ?? 'unknown';
  const retry = onRetry ? activityFailures([activity])[0]?.retry : undefined;
  return (
    <section
      className="tp-tool-activity"
      data-phase={phase}
      data-tool-id={activity.id}
    >
      <div className="tp-tool-activity__heading">
        <span>{activity.label ?? 'Tool activity'}</span>
        <span className="tp-tool-activity__phase">{labels[phase]}</span>
        {activity.durationMs !== undefined &&
          Number.isFinite(activity.durationMs) &&
          activity.durationMs >= 0 && (
            <span className="tp-tool-activity__duration">
              {activity.durationMs}ms
            </span>
          )}
      </div>
      {phase === 'error' && (
        <p className="tp-tool-activity__error" role="alert">
          {activity.errorSummary ??
            'This tool could not finish. Check Details before retrying.'}
        </p>
      )}
      {retry && onRetry && (
        <button
          type="button"
          className="tp-tool-activity__retry"
          onClick={() => onRetry(retry.activity)}
        >
          {retry.label}
        </button>
      )}
      <details className="tp-tool-activity__details">
        <summary>Details</summary>
        <dl>
          <dt>Tool</dt>
          <dd>
            <code>{activity.name}</code>
          </dd>
          <dt>Call ID</dt>
          <dd>
            <code>{activity.id}</code>
          </dd>
        </dl>
        {activity.argumentsText !== undefined && (
          <>
            <p>Arguments</p>
            <pre>{activity.argumentsText}</pre>
          </>
        )}
        {activity.resultText !== undefined && (
          <>
            <p>Result</p>
            <pre>{activity.resultText}</pre>
          </>
        )}
        {activity.errorText !== undefined && (
          <>
            <p>Error</p>
            <pre>{activity.errorText}</pre>
          </>
        )}
      </details>
      <ToolOutcomes activities={[activity]} />
      <ToolReceipts activities={[activity]} />
      {children}
    </section>
  );
}
function ToolOutcomes({
  activities,
}: {
  readonly activities: readonly ToolActivityInfo[];
}) {
  const outcomes = confirmedOutcomes(activities);
  const sources = outcomeSources(activities);
  if (!outcomes.length && !sources.length) return null;
  return (
    <div className="tp-tool-outcomes">
      {outcomes.slice(0, 3).map((outcome) => (
        <p key={outcome.text}>{outcome.text}</p>
      ))}
      {outcomes.length > 3 && (
        <details>
          <summary>More results ({outcomes.length - 3})</summary>
          {outcomes.slice(3).map((outcome) => (
            <p key={outcome.text}>{outcome.text}</p>
          ))}
        </details>
      )}
      {!!sources.length && (
        <ul aria-label="Tool sources">
          {sources.slice(0, 3).map((source) => (
            <li key={new URL(source.url).href}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      {sources.length > 3 && (
        <details>
          <summary>More sources ({sources.length - 3})</summary>
          <ul aria-label="More tool sources">
            {sources.slice(3).map((source) => (
              <li key={new URL(source.url).href}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
function ToolReceipts({
  activities,
}: {
  readonly activities: readonly ToolActivityInfo[];
}) {
  return (
    <>
      {receiptOutcomes(activities).map((receipt) => (
        <StatusPanel
          key={receipt.id}
          tone="success"
          lead={receipt.lead}
          className="tp-tool-activity__receipt"
        >
          <p>{receipt.text}</p>
        </StatusPanel>
      ))}
    </>
  );
}
/** Explicit opt-in grouping for related display activities, with no execution ownership. */
export interface ToolActivityGroupProps {
  readonly activities: readonly ToolActivityInfo[];
  readonly label?: string;
  /** App-owned per-call result or action, rendered outside the collapsed group; null or undefined omits the call. */
  readonly renderResult?: (activity: ToolActivityInfo) => ReactNode;
  /** Application-owned handler for a declared retry. Without it no retry control renders. */
  readonly onRetry?: (activity: ToolActivityInfo) => void;
  /** Every observed call in transcript order, so a retry stops being offered once a later call repeats it or work is running. Defaults to this group's activities. */
  readonly context?: readonly ToolActivityInfo[];
  readonly children?: ReactNode;
}
/** Opt-in message/turn group. Individual disclosure state follows call IDs. */
export function ToolActivityGroup({
  activities: input,
  label,
  renderResult,
  onRetry,
  context,
  children,
}: ToolActivityGroupProps) {
  // Resolve once so the label, cue, live region and rows agree on each phase.
  const activities = input.map((activity) =>
    resolveToolOutcome(activity, activity.outcome)
  );
  const summary = activitySummary(activities, label);
  const failed = summary.phase === 'error';
  const failures = activityFailures(activities, context);
  const receipts = receiptOutcomes(activities);
  const results = renderResult
    ? activities.flatMap((activity) => {
        const result = renderResult(activity);
        return result === null || result === undefined
          ? []
          : [
              <div key={activity.id} data-tool-id={activity.id}>
                {result}
              </div>,
            ];
      })
    : [];
  return (
    <section
      className="tp-tool-activity-group"
      data-phase={summary.phase}
      data-active={summary.active}
    >
      {activities.length > 0 && (
        <details className="tp-tool-activity-group__details">
          <summary>
            <span
              className="tp-tool-activity__label"
              data-active={summary.active}
            >
              {summary.label}
            </span>
            {summary.cue && (
              <span className="tp-tool-activity__cue">{summary.cue}</span>
            )}
          </summary>
          <div className="tp-tool-activity-group__items">
            {activities.map((activity) => (
              <ToolActivity
                key={activity.id}
                activity={{ ...activity, outcome: undefined }}
              />
            ))}
          </div>
        </details>
      )}
      {activities.length > 0 && (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="tp-tool-activity__status"
        >
          {summary.status}
          {receipts.map((receipt) => ` ${receipt.lead} ${receipt.text}`)}
        </p>
      )}
      <ToolOutcomes activities={activities} />
      {failed && (
        <StatusPanel
          tone="danger"
          role="alert"
          className="tp-tool-activity__error"
        >
          {failures.length > 0 ? (
            failures.flatMap(({ key, text, retry }) => [
              <p key={key}>{text}</p>,
              retry && onRetry && (
                <button
                  key={`${key}-retry`}
                  type="button"
                  className="tp-tool-activity__retry"
                  onClick={() => onRetry(retry.activity)}
                >
                  {retry.label}
                </button>
              ),
            ])
          ) : (
            <p>Some tools could not finish. Check Details before retrying.</p>
          )}
        </StatusPanel>
      )}
      <ToolReceipts activities={activities} />
      {results.length > 0 && (
        <div className="tp-tool-activity__results">{results}</div>
      )}
      {children}
    </section>
  );
}
