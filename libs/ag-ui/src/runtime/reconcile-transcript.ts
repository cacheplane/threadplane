import type { Message } from '@ag-ui/client';
import { ownTranscript, type Transcript } from './transcript.js';

/** Mirrors @ag-ui/client 1.0.1 MESSAGES_SNAPSHOT ordering and role policy:
 * surviving IDs keep their previous position and take the snapshot record,
 * local activity/reasoning records survive only when the snapshot carries no
 * message of that role, and new IDs are appended in snapshot order.
 * Deliberate differences: reject duplicate IDs, always replace same-ID records,
 * leave null-attribution sanitation to request egress, and do not read the
 * client's `authoritativeActivityTypes` snapshot metadata. */
export function reconcileTranscript(
  previous: Transcript,
  snapshot: readonly Message[] | Transcript
): Transcript {
  const captured = ownTranscript(snapshot);
  const incoming = new Map<string, Transcript[number]>();
  let hasActivity = false;
  let hasReasoning = false;
  for (const message of captured) {
    if (incoming.has(message.id))
      throw new TypeError('Duplicate message IDs in snapshot');
    incoming.set(message.id, message);
    if (message.role === 'activity') hasActivity = true;
    if (message.role === 'reasoning') hasReasoning = true;
  }

  const previousIds = new Set<string>();
  const result: Transcript[number][] = [];
  for (const message of previous) {
    if (previousIds.has(message.id))
      throw new TypeError('Duplicate message IDs in previous transcript');
    previousIds.add(message.id);
    const replacement = incoming.get(message.id);
    if (replacement) result.push(replacement);
    else if (
      (message.role === 'activity' && !hasActivity) ||
      (message.role === 'reasoning' && !hasReasoning)
    )
      result.push(message);
  }
  for (const message of captured) {
    if (!previousIds.has(message.id)) result.push(message);
  }
  if (
    result.length === previous.length &&
    result.every((message, index) => message === previous[index])
  )
    return previous;
  return Object.freeze(result);
}
