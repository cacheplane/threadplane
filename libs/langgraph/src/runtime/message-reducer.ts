import {
  completeDelivery,
  type CompleteOutcome,
  type Message,
  type ToolCall,
} from '@threadplane/core';
import {
  ownMessage,
  ownToolCall,
  sameMessage,
  sameToolCall,
} from './ownership';
import {
  conflictInvocation,
  observeInvocation,
  type ToolInvocation,
} from './tool-invocations';

export interface MessageState {
  readonly invocations: readonly ToolInvocation[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly canonical: readonly {
    readonly id: string;
    readonly generation: string;
  }[];
  readonly aliases: readonly {
    readonly from: string;
    readonly to: string;
    readonly generation: string;
  }[];
}

/** snapshot is an interim cumulative value. canonical replaces text exactly,
 * including shorter/empty text, and bars later delta/snapshot text updates for
 * that message/generation. Snapshot metadata and delivery can still finalize.
 * Another explicitly ordered canonical event is an authoritative correction;
 * the effect owner must establish its ordering before dispatching it here. */
export type MessageEvent =
  | {
      readonly type: 'message';
      readonly mode: 'delta' | 'snapshot' | 'canonical';
      readonly message: Message;
      readonly existingId?: string;
    }
  | { readonly type: 'tool'; readonly toolCall: ToolCall }
  | { readonly type: 'tool-admitted'; readonly toolCall: ToolCall }
  | { readonly type: 'tool-conflict'; readonly id: string }
  | { readonly type: 'tool-unsettled'; readonly id: string }
  | { readonly type: 'remove-pending-tools'; readonly ids: readonly string[] }
  | {
      readonly type: 'complete';
      readonly generation: string;
      readonly outcome: CompleteOutcome;
    };

export function initialMessageState(): MessageState {
  return Object.freeze({
    invocations: Object.freeze([]),
    messages: Object.freeze([]),
    toolCalls: Object.freeze([]),
    canonical: Object.freeze([]),
    aliases: Object.freeze([]),
  });
}

/** Deterministic text/tool projection. The caller supplies IDs and generations;
 * no clock, SDK mutation or effect runs here. Cross-ID echoes require explicit
 * correlation: equal user text by itself is not evidence of a duplicate turn. */
export function reduceMessages(
  state: MessageState,
  event: MessageEvent
): MessageState {
  if (event.type === 'tool-conflict') {
    const invocations = conflictInvocation(state.invocations, event.id);
    return invocations === state.invocations
      ? state
      : Object.freeze({ ...state, invocations });
  }
  if (
    event.type === 'tool-admitted' ||
    (event.type === 'tool' && event.toolCall.status === 'pending')
  ) {
    const invocations = observeInvocation(
      state.invocations,
      event.toolCall,
      event.type === 'tool-admitted'
    );
    if (invocations !== state.invocations)
      state = Object.freeze({ ...state, invocations });
    if (event.type === 'tool-admitted') return state;
    // Contradictory finalized data cannot replace the execution-owned call.
    if (
      invocations.some(
        (entry) => entry.id === event.toolCall.id && entry.conflicted
      )
    )
      return state;
  }
  if (event.type === 'remove-pending-tools') {
    // Authoritative assistant corrections can retract unexecuted calls. Keep
    // running/settled facts and any call still owned by a distinct assistant.
    const toolCalls = state.toolCalls.filter(
      (call) =>
        call.status !== 'pending' ||
        !event.ids.includes(call.id) ||
        state.messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.toolCallIds?.includes(call.id)
        )
    );
    return toolCalls.length === state.toolCalls.length
      ? state
      : Object.freeze({ ...state, toolCalls: Object.freeze(toolCalls) });
  }
  if (event.type === 'tool-unsettled') {
    // Only an execution owner can withdraw a local running projection. This
    // does not reopen settled facts or change replayed arguments.
    const index = state.toolCalls.findIndex((call) => call.id === event.id);
    const call = state.toolCalls[index];
    if (call?.status !== 'running') return state;
    const toolCalls = [...state.toolCalls];
    toolCalls[index] = ownToolCall({ ...call, status: 'pending' });
    return Object.freeze({ ...state, toolCalls: Object.freeze(toolCalls) });
  }
  if (event.type === 'tool') {
    const index = state.toolCalls.findIndex(
      (call) => call.id === event.toolCall.id
    );
    // Replayed finalized arguments cannot reopen a locally settled/executing call.
    if (
      index >= 0 &&
      event.toolCall.status === 'pending' &&
      state.toolCalls[index].status !== 'pending'
    )
      return state;
    const incoming = ownToolCall(event.toolCall);
    if (index >= 0 && sameToolCall(state.toolCalls[index], incoming))
      return state;
    const toolCalls = [...state.toolCalls];
    if (index < 0) toolCalls.push(incoming);
    else toolCalls[index] = incoming;
    return Object.freeze({ ...state, toolCalls: Object.freeze(toolCalls) });
  }
  if (event.type === 'complete') {
    let changed = false;
    const messages = state.messages.map((message) => {
      if (
        message.delivery.generation !== event.generation ||
        message.delivery.phase === 'complete'
      )
        return message;
      changed = true;
      return ownMessage({
        ...message,
        delivery: completeDelivery(event.generation, event.outcome),
      });
    });
    return changed
      ? Object.freeze({ ...state, messages: Object.freeze(messages) })
      : state;
  }

  const incoming = event.message;
  const generation = incoming.delivery.generation;
  const alias = state.aliases.find(
    (entry) => entry.from === incoming.id && entry.generation === generation
  );
  const id = event.existingId ?? alias?.to ?? incoming.id;
  const index = state.messages.findIndex((message) => message.id === id);
  const previous = state.messages[index];
  const sameGeneration = previous?.delivery.generation === generation;
  const canonical = state.canonical.some(
    (entry) => entry.id === id && entry.generation === generation
  );
  if (
    sameGeneration &&
    event.mode === 'delta' &&
    (canonical || previous.delivery.phase === 'complete')
  )
    return state;

  let content = incoming.content;
  if (sameGeneration) {
    if (event.mode === 'delta') content = previous.content + incoming.content;
    else if (
      event.mode === 'snapshot' &&
      (canonical || previous.content.startsWith(incoming.content))
    )
      content = previous.content;
  }
  const candidate: Message = {
    ...incoming,
    id,
    content,
    // A late snapshot cannot reopen a finalized generation.
    delivery:
      sameGeneration && previous.delivery.phase === 'complete'
        ? previous.delivery
        : incoming.delivery,
    toolCallIds: incoming.toolCallIds ?? previous?.toolCallIds,
    toolCallId: incoming.toolCallId ?? previous?.toolCallId,
    name: incoming.name ?? previous?.name,
  };
  let messages = state.messages;
  if (!previous || !sameMessage(previous, candidate)) {
    const next = [...messages];
    if (index < 0) next.push(ownMessage(candidate));
    else next[index] = ownMessage(candidate);
    messages = Object.freeze(next);
  }
  const aliases =
    incoming.id !== id && !alias && previous
      ? Object.freeze([
          ...state.aliases,
          Object.freeze({ from: incoming.id, to: id, generation }),
        ])
      : state.aliases;
  const canonicalIds =
    event.mode === 'canonical' && !canonical
      ? Object.freeze([...state.canonical, Object.freeze({ id, generation })])
      : state.canonical;
  return messages === state.messages &&
    aliases === state.aliases &&
    canonicalIds === state.canonical
    ? state
    : Object.freeze({ ...state, messages, aliases, canonical: canonicalIds });
}
