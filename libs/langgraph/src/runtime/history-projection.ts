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
import { hasPause, record, roleOf, textContent } from './wire-message';

export interface HistoryProjectionOptions {
  /** Omit for broad wire observation. A supplied catalog exposes only its
   * pending calls: a persisted ToolMessage string is not an authored result. */
  readonly registeredTools?: ReadonlySet<string>;
}

function sameEntries(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
  const latest = history[0];
  const values = record(latest?.values);
  const rawMessages: unknown[] = Array.isArray(values?.['messages'])
    ? values['messages']
    : [];
  const raw = rawMessages.map(record);
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
    const finalizedCalls =
      role === 'assistant' &&
      message['type'] !== 'AIMessageChunk' &&
      Array.isArray(message['tool_calls']);
    const messageCalls = finalizedCalls
      ? (message['tool_calls'] as unknown[])
          .map(record)
          .filter((call): call is Record<string, unknown> => !!call)
      : [];
    projectedMessages.push({
      id,
      role,
      content: textContent(message['content']),
      delivery: staticDelivery(id),
      ...(typeof message['name'] === 'string' ? { name: message['name'] } : {}),
      ...(typeof message['tool_call_id'] === 'string'
        ? { toolCallId: message['tool_call_id'] }
        : {}),
      ...(finalizedCalls
        ? {
            toolCallIds: messageCalls.flatMap((call) =>
              typeof call['id'] === 'string' ? [call['id']] : []
            ),
          }
        : {}),
    });
    for (const call of messageCalls) {
      if (typeof call['id'] !== 'string' || typeof call['name'] !== 'string')
        continue;
      calls.set(call['id'], {
        id: call['id'],
        name: call['name'],
        args: call['args'] as PlainValue,
        status: 'pending',
      });
    }
  });

  if (
    hasPause(values) ||
    latest?.tasks?.some((task) => (task.interrupts?.length ?? 0) > 0)
  ) {
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
    return ownMessage(prior && sameMessage(prior, message) ? prior : message);
  });
  const messages = sameEntries(ownedMessages, previous.messages)
    ? previous.messages
    : Object.freeze(ownedMessages);
  const toolCalls = sameEntries(projectedTools, previous.toolCalls)
    ? previous.toolCalls
    : Object.freeze(projectedTools);
  if (
    messages === previous.messages &&
    toolCalls === previous.toolCalls &&
    previous.canonical.length === 0 &&
    previous.aliases.length === 0
  )
    return previous;
  return Object.freeze({
    messages,
    toolCalls,
    canonical: previous.canonical.length
      ? Object.freeze([])
      : previous.canonical,
    aliases: previous.aliases.length ? Object.freeze([]) : previous.aliases,
  });
}
