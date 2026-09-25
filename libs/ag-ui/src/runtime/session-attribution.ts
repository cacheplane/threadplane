import type { AGUIEvent } from '@ag-ui/client';
import type { Transcript } from './transcript';
/** The SDK verifier starts fresh for each request and may not see retained
 * history. Check only the entity selected by an incremental event. Authoritative
 * snapshots and opaque encryption follow their helpers' replacement policies. */
export function assertAttribution(
  previous: Transcript,
  event: AGUIEvent
): void {
  let selected: Transcript[number] | undefined;
  switch (event.type) {
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_CONTENT':
    case 'TEXT_MESSAGE_END':
    case 'REASONING_MESSAGE_START':
    case 'REASONING_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_END':
    case 'TOOL_CALL_RESULT':
      selected = previous.find((message) => message.id === event.messageId);
      break;
    case 'ACTIVITY_DELTA':
      selected = previous.find(
        (message) =>
          message.id === event.messageId && message.role === 'activity'
      );
      break;
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END': {
      const { toolCallId } = event;
      selected = previous.find(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls?.some((call) => call.id === toolCallId)
      );
      if (!selected && event.type === 'TOOL_CALL_START') {
        const { parentMessageId } = event;
        const id =
          typeof parentMessageId === 'string' ? parentMessageId : toolCallId;
        selected = previous.find((message) => message.id === id);
      }
      break;
    }
    default:
      return;
  }
  if (!selected) return; // Missing/incompatible targets belong to the helper.
  const tag = event.subagentRunId;
  const owner =
    typeof selected.subagentRunId === 'string'
      ? selected.subagentRunId
      : undefined;
  if (typeof tag === 'string' && tag !== owner)
    throw new TypeError('Retained target attribution conflicts with event');
}
