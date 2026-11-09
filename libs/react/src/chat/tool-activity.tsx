'use client';
import type { ReactNode } from 'react';
import {
  confirmedOutcomes,
  outcomeSources,
  type ToolActivityOutcome,
} from './tool-outcome.js';
import { activitySummary } from './activity-summary.js';
export type {
  ToolActivityOutcome,
  ToolActivitySource,
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
}
/** Human-readable activity with opt-in literal inspection and a persistent rich-result slot. */
export function ToolActivity({ activity, children }: ToolActivityProps) {
  const phase = activity.phase ?? 'unknown';
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
/** Explicit opt-in grouping for related display activities, with no execution ownership. */
export interface ToolActivityGroupProps {
  readonly activities: readonly ToolActivityInfo[];
  readonly label?: string;
  readonly children?: ReactNode;
}
/** Opt-in message/turn group. Individual disclosure state follows call IDs. */
export function ToolActivityGroup({
  activities,
  label,
  children,
}: ToolActivityGroupProps) {
  const summary = activitySummary(activities, label);
  const failed = summary.phase === 'error';
  const failureSummaries = [
    ...new Set(
      activities.flatMap((item) =>
        item.phase === 'error' && item.errorSummary ? [item.errorSummary] : []
      )
    ),
  ];
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
        </p>
      )}
      <ToolOutcomes activities={activities} />
      {failed && (
        <div role="alert" className="tp-tool-activity__error">
          {failureSummaries.length > 0 ? (
            failureSummaries.map((text) => <p key={text}>{text}</p>)
          ) : (
            <p>Some tools could not finish. Check Details before retrying.</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
