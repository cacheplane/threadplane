'use client';
import type { ReactNode } from 'react';

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
      {children}
    </section>
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
  const failed = activities.some((item) => item.phase === 'error');
  const running = activities.some((item) => item.phase === 'running');
  const phase = failed
    ? 'error'
    : running
    ? 'running'
    : activities.some((item) => item.phase === 'waiting')
    ? 'waiting'
    : activities.some((item) => item.phase === 'pending')
    ? 'pending'
    : activities.some((item) => item.phase === 'stopped')
    ? 'stopped'
    : activities.every((item) => item.phase === 'complete')
    ? 'complete'
    : 'unknown';
  return (
    <section className="tp-tool-activity-group" data-phase={phase}>
      {activities.length > 0 && (
        <details className="tp-tool-activity-group__details">
          <summary>
            <span>
              {label ??
                `${activities.length} tool ${
                  activities.length === 1 ? 'activity' : 'activities'
                }`}
            </span>
            <span className="tp-tool-activity__phase">{labels[phase]}</span>
          </summary>
          <div className="tp-tool-activity-group__items">
            {activities.map((activity) => (
              <ToolActivity key={activity.id} activity={activity} />
            ))}
          </div>
        </details>
      )}
      {failed && (
        <p role="alert" className="tp-tool-activity__error">
          Some tools could not finish. Check Details before retrying.
        </p>
      )}
      {children}
    </section>
  );
}
