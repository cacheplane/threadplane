import type { AgentSnapshot, Message, ToolCall } from '@threadplane/core';

export interface SubagentsState extends AgentSnapshot {
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly history:
    | readonly {
        readonly checkpoint: unknown;
        readonly next: readonly string[];
        readonly parent_checkpoint?: unknown;
        readonly created_at?: unknown;
      }[]
    | undefined;
}
export interface Authority {
  readonly threadId: string;
  readonly checkpoint: string;
  readonly signature: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolCall[];
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
const key = (value: unknown) => JSON.stringify(copyData(value));
export function messageKey(input: Message): string {
  const message = copyData(input) as Message;
  return key({
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    citations: message.citations,
    name: message.name,
    toolCallId: message.toolCallId,
    toolCallIds: message.toolCallIds,
  });
}
export function toolsKey(tools: readonly ToolCall[]): string {
  return key(tools);
}
export function validToolArgs(input: Pick<ToolCall, 'name' | 'args'>): boolean {
  try {
    const tool = copyData(input) as Pick<ToolCall, 'name' | 'args'>;
    const args = tool.args;
    if (!record(args)) return false;
    return (
      tool.name === 'task' &&
      Object.keys(args).length === 2 &&
      ['research', 'booking', 'itinerary'].includes(
        args['subagent_type'] as string
      ) &&
      text(args['task_description'])
    );
  } catch {
    return false;
  }
}
/** Only exact saved root evidence grants permission for a follow-up turn. */
export function captureTerminal(
  input: SubagentsState,
  threadId: string
): Authority | null {
  try {
    const state = copyData(input) as SubagentsState;
    if (
      state.status !== 'idle' ||
      state.error ||
      state.interrupts.length ||
      state.subgraphs.length ||
      !state.history?.length
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
    const messages = state.messages,
      tools = state.toolCalls;
    if (
      !messages.length ||
      messages[0].role !== 'user' ||
      new Set(messages.map((m) => m.id)).size !== messages.length ||
      new Set(tools.map((tool) => tool.id)).size !== tools.length ||
      tools.some(
        (tool) =>
          !text(tool.id) ||
          !validToolArgs(tool) ||
          tool.status !== 'complete' ||
          typeof tool.result !== 'string'
      )
    )
      return null;
    const catalog = new Map(tools.map((tool) => [tool.id, tool]));
    const calls = new Set<string>(),
      results = new Set<string>(),
      pending = new Set<string>();
    for (const message of messages) {
      if (
        !text(message.id) ||
        typeof message.content !== 'string' ||
        message.delivery.phase !== 'complete' ||
        message.delivery.outcome !== 'success' ||
        message.delivery.generation !== message.id
      )
        return null;
      if (message.role === 'user') {
        if (
          pending.size ||
          message.toolCallId !== undefined ||
          message.toolCallIds?.length
        )
          return null;
      } else if (message.role === 'assistant') {
        if (message.toolCallId !== undefined) return null;
        for (const id of message.toolCallIds ?? []) {
          if (!catalog.has(id) || calls.has(id)) return null;
          calls.add(id);
          pending.add(id);
        }
      } else if (message.role === 'tool') {
        const id = message.toolCallId,
          tool = id ? catalog.get(id) : undefined;
        if (
          !id ||
          !tool ||
          !pending.has(id) ||
          results.has(id) ||
          tool.status !== 'complete' ||
          tool.name !== message.name ||
          tool.result !== message.content ||
          message.toolCallIds?.length
        )
          return null;
        results.add(id);
        pending.delete(id);
      } else return null;
    }
    if (
      calls.size !== tools.length ||
      results.size !== tools.length ||
      pending.size ||
      messages.at(-1)?.role !== 'assistant' ||
      !text(messages.at(-1)?.content)
    )
      return null;
    return Object.freeze({
      threadId,
      checkpoint: key(checkpoint),
      signature: key({ history, messages, tools }),
      messages,
      tools,
    });
  } catch {
    return null;
  }
}
