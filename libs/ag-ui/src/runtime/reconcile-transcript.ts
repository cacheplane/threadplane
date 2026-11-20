import type { Message } from '@ag-ui/client';
import { namedApart, ownTranscript, type Transcript } from './transcript.js';

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
 * `authoritativeActivityTypes` snapshot metadata.
 * An activity record and a tool result may share an ID and are then two
 * records (see `namedApart`): neither replaces nor duplicates the other. */
export function reconcileTranscript(
  previous: Transcript,
  snapshot: readonly Message[] | Transcript
): Transcript {
  const captured = ownTranscript(snapshot);
  const incoming = new Map<string, Transcript[number][]>();
  /** The record of `among` that `message` is, when it is there. */
  const same = (
    among: readonly Transcript[number][] | undefined,
    message: Transcript[number]
  ) => among?.find((other) => !namedApart(other.role, message.role));
  let hasActivity = false;
  let hasReasoning = false;
  for (const message of captured) {
    const named = incoming.get(message.id);
    if (same(named, message))
      throw new TypeError('Duplicate message IDs in snapshot');
    if (named) named.push(message);
    else incoming.set(message.id, [message]);
    if (message.role === 'activity') hasActivity = true;
    if (message.role === 'reasoning') hasReasoning = true;
  }

  const previousIds = new Map<string, Transcript[number][]>();
  const leading: Transcript[number][] = [];
  const kept = new Map<Transcript[number], Transcript[number][]>();
  let anchor: Transcript[number][] = leading;
  for (const message of previous) {
    const named = previousIds.get(message.id);
    if (same(named, message))
      throw new TypeError('Duplicate message IDs in previous transcript');
    if (named) named.push(message);
    else previousIds.set(message.id, [message]);
    const replacement = same(incoming.get(message.id), message);
    if (replacement) {
      anchor = kept.get(replacement) ?? [];
      kept.set(replacement, anchor);
    } else if (
      (message.role === 'activity' && !hasActivity) ||
      (message.role === 'reasoning' && !hasReasoning)
    )
      anchor.push(message);
  }
  const result = [...leading];
  for (const message of captured) {
    result.push(message);
    const local = kept.get(message);
    if (local) result.push(...local);
  }
  if (
    result.length === previous.length &&
    result.every((message, index) => message === previous[index])
  )
    return previous;
  return Object.freeze(result);
}
