import { streamingDelivery } from '@threadplane/core';
import { ownMessage } from './ownership';
import type { MessageState } from './message-reducer';
import type { StreamProjection } from './stream-projection';
import type { StreamEvent } from './transport.types';

/** One physical run and its last observed boundary; IDs are opaque, not a log. */
export interface RunEvidence {
  readonly runId?: string;
  readonly unsafe?: boolean;
  readonly lastId?: string;
  readonly cursor?: string;
}

export function captureRun(
  previous: RunEvidence,
  value: { run_id: string; thread_id?: string },
  threadId: string
): RunEvidence {
  const runId = value.run_id;
  const thread = value.thread_id;
  if (
    previous.unsafe ||
    (thread !== undefined && thread !== threadId) ||
    typeof runId !== 'string' ||
    !/^[A-Za-z0-9._~-]+$/.test(runId) ||
    runId === '.' ||
    runId === '..' ||
    (previous.runId !== undefined && previous.runId !== runId)
  )
    return { unsafe: true };
  return { ...previous, runId };
}

export function advanceCursor(
  previous: RunEvidence,
  event: StreamEvent,
  requested?: string
): { evidence: RunEvidence; replay: boolean } {
  const data = event['data'];
  const meaningful =
    (data !== undefined && data !== null && data !== '') ||
    (event.messages?.length ?? 0) > 0 ||
    event['interrupt'] !== undefined ||
    event['interrupts'] !== undefined;
  if (!meaningful) return { evidence: previous, replay: false };
  const rawId = event.sseId;
  const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined;
  const replay = id !== undefined && id === requested;
  return {
    evidence: {
      ...previous,
      lastId: id ?? previous.lastId,
      cursor: !replay && id !== previous.lastId ? id : undefined,
    },
    replay,
  };
}

/** Reopen only this physical run's interrupted/error assistant deliveries.
 * Earlier successful steps keep their delivery and reducer canonical locks. */
export function rebaseRun(
  state: MessageState,
  projection: StreamProjection,
  generation: string
) {
  const affected = new Set(
    state.messages
      .filter(
        (message) =>
          message.role === 'assistant' &&
          message.delivery.generation === projection.generation &&
          message.delivery.phase === 'complete' &&
          (message.delivery.outcome === 'interrupted' ||
            message.delivery.outcome === 'error')
      )
      .map((message) => message.id)
  );
  const rebase = (message: MessageState['messages'][number]) =>
    affected.has(message.id)
      ? ownMessage({ ...message, delivery: streamingDelivery(generation) })
      : message;
  return {
    state: Object.freeze({
      ...state,
      messages: Object.freeze(state.messages.map(rebase)),
      canonical: Object.freeze(
        state.canonical.filter(
          (entry) =>
            !(
              affected.has(entry.id) &&
              entry.generation === projection.generation
            )
        )
      ),
      aliases: Object.freeze(
        state.aliases.filter(
          (entry) =>
            !(
              affected.has(entry.to) &&
              entry.generation === projection.generation
            )
        )
      ),
    }),
    projection: {
      ...projection,
      messageIdPrefix: projection.messageIdPrefix ?? projection.generation,
      generation,
      canonical: projection.canonical.map((entry) => ({
        ...entry,
        message: rebase(entry.message),
      })),
    },
  };
}
