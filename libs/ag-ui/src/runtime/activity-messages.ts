import {
  EventType,
  mergeMetadata,
  type Metadata,
  type ActivitySnapshotEvent,
  type ActivityDeltaEvent,
} from '@ag-ui/client';
import { copyData } from '../lib/internal/copy-data';
import { applyPatch, type JsonPatchOp } from '../lib/internal/apply-patch';
import type { Transcript } from './transcript';

export type ActivityMessageEvent = ActivitySnapshotEvent | ActivityDeltaEvent;

function messageIndex(previous: Transcript, id: string): number {
  let found = -1;
  for (let index = 0; index < previous.length; index++) {
    if (previous[index].id !== id) continue;
    if (found !== -1) throw new TypeError('Duplicate target message ID');
    found = index;
  }
  return found;
}

function publish(
  previous: Transcript,
  index: number,
  record: Transcript[number]
): Transcript {
  const next = [...previous];
  const owned = Object.freeze(record);
  if (index === -1) next.push(owned);
  else next[index] = owned;
  return Object.freeze(next);
}

function withMetadata(
  record: Transcript[number],
  incoming: Metadata | undefined
): Transcript[number] {
  return incoming === undefined
    ? record
    : {
        ...record,
        metadata: Object.freeze(mergeMetadata(record.metadata, incoming)),
      };
}

/** Observes activity data in an already owned transcript. The caller owns
 * full-history admission, routing and lifecycle; only selected IDs are checked.
 * Operational activity patch failures are nonterminal, unlike STATE_DELTA. */
export function applyActivityMessage(
  previous: Transcript,
  event: ActivityMessageEvent
): Transcript {
  const { type, messageId } = event;
  const index = messageIndex(previous, messageId);
  const current = index === -1 ? undefined : previous[index];
  if (type === EventType.ACTIVITY_SNAPSHOT) {
    const { replace } = event;
    if (current && replace === false) {
      if (current.role !== 'activity') return previous;
      const { metadata } = event;
      if (metadata === undefined) return previous;
      const captured = copyData(metadata, true) as Metadata;
      return publish(previous, index, withMetadata(current, captured));
    }
    const { activityType, content, metadata, subagentRunId } = event;
    const capturedContent = copyData(content, true) as typeof content;
    const capturedMetadata = copyData(metadata, true) as Metadata | undefined;
    const record =
      current?.role === 'activity'
        ? { ...current, activityType, content: capturedContent }
        : {
            id: messageId,
            role: 'activity' as const,
            activityType,
            content: capturedContent,
          };
    if (typeof subagentRunId === 'string') record.subagentRunId = subagentRunId;
    else delete record.subagentRunId;
    return publish(previous, index, withMetadata(record, capturedMetadata));
  }

  if (current?.role !== 'activity') return previous;
  const patch = copyData(event.patch, true) as readonly JsonPatchOp[];
  const metadata = copyData(event.metadata, true) as Metadata | undefined;
  let content: typeof current.content;
  try {
    content = applyPatch(current.content, patch);
  } catch {
    // Capture errors and final ownership errors are deliberately outside this
    // boundary. A failed operational batch may still carry valid metadata.
    if (metadata === undefined) return previous;
    return publish(previous, index, withMetadata(current, metadata));
  }
  const { activityType } = event;
  if (
    content === current.content &&
    activityType === current.activityType &&
    metadata === undefined
  )
    return previous;
  const capturedContent =
    content === current.content
      ? content
      : (copyData(content, true) as typeof current.content);
  return publish(
    previous,
    index,
    withMetadata(
      { ...current, content: capturedContent, activityType },
      metadata
    )
  );
}
