import {
  EventType,
  mergeMetadata,
  type Metadata,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
} from '@ag-ui/client';
import { copyData } from '../lib/internal/copy-data';
import type { Transcript } from './transcript';

export type ToolMessageEvent =
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent;

type Assistant = Extract<Transcript[number], { role: 'assistant' }>;
type Call = NonNullable<Assistant['toolCalls']>[number];

function messageIndex(previous: Transcript, id: string): number {
  let found = -1;
  for (let index = 0; index < previous.length; index++) {
    if (previous[index].id !== id) continue;
    if (found !== -1) throw new TypeError('Duplicate target message ID');
    found = index;
  }
  return found;
}

function selectedCall(previous: Transcript, id: string) {
  let selected:
    | { owner: Assistant; ownerIndex: number; call: Call; callIndex: number }
    | undefined;
  for (let ownerIndex = 0; ownerIndex < previous.length; ownerIndex++) {
    const owner = previous[ownerIndex];
    if (owner.role !== 'assistant') continue;
    const toolCalls = owner.toolCalls ?? [];
    for (let callIndex = 0; callIndex < toolCalls.length; callIndex++) {
      const call = toolCalls[callIndex];
      if (call.id !== id) continue;
      if (selected) throw new TypeError('Duplicate target tool call ID');
      selected = { owner, ownerIndex, call, callIndex };
    }
  }
  if (selected) messageIndex(previous, selected.owner.id);
  return selected;
}

function ownedMetadata(
  existing: Metadata | undefined,
  incoming: Metadata
): Metadata | undefined {
  const captured = copyData(incoming, true) as Metadata;
  return Object.freeze(mergeMetadata(existing, captured));
}

/** Observes normalized tool protocol data without interpreting or executing it.
 * The caller owns full-history admission, routing and lifecycle. Only selected
 * ambiguities are checked; unaffected owned records keep their identities. */
export function applyToolMessage(
  previous: Transcript,
  event: ToolMessageEvent
): Transcript {
  const { type, toolCallId, metadata } = event;
  const selected = selectedCall(previous, toolCallId);
  if (type === EventType.TOOL_CALL_RESULT) {
    const { messageId, content } = event;
    const index = messageIndex(previous, messageId);
    const current = index === -1 ? undefined : previous[index];
    if (
      current &&
      (current.role !== 'tool' || current.toolCallId !== toolCallId)
    )
      throw new TypeError('Tool result target is incompatible');
    if (current?.content === content && metadata === undefined) return previous;
    const subagentRunId = current ? undefined : event.subagentRunId;
    const record = current
      ? { ...current, content }
      : {
          id: messageId,
          role: 'tool' as const,
          toolCallId,
          content,
          ...(typeof subagentRunId === 'string' && { subagentRunId }),
        };
    const changed = Object.freeze(
      metadata === undefined
        ? record
        : {
            ...record,
            metadata: ownedMetadata(current?.metadata, metadata),
          }
    );
    const next = [...previous];
    if (index !== -1) next[index] = changed;
    else {
      let insertion = selected ? selected.ownerIndex + 1 : previous.length;
      while (insertion < previous.length && previous[insertion].role === 'tool')
        insertion++;
      next.splice(insertion, 0, changed);
    }
    return Object.freeze(next);
  }

  let owner: Assistant;
  let ownerIndex: number;
  let call: Call;
  let callIndex: number;
  if (type === EventType.TOOL_CALL_START) {
    const { toolCallName, parentMessageId } = event;
    if (selected) {
      if (
        selected.call.function.name !== toolCallName ||
        (typeof parentMessageId === 'string' &&
          parentMessageId !== selected.owner.id)
      )
        throw new TypeError('Tool call start conflicts with its owner or name');
      ({ owner, ownerIndex, call, callIndex } = selected);
      if (metadata === undefined) return previous;
    } else {
      const id =
        typeof parentMessageId === 'string' ? parentMessageId : toolCallId;
      ownerIndex = messageIndex(previous, id);
      const current = ownerIndex === -1 ? undefined : previous[ownerIndex];
      if (current && current.role !== 'assistant')
        throw new TypeError('Tool call parent role is incompatible');
      const subagentRunId = current ? undefined : event.subagentRunId;
      owner = current ?? {
        id,
        role: 'assistant',
        ...(typeof subagentRunId === 'string' && { subagentRunId }),
      };
      call = {
        id: toolCallId,
        type: 'function',
        function: Object.freeze({ name: toolCallName, arguments: '' }),
      };
      callIndex = owner.toolCalls?.length ?? 0;
    }
  } else {
    if (!selected) throw new TypeError('Tool call target is missing');
    ({ owner, ownerIndex, call, callIndex } = selected);
    if (type === EventType.TOOL_CALL_ARGS) {
      const { delta } = event;
      if (delta.length > 0)
        call = {
          ...call,
          function: Object.freeze({
            ...call.function,
            arguments: call.function.arguments + delta,
          }),
        };
    }
    if (call === selected.call && metadata === undefined) return previous;
  }
  const changed = Object.freeze(
    metadata === undefined
      ? call
      : {
          ...call,
          metadata: ownedMetadata(call.metadata, metadata),
        }
  );
  const toolCalls = [...(owner.toolCalls ?? [])];
  toolCalls[callIndex] = changed;
  const changedOwner = Object.freeze({
    ...owner,
    toolCalls: Object.freeze(toolCalls),
  });
  const next = [...previous];
  if (ownerIndex === -1) next.push(changedOwner);
  else next[ownerIndex] = changedOwner;
  return Object.freeze(next);
}
