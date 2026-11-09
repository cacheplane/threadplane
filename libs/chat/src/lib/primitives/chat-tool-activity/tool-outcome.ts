import type { ToolActivityInfo } from './chat-tool-activity.component';

/** An application-authored source for a confirmed tool outcome. Only absolute HTTP(S) URLs render as links. */
export interface ToolActivitySource {
  readonly title: string;
  readonly url: string;
}
/** Concise, application-authored result evidence; does not establish persistence or business confirmation. A missing status means succeeded. */
export type ToolActivityOutcome =
  | {
      readonly status?: 'succeeded';
      readonly text: string;
      readonly sources?: readonly ToolActivitySource[];
    }
  | {
      readonly status: 'failed';
      readonly text: string;
      readonly sources?: readonly ToolActivitySource[];
    };
interface Activity {
  readonly phase?: string;
  readonly outcome?: ToolActivityOutcome;
}
export function confirmedOutcomes(
  activities: readonly Activity[]
): readonly ToolActivityOutcome[] {
  const seen = new Set<string>();
  return activities.flatMap((activity) => {
    const outcome =
      activity.phase === 'complete' && activity.outcome?.status !== 'failed'
        ? activity.outcome
        : undefined;
    if (!outcome || seen.has(outcome.text)) return [];
    seen.add(outcome.text);
    return [outcome];
  });
}
export function outcomeSources(
  activities: readonly Activity[]
): readonly ToolActivitySource[] {
  const seen = new Set<string>();
  return activities
    .flatMap((activity) =>
      activity.phase === 'complete' ||
      (activity.phase === 'error' && activity.outcome?.status === 'failed')
        ? activity.outcome?.sources ?? []
        : []
    )
    .filter((source) => {
      try {
        const url = new URL(source.url);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          seen.has(url.href) ||
          url.username ||
          url.password
        )
          return false;
        seen.add(url.href);
        return true;
      } catch {
        return false;
      }
    });
}
/**
 * Attaches an app-declared outcome; a failed outcome turns a complete call into a displayed error without touching technical payloads.
 * Idempotent, so primitives can re-apply it to an already resolved activity. Blank failure text falls back to the generic failure copy.
 */
export function resolveToolOutcome(
  activity: ToolActivityInfo,
  outcome: ToolActivityOutcome | undefined
): ToolActivityInfo {
  if (activity.phase === 'complete' && outcome?.status === 'failed') {
    return {
      ...activity,
      phase: 'error',
      errorSummary: outcome.text.trim() || undefined,
      outcome,
    };
  }
  return { ...activity, outcome };
}
export function activityProgress(activities: readonly Activity[]): string {
  const names: Record<string, string> = {
    complete: 'complete',
    running: 'running',
    pending: 'pending',
    waiting: 'waiting',
    error: 'failed',
    stopped: 'stopped',
    unknown: 'status unavailable',
  };
  return Object.entries(names)
    .flatMap(([phase, label]) => {
      const count = activities.filter(
        (activity) => (activity.phase ?? 'unknown') === phase
      ).length;
      return count ? [`${count} ${label}`] : [];
    })
    .join(' · ');
}
