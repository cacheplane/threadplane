import type { ReasoningEncryptedValueEvent } from '@ag-ui/client';
import type { Transcript } from './transcript';

type Assistant = Extract<Transcript[number], { role: 'assistant' }>;
type Calls = NonNullable<Assistant['toolCalls']>;

function messageIndex(previous: Transcript, id: string): number {
  let found = -1;
  for (let index = 0; index < previous.length; index++) {
    if (previous[index].id !== id) continue;
    if (found !== -1) throw new TypeError('Duplicate target message ID');
    found = index;
  }
  return found;
}

/** Observes opaque encrypted bytes without interpretation or routing authority.
 * Event metadata and attribution are intentionally not read or transferred. */
export function applyEncryptedValue(
  previous: Transcript,
  event: ReasoningEncryptedValueEvent
): Transcript {
  const { subtype, entityId, encryptedValue } = event;
  if (subtype === 'message') {
    const index = messageIndex(previous, entityId);
    if (index === -1) return previous;
    const current = previous[index];
    if (
      current.role === 'activity' ||
      current.encryptedValue === encryptedValue
    )
      return previous;
    const next = [...previous];
    next[index] = Object.freeze({ ...current, encryptedValue });
    return Object.freeze(next);
  }

  let selected:
    | { owner: Assistant; calls: Calls; ownerIndex: number; callIndex: number }
    | undefined;
  for (let ownerIndex = 0; ownerIndex < previous.length; ownerIndex++) {
    const owner = previous[ownerIndex];
    if (owner.role !== 'assistant') continue;
    const calls = owner.toolCalls ?? [];
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      if (calls[callIndex].id !== entityId) continue;
      if (selected) throw new TypeError('Duplicate target tool call ID');
      selected = { owner, calls, ownerIndex, callIndex };
    }
  }
  if (!selected) return previous;
  const { owner, calls, ownerIndex, callIndex } = selected;
  messageIndex(previous, owner.id);
  const call = calls[callIndex];
  if (call.encryptedValue === encryptedValue) return previous;
  const toolCalls = [...calls];
  toolCalls[callIndex] = Object.freeze({ ...call, encryptedValue });
  const next = [...previous];
  next[ownerIndex] = Object.freeze({
    ...owner,
    toolCalls: Object.freeze(toolCalls),
  });
  return Object.freeze(next);
}
