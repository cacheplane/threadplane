// libs/chat/src/lib/primitives/chat-tool-calls/tool-retry-offer.ts
import type { ToolCall } from '../../agent';
import type { ToolActivityInfo, ToolActivityOutcome } from '../chat-tool-activity/chat-tool-activity.component';
import { resolveToolOutcome, retryableToolIds } from '../chat-tool-activity/tool-outcome';

const literal = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
};

type ToolOutcomeFn = ((activity: ToolActivityInfo) => ToolActivityOutcome | undefined) | undefined;

function resolvedActivities(calls: readonly ToolCall[], toolOutcome: NonNullable<ToolOutcomeFn>): ToolActivityInfo[] {
  return calls.map((call): ToolActivityInfo => {
    const activity: ToolActivityInfo = {
      id: call.id,
      name: call.name,
      phase: call.status === 'complete' ? 'complete' : call.status === 'error' ? 'error' : 'unknown',
      argumentsText: literal(call.args),
      resultText: call.status === 'complete' ? literal(call.result) : undefined,
    };
    try {
      return resolveToolOutcome(activity, toolOutcome(activity));
    } catch {
      return activity;
    }
  });
}

/**
 * @internal True when some completed call currently offers a retry declared by `toolOutcome`.
 * Lets a composition drop a generic "Retry" that would re-run the whole request beside it.
 */
export function offersToolRetry(calls: readonly ToolCall[], toolOutcome: ToolOutcomeFn): boolean {
  return !!toolOutcome && retryableToolIds(resolvedActivities(calls, toolOutcome)).size > 0;
}

/**
 * @internal True when `message` is word for word the failure a call already shows through `toolOutcome`.
 * Lets a composition skip a run-error notice that would only say the same thing twice.
 */
export function repeatsToolFailure(message: string, calls: readonly ToolCall[], toolOutcome: ToolOutcomeFn): boolean {
  const text = message.trim();
  if (!toolOutcome || !text) return false;
  return resolvedActivities(calls, toolOutcome).some(
    (activity) => activity.outcome?.status === 'failed' && activity.errorSummary === text
  );
}
