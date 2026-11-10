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

/**
 * @internal True when some completed call currently offers a retry declared by `toolOutcome`.
 * Lets a composition drop a generic "Retry" that would re-run the whole request beside it.
 */
export function offersToolRetry(
  calls: readonly ToolCall[],
  toolOutcome: ((activity: ToolActivityInfo) => ToolActivityOutcome | undefined) | undefined
): boolean {
  if (!toolOutcome) return false;
  const activities = calls.map((call): ToolActivityInfo => {
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
  return retryableToolIds(activities).size > 0;
}
