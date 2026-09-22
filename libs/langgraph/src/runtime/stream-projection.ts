import {
  completeDelivery,
  streamingDelivery,
  type AgentError,
  type Message,
  type PlainValue,
} from '@threadplane/core';
import {
  reduceMessages,
  type MessageEvent,
  type MessageState,
} from './message-reducer';
import type { StreamEvent } from './transport.types';
import { ownMessage, ownToolCall } from './ownership';
import { hasPause, record, roleOf, textContent } from './wire-message';

export { hasPause, record } from './wire-message';

type CanonicalMessage = Extract<MessageEvent, { type: 'message' }>;

export interface StreamProjection {
  readonly generation: string;
  readonly userId: string;
  readonly baselineIds: readonly string[];
  readonly currentAssistantId?: string;
  readonly sawAssistant: boolean;
  readonly terminal: boolean;
  readonly paused: boolean;
  readonly canonical: readonly CanonicalMessage[];
  readonly toolAssistantIds?: readonly string[];
  readonly toolCallIds?: readonly string[];
}

/** Pure projection of text and finalized tool data from root stream events.
 * Values are interim while the stream is open. EOF or a distinct next assistant
 * confirms a terminal candidate. Same-ID chunks invalidate only that message's
 * candidate, while any new assistant activity invalidates overall completion. */
export function projectStream(
  state: MessageState,
  projection: StreamProjection,
  event: StreamEvent
) {
  if ((event.namespace?.length ?? 0) > 0 || event.type.includes('|'))
    return { state, projection };
  const type = event.type;
  const data = record(event['data']);
  const values = type === 'checkpoints' ? record(data?.['values']) : data;
  const messages = event.messages ?? values?.['messages'];
  const messageEvent = type === 'messages' || type.startsWith('messages/');
  const terminal =
    type === 'values' || type === 'messages/complete' || type === 'checkpoints';
  if (type === 'interrupt' || type === 'interrupts' || hasPause(values)) {
    projection = { ...projection, paused: true };
  }
  if (!terminal && !messageEvent) return { state, projection };
  const mode = messageEvent && event.messageMetadata ? 'delta' : 'snapshot';
  const incoming = Array.isArray(messages)
    ? messages.map(record).filter((m): m is Record<string, unknown> => !!m)
    : [];
  const candidates: CanonicalMessage[] = [];
  const removedToolIds: string[] = [];
  const anchor = incoming.findIndex(
    (message) => message['id'] === projection.userId
  );
  const nextUser = incoming.findIndex(
    (message, index) => index > anchor && roleOf(message) === 'user'
  );
  for (const raw of incoming) {
    const role = roleOf(raw);
    if (!role) continue;
    const wireId =
      typeof raw['id'] === 'string'
        ? raw['id']
        : `${projection.generation}-${role}`;
    // A shared turn/text does not establish message identity. This protocol
    // slice preserves wire IDs; cross-ID correlation needs explicit evidence.
    const id = wireId;
    const previous = state.messages.find((m) => m.id === id);
    const baseline = projection.baselineIds.includes(id);
    const calls = Array.isArray(raw['tool_calls'])
      ? raw['tool_calls']
          .map(record)
          .filter((c): c is Record<string, unknown> => !!c)
      : [];
    const finalizedCalls =
      terminal &&
      role === 'assistant' &&
      raw['type'] !== 'AIMessageChunk' &&
      Array.isArray(raw['tool_calls']);
    const callIds = calls.flatMap((call) =>
      typeof call['id'] === 'string' ? [call['id']] : []
    );
    if (finalizedCalls)
      removedToolIds.push(
        ...(previous?.toolCallIds ?? []).filter(
          (callId) => !callIds.includes(callId)
        )
      );
    const message: Message = {
      id: wireId,
      role,
      content: textContent(raw['content']),
      delivery:
        baseline && previous
          ? previous.delivery
          : role === 'assistant'
          ? streamingDelivery(projection.generation)
          : completeDelivery(projection.generation, 'success'),
      ...(typeof raw['name'] === 'string' ? { name: raw['name'] } : {}),
      ...(typeof raw['tool_call_id'] === 'string'
        ? { toolCallId: raw['tool_call_id'] }
        : {}),
      ...(finalizedCalls ? { toolCallIds: callIds } : {}),
    };
    if (
      role === 'assistant' &&
      !baseline &&
      (!previous || id === projection.currentAssistantId)
    ) {
      if (
        projection.currentAssistantId &&
        projection.currentAssistantId !== id
      ) {
        // A terminal batch can introduce several steps at once. Its already
        // projected candidates take precedence over candidates from prior events.
        const completedStep =
          (terminal
            ? candidates.find(
                (candidate) =>
                  candidate.message.id === projection.currentAssistantId
              )
            : undefined) ??
          projection.canonical.find(
            (candidate) =>
              candidate.message.id === projection.currentAssistantId
          );
        if (completedStep)
          state = reduceMessages(state, {
            ...completedStep,
            message: {
              ...completedStep.message,
              delivery: completeDelivery(projection.generation, 'success'),
            },
          });
      }
      projection = {
        ...projection,
        currentAssistantId: id,
        sawAssistant: true,
        ...(!terminal
          ? {
              terminal: false,
              canonical: projection.canonical.filter(
                (candidate) => candidate.message.id !== id
              ),
            }
          : {}),
      };
    }
    state = reduceMessages(state, {
      type: 'message',
      mode,
      message,
    });
    candidates.push({
      type: 'message',
      mode: 'canonical',
      message: ownMessage(message),
    });
    // Only full messages from terminal state carry finalized arguments here.
    // AIMessageChunk/tool_call_chunks remain private until that final state.
    if (finalizedCalls) {
      for (const call of calls) {
        if (typeof call['id'] !== 'string' || typeof call['name'] !== 'string')
          continue;
        // Final tool arguments belong to this call, independently of a later
        // text step. Execution belongs to successful command closure, never
        // projection; finalized primitive strings are already authored data.
        state = reduceMessages(state, {
          type: 'tool',
          toolCall: ownToolCall({
            id: call['id'],
            name: call['name'],
            args: call['args'] as PlainValue,
            status: 'pending',
          }),
        });
      }
      const position = incoming.indexOf(raw);
      if (
        !baseline &&
        (anchor < 0 || position > anchor) &&
        (nextUser < 0 || position < nextUser)
      )
        projection = {
          ...projection,
          toolAssistantIds: [
            ...new Set([...(projection.toolAssistantIds ?? []), id]),
          ],
        };
    }
  }
  // A ToolMessage is conclusive execution evidence, even when it precedes its
  // matching AI message in a batch. Its string content remains wire text.
  for (const message of state.messages) {
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const call = state.toolCalls.find(
      (entry) => entry.id === message.toolCallId
    );
    if (call?.status === 'pending')
      state = reduceMessages(state, {
        type: 'tool',
        toolCall: { ...call, status: 'complete', result: message.content },
      });
  }
  // Settle wire evidence before pruning so ToolMessages later in this same
  // batch remain conclusive. Only obsolete pending calls lose their projection.
  state = reduceMessages(state, {
    type: 'remove-pending-tools',
    ids: removedToolIds,
  });
  if (projection.toolAssistantIds)
    projection = {
      ...projection,
      toolCallIds: [
        ...new Set(
          state.messages.flatMap((message) =>
            message.role === 'assistant' &&
            projection.toolAssistantIds?.includes(message.id)
              ? message.toolCallIds ?? []
              : []
          )
        ),
      ],
    };
  if (terminal) {
    const payload = event['data'] != null || (event.messages?.length ?? 0) > 0;
    projection = {
      ...projection,
      terminal: projection.sawAssistant || payload,
      canonical: [
        ...projection.canonical.filter(
          (previous) =>
            !candidates.some(
              (candidate) => candidate.message.id === previous.message.id
            )
        ),
        ...candidates,
      ],
    };
  }
  return { state, projection };
}

export function finalizeProjection(
  state: MessageState,
  projection: StreamProjection
) {
  for (const event of projection.canonical)
    state = reduceMessages(state, event);
  return state;
}

export function interruptionError(canCheck: boolean): AgentError {
  return {
    kind: 'interrupted',
    retryable: false,
    recovery: canCheck ? 'check' : 'none',
    message: canCheck
      ? 'The connection dropped. The request may still have completed on the server.'
      : 'The connection dropped. We could not confirm whether the request completed.',
    detail: canCheck
      ? 'Checking will tell you whether it did.'
      : 'Trying again could repeat it.',
  };
}

/** Bounded staging duplication of the legacy display vocabulary. This neutral
 * slice never copies causes and never infers undispatched work from first-byte
 * absence. Protected SDK errors (including raw SSE error payloads) stay generic. */
export function failureProjection(
  raw: unknown,
  protectedTransport: boolean,
  explicit: boolean,
  canCheck: boolean
): AgentError {
  if (protectedTransport)
    return {
      kind: 'server',
      message: 'The LangGraph request failed.',
      retryable: false,
      recovery: canCheck ? 'check' : 'none',
    };
  const object = record(raw);
  const status =
    typeof object?.['status'] === 'number' ? object['status'] : undefined;
  if (status === 401 || status === 403)
    return {
      kind: 'auth',
      message: 'Authentication failed. Check your credentials.',
      status,
      retryable: false,
      recovery: 'none',
    };
  if (explicit || raw instanceof SyntaxError || status !== undefined) {
    return {
      kind: 'server',
      message:
        typeof object?.['message'] === 'string'
          ? object['message']
          : 'The LangGraph request failed.',
      status,
      retryable: false,
      recovery: canCheck ? 'check' : 'none',
    };
  }
  return interruptionError(canCheck);
}
