import type { Message } from '@ag-ui/client';
import { ownTranscript, type Transcript } from './transcript.js';

/** Applies a MESSAGES_SNAPSHOT with @ag-ui/client 1.0.1's role policy and the
 * snapshot's own order:
 * - Same-ID records take the snapshot record. Ordinary records the snapshot
 *   omits are dropped.
 * - Local activity/reasoning records survive only when the snapshot carries no
 *   message of that role. Each stays directly after the closest earlier record
 *   that is still present, or at the front when there is none.
 * - The result follows snapshot order.
 * Deliberate differences from the client: snapshot order instead of keeping
 * surviving IDs at their previous position and appending new ones (a backend
 * that renames IDs in its final snapshot otherwise leaves a tool result before
 * its call and reasoning before the wrong step, in display and in the next
 * request), reject duplicate IDs, always replace same-ID records, leave
 * null-attribution sanitation to request egress, and do not read the client's
 * `authoritativeActivityTypes` snapshot metadata. */
export function reconcileTranscript(
  previous: Transcript,
  snapshot: readonly Message[] | Transcript
): Transcript {
  const captured = ownTranscript(snapshot);
  const incoming = new Set<string>();
  let hasActivity = false;
  let hasReasoning = false;
  for (const message of captured) {
    if (incoming.has(message.id))
      throw new TypeError('Duplicate message IDs in snapshot');
    incoming.add(message.id);
    if (message.role === 'activity') hasActivity = true;
    if (message.role === 'reasoning') hasReasoning = true;
  }

  const previousIds = new Set<string>();
  const leading: Transcript[number][] = [];
  const kept = new Map<string, Transcript[number][]>();
  let anchor: Transcript[number][] = leading;
  for (const message of previous) {
    if (previousIds.has(message.id))
      throw new TypeError('Duplicate message IDs in previous transcript');
    previousIds.add(message.id);
    if (incoming.has(message.id)) {
      anchor = [];
      kept.set(message.id, anchor);
    } else if (
      (message.role === 'activity' && !hasActivity) ||
      (message.role === 'reasoning' && !hasReasoning)
    )
      anchor.push(message);
  }
  const result = [...leading];
  for (const message of captured) {
    result.push(message);
    const local = kept.get(message.id);
    if (local) result.push(...local);
  }
  if (
    result.length === previous.length &&
    result.every((message, index) => message === previous[index])
  )
    return previous;
  return Object.freeze(result);
}
