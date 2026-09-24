import type { ThreadState } from '@langchain/langgraph-sdk';
import {
  completeDelivery,
  staticDelivery,
  type Message,
  type PlainValue,
  type ToolCall,
} from '@threadplane/core';
import type { MessageState } from './message-reducer';
import {
  ownMessage,
  ownToolCall,
  sameMessage,
  sameToolCall,
} from './ownership';
import { record, roleOf, textContent } from './wire-message';
import { projectHistoryInterrupts } from './interrupt-projection';
import type { LangGraphInterrupt } from './langgraph-snapshot';
import { observeInvocation, type ToolInvocation } from './tool-invocations';
import { projectCitations } from './citation-projection';

export interface HistoryProjectionOptions {
  /** Omit for broad wire observation. A supplied catalog exposes only its
   * pending calls: a persisted ToolMessage string is not an authored result. */
  readonly registeredTools?: ReadonlySet<string>;
  /** An aggregate caller supplies its already-owned candidate to avoid reading
   * transport-owned interrupt getters a second time. */
  readonly interrupts?: readonly LangGraphInterrupt[];
}

function sameEntries(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Read finalized identities independently of transcript/result filtering. */
export function observeHistoryInvocations(
  previous: readonly ToolInvocation[],
  messages: readonly unknown[]
) {
  if (!previous.length) return previous;
  return observeCapturedInvocations(
    previous,
    messages.map((value) => captureHistoryCalls(record(value), previous))
  );
}

function captureHistoryCalls(
  message: Record<string, unknown> | undefined,
  invocations: readonly ToolInvocation[]
) {
  if (
    !message ||
    roleOf(message) !== 'assistant' ||
    message['type'] === 'AIMessageChunk'
  )
    return undefined;
  const rawCalls = message['tool_calls'];
  if (!Array.isArray(rawCalls)) return undefined;
  const ids: string[] = [];
  const calls: {
    id: string;
    name: string;
    raw: Record<string, unknown>;
    owned?: ToolCall;
  }[] = [];
  for (const value of rawCalls) {
    const call = record(value);
    const id = call?.['id'];
    const name = call?.['name'];
    if (typeof id !== 'string') continue;
    ids.push(id);
    if (typeof name !== 'string' || !call) continue;
    // Bound arguments must be captured once for comparison and projection.
    // Unbound overwritten calls keep the observer's existing lazy ownership.
    const owned = invocations.some((entry) => entry.id === id)
      ? ownToolCall({
          id,
          name,
          args: call['args'] as PlainValue,
          status: 'pending',
        })
      : undefined;
    calls.push({ id, name, raw: call, owned });
  }
  return { ids, calls };
}

function observeCapturedInvocations(
  previous: readonly ToolInvocation[],
  captured: readonly ReturnType<typeof captureHistoryCalls>[]
) {
  let invocations = previous;
  for (const message of captured)
    for (const call of message?.calls ?? [])
      if (call.owned) invocations = observeInvocation(invocations, call.owned);
  return invocations;
}

/** Replace the transcript from the latest checkpoint, independently of any run.
 * Explicit duplicate message IDs use their last occurrence and last position.
 * ID-less messages use checkpoint indices, avoiding every explicit ID first;
 * their identity is stable on equal reads, not guaranteed across reorder.
 * Nothing executes here, and prior locally settled results are not evidence for
 * the types of newly loaded wire results. Streaming bookkeeping is discarded. */
export function projectHistory(
  previous: MessageState,
  history: readonly ThreadState[],
  options: HistoryProjectionOptions = {}
): MessageState {
  const interrupts =
    options.interrupts ?? projectHistoryInterrupts([], history);
  const latest = history[0];
  const values = record(latest?.values);
  const rawMessages: unknown[] = Array.isArray(values?.['messages'])
    ? values['messages']
    : [];
  const raw = rawMessages.map(record);
  const capturedCalls = previous.invocations.length
    ? raw.map((message) => captureHistoryCalls(message, previous.invocations))
    : undefined;
  // Inspect every finalized occurrence before duplicate-message/call overwrite,
  // catalog filtering, or a ToolMessage can hide a contradictory invocation.
  const invocations = capturedCalls
    ? observeCapturedInvocations(previous.invocations, capturedCalls)
    : previous.invocations;
  const explicitIds = new Map<string, number>();
  raw.forEach((message, index) => {
    if (typeof message?.['id'] === 'string')
      explicitIds.set(message['id'], index);
  });
  const reservedIds = new Set(explicitIds.keys());
  const previousMessages = new Map(
    previous.messages.map((message) => [message.id, message])
  );
  const previousTools = new Map(
    previous.toolCalls.map((tool) => [tool.id, tool])
  );
  const projectedMessages: Message[] = [];
  const calls = new Map<string, ToolCall>();

  raw.forEach((message, index) => {
    if (!message) return;
    const role = roleOf(message);
    if (!role) return;
    let id: string;
    if (typeof message['id'] === 'string') {
      id = message['id'];
      if (explicitIds.get(id) !== index) return;
    } else {
      const base = `history-message-${index}`;
      id = base;
      let suffix = 0;
      while (reservedIds.has(id)) id = `${base}-${++suffix}`;
      reservedIds.add(id);
    }
    const finalizedCalls = capturedCalls
      ? capturedCalls[index]
      : captureHistoryCalls(message, previous.invocations);
    projectedMessages.push({
      id,
      role,
      content: textContent(message['content']),
      citations: projectCitations(message),
      delivery: staticDelivery(id),
      ...(typeof message['name'] === 'string' ? { name: message['name'] } : {}),
      ...(typeof message['tool_call_id'] === 'string'
        ? { toolCallId: message['tool_call_id'] }
        : {}),
      ...(finalizedCalls
        ? {
            toolCallIds: finalizedCalls.ids,
          }
        : {}),
    });
    for (const call of finalizedCalls?.calls ?? [])
      calls.set(
        call.id,
        call.owned ?? {
          id: call.id,
          name: call.name,
          args: call.raw['args'] as PlainValue,
          status: 'pending',
        }
      );
  });

  if (interrupts.length > 0) {
    // A pause belongs to the current turn. Do not reach past its last user to
    // borrow an older assistant when the latest request has no response yet.
    for (let index = projectedMessages.length - 1; index >= 0; index -= 1) {
      const message = projectedMessages[index];
      if (message.role === 'user') break;
      if (message.role === 'assistant') {
        projectedMessages[index] = {
          ...message,
          delivery: completeDelivery(message.id, 'paused'),
        };
        break;
      }
    }
  }

  const results = new Map<string, string>();
  for (const message of projectedMessages)
    if (message.role === 'tool' && message.toolCallId !== undefined)
      results.set(message.toolCallId, message.content);
  const projectedTools: ToolCall[] = [];
  for (const call of calls.values()) {
    if (
      options.registeredTools &&
      (!options.registeredTools.has(call.name) || results.has(call.id))
    )
      continue;
    const projected: ToolCall = results.has(call.id)
      ? { ...call, status: 'complete', result: results.get(call.id) }
      : call;
    const prior = previousTools.get(call.id);
    projectedTools.push(
      ownToolCall(prior && sameToolCall(prior, projected) ? prior : projected)
    );
  }
  const ownedMessages = projectedMessages.map((message) => {
    const prior = previousMessages.get(message.id);
    return ownMessage(
      prior && sameMessage(prior, message) ? prior : message,
      prior
    );
  });
  const messages = sameEntries(ownedMessages, previous.messages)
    ? previous.messages
    : Object.freeze(ownedMessages);
  const toolCalls = sameEntries(projectedTools, previous.toolCalls)
    ? previous.toolCalls
    : Object.freeze(projectedTools);
  if (
    messages === previous.messages &&
    invocations === previous.invocations &&
    toolCalls === previous.toolCalls &&
    previous.canonical.length === 0 &&
    previous.aliases.length === 0
  )
    return previous;
  return Object.freeze({
    invocations,
    messages,
    toolCalls,
    canonical: previous.canonical.length
      ? Object.freeze([])
      : previous.canonical,
    aliases: previous.aliases.length ? Object.freeze([]) : previous.aliases,
  });
}
