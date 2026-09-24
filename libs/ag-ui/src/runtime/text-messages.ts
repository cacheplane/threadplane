import {
  EventType,
  mergeMetadata,
  type TextMessageStartEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type ReasoningMessageStartEvent,
  type ReasoningMessageContentEvent,
  type ReasoningMessageEndEvent,
} from '@ag-ui/client';
import { ownTranscript, type Transcript } from './transcript';

export type TextMessageEvent =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ReasoningMessageStartEvent
  | ReasoningMessageContentEvent
  | ReasoningMessageEndEvent;

/** Applies one normalized message event to an already owned transcript.
 * The caller owns admission, full ID uniqueness and root/child routing.
 * Only the selected record is captured; unaffected owned records are shared. */
export function applyTextMessage(
  previous: Transcript,
  event: TextMessageEvent
): Transcript {
  const { type, messageId, metadata } = event;
  const start =
    type === EventType.TEXT_MESSAGE_START ||
    type === EventType.REASONING_MESSAGE_START;
  const reasoning =
    type === EventType.REASONING_MESSAGE_START ||
    type === EventType.REASONING_MESSAGE_CONTENT ||
    type === EventType.REASONING_MESSAGE_END;
  const role =
    type === EventType.TEXT_MESSAGE_START
      ? event.role ?? 'assistant'
      : 'reasoning';
  let index = -1;
  for (let position = 0; position < previous.length; position++) {
    if (previous[position].id !== messageId) continue;
    if (index !== -1) throw new TypeError('Duplicate target message ID');
    index = position;
  }
  const current = index === -1 ? undefined : previous[index];
  let record: Transcript[number];
  if (!current) {
    if (!start) throw new TypeError('Message target is missing');
    const subagentRunId = event.subagentRunId;
    const name = type === EventType.TEXT_MESSAGE_START ? event.name : undefined;
    record = {
      id: messageId,
      role,
      content: '',
      ...(name !== undefined && { name }),
      ...(typeof subagentRunId === 'string' && { subagentRunId }),
    };
  } else {
    if (
      current.role === 'tool' ||
      current.role === 'activity' ||
      (current.role === 'reasoning') !== reasoning ||
      (start && current.role !== role)
    )
      throw new TypeError('Message target role is incompatible');
    record = current;
    if (
      type === EventType.TEXT_MESSAGE_CONTENT ||
      type === EventType.REASONING_MESSAGE_CONTENT
    ) {
      const { delta } = event;
      const content = current.content;
      if (content !== undefined && typeof content !== 'string')
        throw new TypeError('Message target content must be a string');
      if (delta.length > 0)
        record = { ...current, content: (content ?? '') + delta };
    }
    if (record === current && metadata === undefined) return previous;
  }
  // Capture incoming metadata before SDK spreading could hide an unsupported
  // prototype. Ownership failures happen before any new value is published.
  const captured = ownTranscript([
    metadata === undefined ? record : { ...record, metadata },
  ])[0];
  const changed =
    metadata === undefined
      ? captured
      : Object.freeze({
          ...captured,
          metadata: Object.freeze(
            mergeMetadata(current?.metadata, captured.metadata)
          ),
        });
  const next = [...previous];
  if (index === -1) next.push(changed);
  else next[index] = changed;
  return Object.freeze(next);
}
