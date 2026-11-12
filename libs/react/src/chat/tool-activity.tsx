'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { AgentPlanStep } from '@threadplane/core';
import {
  activityFailures,
  confirmedOutcomes,
  outcomeSources,
  receiptOutcomes,
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome.js';
import { activitySummary, formatElapsed, workingLabel } from './activity-summary.js';
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
/**
 * Resolve unresolved activity against explicit delivery facts without changing execution state.
 * `sessionRunning` says the session is still working: a call still running after its message
 * completed, such as a browser client tool, is then running rather than unknown.
 */
export function toolActivityPhase(
  phase: ToolActivityPhase | undefined,
  delivery?: ToolActivityDelivery,
  sessionRunning = false
): ToolActivityPhase {
  if (phase !== 'pending' && phase !== 'running') return phase ?? 'unknown';
  if (delivery?.phase !== 'complete') return phase;
  if (phase === 'running' && sessionRunning && delivery.outcome === 'success')
    return 'running';
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
  /** Where declared sources appear. Defaults to links under the activity; see `ToolSourcePlacement`. */
  readonly sources?: ToolSourcePlacement;
  /** A row inside a group: only its status word reports a failure, because the group shows one failure panel below it. */
  readonly grouped?: boolean;
  /** "Retrying toSorted read" while a later call repeats this failed one. */
  readonly retrying?: string;
}
/**
 * Where an activity's declared sources appear. `links` (the default) shows them under the activity.
 * `panel` shows none here, for an application that lists them in its own Sources panel with
 * `citationsWithToolSources`. `MessageList` and `Chat` already do this.
 */
export type ToolSourcePlacement = 'links' | 'panel';
/** Human-readable activity with opt-in literal inspection and a persistent rich-result slot. */
export function ToolActivity({
  activity: input,
  children,
  onRetry,
  sources,
  grouped = false,
  retrying,
}: ToolActivityProps) {
  // Direct primitive use gets the same failed-outcome display as projected rows.
  const activity = resolveToolOutcome(input, input.outcome);
  const phase = activity.phase ?? 'unknown';
  const retry =
    onRetry && !grouped ? activityFailures([activity])[0]?.retry : undefined;
  return (
    <section
      className="tp-tool-activity"
      data-phase={phase}
      data-tool-id={activity.id}
    >
      <div className="tp-tool-activity__heading">
        <span
          className={grouped ? 'tp-tool-activity__label' : undefined}
          data-active={grouped ? phase === 'running' : undefined}
        >
          {activity.label ?? 'Tool activity'}
        </span>
        <span className="tp-tool-activity__phase">{labels[phase]}</span>
        {activity.durationMs !== undefined &&
          Number.isFinite(activity.durationMs) &&
          activity.durationMs >= 0 && (
            <span className="tp-tool-activity__duration">
              {activity.durationMs}ms
            </span>
          )}
      </div>
      {phase === 'error' && !grouped && retrying && (
        <p
          className="tp-tool-activity__label tp-tool-activity__retrying"
          data-active="true"
        >
          {retrying}
        </p>
      )}
      {phase === 'error' && !grouped && (
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
      <ToolOutcomes activities={[activity]} placement={sources} />
      <ToolReceipts activities={[activity]} />
      {children}
    </section>
  );
}
function ToolOutcomes({
  activities,
  placement,
  show = 'all',
}: {
  readonly activities: readonly ToolActivityInfo[];
  readonly placement?: ToolSourcePlacement;
  /** An open group shows each call's sources under its row and keeps only the result text below the group. */
  readonly show?: 'all' | 'outcomes' | 'sources';
}) {
  const outcomes = show === 'sources' ? [] : confirmedOutcomes(activities);
  // A Sources panel that already lists these would otherwise show each source twice.
  const sources =
    placement === 'panel' || show === 'outcomes'
      ? []
      : outcomeSources(activities);
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
  /** Where declared sources appear. Defaults to links under the group; see `ToolSourcePlacement`. */
  readonly sources?: ToolSourcePlacement;
  /** "Retrying toSorted read" while a later call repeats a failed one; leads the failure panel. */
  readonly retrying?: string;
  /** Steps the agent declared. While the group runs and is open, its pending steps follow the calls, dimmed. */
  readonly plan?: readonly AgentPlanStep[];
  /** Stops the run. Offered beside the elapsed time while the group runs. */
  readonly onStop?: () => void;
  readonly children?: ReactNode;
}
/** Seconds since `active` last became true, ticking once a second; undefined while idle. */
function useElapsed(active: boolean): string | undefined {
  const [start, setStart] = useState<number>();
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) {
      setStart(undefined);
      return;
    }
    const begun = Date.now();
    setStart(begun);
    setNow(begun);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active && start !== undefined ? formatElapsed(now - start) : undefined;
}
/** Opt-in message/turn group. Individual disclosure state follows call IDs. */
export function ToolActivityGroup({
  activities: input,
  label,
  renderResult,
  onRetry,
  context,
  sources,
  retrying,
  plan,
  onStop,
  children,
}: ToolActivityGroupProps) {
  // Resolve once so the label, cue, live region and rows agree on each phase.
  const activities = input.map((activity) =>
    resolveToolOutcome(activity, activity.outcome)
  );
  const summary = activitySummary(activities, label);
  // Sources move under their row while the group is open.
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(summary.active);
  const upcoming = summary.active
    ? plan?.filter((step) => step.status === 'pending') ?? []
    : [];
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
        <details
          className="tp-tool-activity-group__details"
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>
            {/* Open while running: a static count; the current step shimmers in its row. */}
            <span
              className="tp-tool-activity__label"
              data-active={summary.active && !open}
            >
              {summary.active && open && label === undefined
                ? workingLabel(activities)
                : summary.label}
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
                grouped
              >
                {open && (
                  <ToolOutcomes
                    activities={[activity]}
                    placement={sources}
                    show="sources"
                  />
                )}
              </ToolActivity>
            ))}
            {upcoming.map((step, index) => (
              <p key={index} className="tp-tool-activity-group__plan-step">
                {step.label}
              </p>
            ))}
          </div>
        </details>
      )}
      {summary.active && (elapsed !== undefined || onStop) && (
        <div className="tp-tool-activity-group__progress">
          {elapsed !== undefined && (
            <span className="tp-tool-activity-group__elapsed">{elapsed}</span>
          )}
          {onStop && (
            <button
              type="button"
              className="tp-tool-activity-group__stop"
              onClick={onStop}
            >
              Stop
            </button>
          )}
        </div>
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
      <ToolOutcomes
        activities={activities}
        placement={sources}
        show={open ? 'outcomes' : 'all'}
      />
      {failed && (
        <StatusPanel
          tone="danger"
          role="alert"
          className="tp-tool-activity__error"
        >
          {retrying && (
            <p
              className="tp-tool-activity__label tp-tool-activity__retrying"
              data-active="true"
            >
              {retrying}
            </p>
          )}
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
