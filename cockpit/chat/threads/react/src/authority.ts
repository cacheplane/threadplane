import type { AgentSnapshot, Message } from '@threadplane/core';
export interface ThreadsState extends AgentSnapshot {
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly history:
    | readonly {
        readonly checkpoint: unknown;
        readonly next: readonly string[];
      }[]
    | undefined;
}
export interface Canonical {
  readonly threadId: string;
  readonly checkpoint: string;
  readonly signature: string;
  readonly messages: readonly Message[];
}
/** Capture own data without evaluating backend-supplied accessors. */
export function copyData(value: unknown, parents = new Set<object>()): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object' ||
    parents.has(value) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new Error('Unsupported data');
  const array = Array.isArray(value),
    prototype = Object.getPrototypeOf(value);
  if (array && prototype !== Array.prototype)
    throw new Error('Unsupported data');
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new Error('Unsupported data');
  parents.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> | unknown[] = array
    ? []
    : Object.create(null);
  const keys = array
    ? Array.from({ length: value.length }, (_, index) => String(index))
    : Object.keys(descriptors).sort();
  if (
    array &&
    Object.keys(descriptors).some(
      (name) => name !== 'length' && !keys.includes(name)
    )
  )
    throw new Error('Unsupported data');
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor))
      throw new Error('Unsupported data');
    Object.defineProperty(result, key, {
      value: copyData(descriptor.value, parents),
      enumerable: true,
    });
  }
  parents.delete(value);
  return Object.freeze(result);
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
/** Compare execution identity independently of optional display metadata. */
export function messageKey(input: Message): string {
  const message = copyData(input) as Message;
  return JSON.stringify({
    id: message.id,
    role: message.role,
    content: message.content,
  });
}
/** Capture exact saved root evidence; load fulfillment alone grants no authority. */
export function captureTerminal(
  input: ThreadsState,
  threadId: string
): Canonical | null {
  try {
    const state = copyData(input) as ThreadsState;
    if (
      !text(threadId) ||
      state.status !== 'idle' ||
      state.error ||
      !Array.isArray(state.interrupts) ||
      state.interrupts.length ||
      !Array.isArray(state.subgraphs) ||
      state.subgraphs.length ||
      !Array.isArray(state.toolCalls) ||
      state.toolCalls.length ||
      !Array.isArray(state.history) ||
      !state.history.length ||
      !Array.isArray(state.messages) ||
      !state.messages.length ||
      state.messages.length % 2
    )
      return null;
    const history = state.history[0],
      checkpoint = history.checkpoint;
    if (
      !record(checkpoint) ||
      checkpoint['thread_id'] !== threadId ||
      checkpoint['checkpoint_ns'] !== '' ||
      !text(checkpoint['checkpoint_id']) ||
      !Array.isArray(history.next) ||
      history.next.length
    )
      return null;
    const messages = state.messages;
    if (new Set(messages.map((m) => m.id)).size !== messages.length)
      return null;
    for (const [index, message] of messages.entries()) {
      if (
        !text(message.id) ||
        !text(message.content) ||
        message.role !== (index % 2 ? 'assistant' : 'user') ||
        message.toolCallId !== undefined ||
        (message.toolCallIds !== undefined &&
          (!Array.isArray(message.toolCallIds) ||
            message.toolCallIds.length)) ||
        message.delivery.phase !== 'complete' ||
        message.delivery.outcome !== 'success' ||
        message.delivery.generation !== message.id
      )
        return null;
    }
    const checkpointKey = JSON.stringify(checkpoint);
    return Object.freeze({
      threadId,
      checkpoint: checkpointKey,
      signature: JSON.stringify({
        checkpoint: checkpointKey,
        messages: messages.map(messageKey),
      }),
      messages,
    });
  } catch {
    return null;
  }
}
