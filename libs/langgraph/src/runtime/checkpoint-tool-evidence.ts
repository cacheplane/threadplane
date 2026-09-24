import type { ThreadState } from '@langchain/langgraph-sdk';
import { initialMessageState, type MessageState } from './message-reducer';
import { sameToolInvocation } from './ownership';
import { projectStream, type StreamProjection } from './stream-projection';

/** Confirm execution eligibility against only the exact saved messages. Reuse
 * turn selection, but none of the stream's accumulated calls, completions,
 * canonical messages, or transient turn exclusions may become saved evidence.
 * This projection is never installed: authored results and monotone invocation
 * conflicts remain owned by the session's existing message state. */
export function assertCheckpointToolEvidence(
  saved: ThreadState,
  state: MessageState,
  projection: StreamProjection,
  resolvedTools: ReadonlySet<string>,
  locallySettledTools: ReadonlySet<string>
): void {
  const authoritative = projectStream(
    initialMessageState(),
    {
      generation: projection.generation,
      messageIdPrefix: projection.messageIdPrefix,
      userId: projection.userId,
      baselineIds: projection.baselineIds,
      sawAssistant: false,
      terminal: false,
      paused: false,
      canonical: [],
      ...(projection.resume
        ? { resume: { turnIds: projection.resume.turnIds } }
        : {}),
    },
    { type: 'values', data: saved.values }
  );
  const observedIds = new Set(projection.toolCallIds ?? []);
  const savedIds = new Set(authoritative.projection.toolCallIds ?? []);
  const observedCalls = new Map(state.toolCalls.map((call) => [call.id, call]));
  const savedCalls = new Map(
    authoritative.state.toolCalls.map((call) => [call.id, call])
  );
  const mismatch = () =>
    new Error('Saved checkpoint tool evidence does not match the owned run.');
  const invocations = new Map(state.invocations.map((call) => [call.id, call]));
  // A graph may transform or remove an already consumed local result or call.
  // Authenticate those echoes against this owner's settlement proof and the
  // monotone invocation ledger before excluding them from new effect admission.
  // The broader resolvedTools set also contains wire history and cannot do this.
  for (const id of new Set([...observedIds, ...savedIds])) {
    if (!locallySettledTools.has(id)) continue;
    const invocation = invocations.get(id);
    const observed = observedCalls.get(id);
    const persisted = savedCalls.get(id);
    if (
      !invocation ||
      invocation.conflicted ||
      (observedIds.has(id) && !observed) ||
      (savedIds.has(id) && !persisted) ||
      (observed && !sameToolInvocation(observed, invocation)) ||
      (persisted && !sameToolInvocation(persisted, invocation))
    )
      throw mismatch();
    observedIds.delete(id);
    savedIds.delete(id);
  }
  if (observedIds.size !== savedIds.size) throw mismatch();
  for (const id of observedIds) {
    const observed = observedCalls.get(id);
    const persisted = savedCalls.get(id);
    if (
      !savedIds.has(id) ||
      !observed ||
      !persisted ||
      !sameToolInvocation(observed, persisted)
    )
      throw mismatch();
    const observedResolved =
      resolvedTools.has(id) || observed.status !== 'pending';
    if (observedResolved !== (persisted.status !== 'pending')) throw mismatch();
  }
}
