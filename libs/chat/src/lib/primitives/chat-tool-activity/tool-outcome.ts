import type { ToolActivityInfo } from './chat-tool-activity.component';

/** An application-authored source for a confirmed tool outcome. Only absolute HTTP(S) URLs render as links. */
export interface ToolActivitySource {
  readonly title: string;
  readonly url: string;
}
/** An opt-in retry the application declares for one failed call. The label names the call, such as "Retry toSorted read". */
export interface ToolActivityRetry {
  readonly label: string;
}
/**
 * Concise, application-authored result evidence. A missing status means succeeded.
 * `failed` shows a completed call as failed and may declare a retry the application handles.
 * `receipt` records a write the application confirmed from the decoded result, never from an approval.
 */
export type ToolActivityOutcome =
  | {
      readonly status?: 'succeeded';
      readonly text: string;
      readonly sources?: readonly ToolActivitySource[];
      /** Only a failed call can declare a retry. */
      readonly retry?: never;
    }
  | {
      readonly status: 'failed';
      readonly text: string;
      readonly sources?: readonly ToolActivitySource[];
      /** Offered only while the call is still worth retrying; the library never runs it. */
      readonly retry?: ToolActivityRetry;
    }
  | {
      readonly status: 'receipt';
      /** What was written and where, such as "Note #4821 in Comparisons." */
      readonly text: string;
      /** Short lead sentence; defaults to "Saved." */
      readonly lead?: string;
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
      activity.phase === 'complete' &&
      activity.outcome?.status !== 'failed' &&
      activity.outcome?.status !== 'receipt'
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
        ? (activity.outcome && 'sources' in activity.outcome
            ? activity.outcome.sources
            : undefined) ?? []
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

/** A confirmed write shown as a receipt: only a complete call with a `receipt` outcome. */
export interface ToolActivityReceipt {
  readonly id: string;
  readonly lead: string;
  readonly text: string;
}
export function receiptOutcomes(
  activities: readonly ToolActivityInfo[]
): readonly ToolActivityReceipt[] {
  return activities.flatMap((activity) =>
    activity.phase === 'complete' && activity.outcome?.status === 'receipt'
      ? [
          {
            id: activity.id,
            lead: activity.outcome.lead?.trim() || 'Saved.',
            text: activity.outcome.text,
          },
        ]
      : []
  );
}
const canonical = (text: string | undefined): string => {
  if (text === undefined) return '';
  try {
    const sort = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sort)
        : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sort((value as Record<string, unknown>)[key])])
          )
        : value;
    return JSON.stringify(sort(JSON.parse(text)));
  } catch {
    return text;
  }
};
/**
 * IDs of failed calls whose declared retry is still worth offering.
 * None while any call in `context` is pending or running, and a call drops out
 * once a later call with the same tool name and arguments exists. `context` is
 * every observed call in transcript order and defaults to `activities`.
 */
export function retryableToolIds(
  activities: readonly ToolActivityInfo[],
  context: readonly ToolActivityInfo[] = activities
): ReadonlySet<string> {
  if (
    context.some(
      (item) => item.phase === 'pending' || item.phase === 'running'
    )
  )
    return new Set();
  const key = (item: ToolActivityInfo) =>
    item.name + '\0' + canonical(item.argumentsText);
  const last = new Map<string, string>();
  for (const item of context) last.set(key(item), item.id);
  return new Set(
    activities.flatMap((item) =>
      item.phase === 'error' &&
      item.outcome?.status === 'failed' &&
      item.outcome.retry?.label.trim() &&
      last.get(key(item)) === item.id
        ? [item.id]
        : []
    )
  );
}
/** Removes a declared retry that is no longer offered, leaving the failure itself intact. */
export function withoutStaleRetry(
  activity: ToolActivityInfo,
  retryable: ReadonlySet<string>
): ToolActivityInfo {
  const outcome = activity.outcome;
  if (outcome?.status !== 'failed' || !outcome.retry || retryable.has(activity.id))
    return activity;
  const { retry: _retry, ...rest } = outcome;
  return { ...activity, outcome: rest };
}
/** One line of the failure panel: app-safe copy and, when still offered, the call's retry. */
export interface ToolActivityFailure {
  readonly key: string;
  readonly text: string;
  readonly retry?: { readonly activity: ToolActivityInfo; readonly label: string };
}
/** Failure lines in call order. Identical messages are listed once unless a call carries its own retry. */
export function activityFailures(
  activities: readonly ToolActivityInfo[],
  context?: readonly ToolActivityInfo[]
): readonly ToolActivityFailure[] {
  const retryable = retryableToolIds(activities, context);
  const seen = new Set<string>();
  return activities.flatMap((activity) => {
    const text = activity.errorSummary;
    if (activity.phase !== 'error' || !text) return [];
    if (retryable.has(activity.id) && activity.outcome?.status === 'failed' && activity.outcome.retry)
      return [
        {
          key: activity.id,
          text,
          retry: { activity, label: activity.outcome.retry.label.trim() },
        },
      ];
    if (seen.has(text)) return [];
    seen.add(text);
    return [{ key: text, text }];
  });
}
/** What a per-tool decoder receives: the call's parsed arguments and result beside the literal activity. */
export interface ToolOutcomeCall {
  readonly activity: ToolActivityInfo;
  /** Parsed JSON arguments, or undefined when they are not valid JSON. */
  readonly args: unknown;
  /** Parsed JSON result, or the literal result text when it is not JSON. */
  readonly result: unknown;
}
/** Decodes one tool's declared result schema. Return undefined for anything it does not recognise. */
export type ToolOutcomeDecoder = (
  call: ToolOutcomeCall
) => ToolActivityOutcome | undefined;
/**
 * Builds a `toolOutcome` callback from one decoder per tool name.
 * A decoder runs only for a complete call of its own tool that has a result, so
 * running, stopped and failed calls and every undeclared tool stay literal.
 * Parsing is done once here; values such as `false`, `0`, `""`, `[]` and `null`
 * reach the decoder unchanged and mean nothing until it says so.
 */
export function toolOutcomes(
  decoders: Readonly<Record<string, ToolOutcomeDecoder>>
): (activity: ToolActivityInfo) => ToolActivityOutcome | undefined {
  const parse = (text: string | undefined, fallback: unknown): unknown => {
    if (text === undefined) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };
  return (activity) => {
    if (
      activity.phase !== 'complete' ||
      activity.resultText === undefined ||
      !Object.hasOwn(decoders, activity.name)
    )
      return undefined;
    return decoders[activity.name]({
      activity,
      args: parse(activity.argumentsText, undefined),
      result: parse(activity.resultText, activity.resultText),
    });
  };
}
