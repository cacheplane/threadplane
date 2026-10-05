import type { AgentSnapshot, Message, ToolCall } from '@threadplane/core';

export interface InterruptsState extends AgentSnapshot {
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
export interface Approval {
  readonly summary: string;
  readonly flight: Readonly<{
    flight_number: string;
    airline: string;
    from: string;
    to: string;
    depart_local: string;
    aircraft: string;
  }>;
}
export interface Authority {
  readonly threadId: string;
  readonly checkpoint: string;
  readonly signature: string;
  readonly batch: readonly unknown[];
  readonly messages: readonly Message[];
  readonly tools: readonly ToolCall[];
}
export interface PauseAuthority extends Authority {
  readonly approval: Approval;
}
/** Capture own data without evaluating backend-supplied accessors. */
function copy(value: unknown, parents = new Set<object>()): unknown {
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
      value: copy(descriptor.value, parents),
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
const key = (value: unknown) => JSON.stringify(copy(value));
export function messageKey(message: Message): string {
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

function validArgs(tool: ToolCall) {
  const args = tool.args;
  if (!record(args)) return false;
  switch (tool.name) {
    case 'book_flight':
    case 'lookup_flight':
      return text(args['flight_number']);
    case 'get_airport_info':
      return text(args['airport_code']);
    case 'find_routes':
      return (
        text(args['from_code']) &&
        text(args['to_code']) &&
        (args['date_offset_days'] === undefined ||
          Number.isInteger(args['date_offset_days']))
      );
    default:
      return false;
  }
}

function capture(
  state: InterruptsState,
  threadId: string,
  paused: boolean
): Authority | null {
  if (
    state.status !== 'idle' ||
    state.error ||
    state.subgraphs.length ||
    !state.history?.length
  )
    return null;
  const history = copy(state.history[0]) as NonNullable<
    InterruptsState['history']
  >[number];
  const checkpoint = history.checkpoint;
  if (
    !record(checkpoint) ||
    checkpoint['thread_id'] !== threadId ||
    checkpoint['checkpoint_ns'] !== '' ||
    !text(checkpoint['checkpoint_id']) ||
    !Array.isArray(history.next) ||
    key(history.next) !== key(paused ? ['tools'] : [])
  )
    return null;
  const messages = copy(state.messages) as readonly Message[];
  const tools = copy(state.toolCalls) as readonly ToolCall[];
  if (
    !messages.length ||
    messages[0].role !== 'user' ||
    new Set(messages.map((m) => m.id)).size !== messages.length ||
    new Set(tools.map((tool) => tool.id)).size !== tools.length
  )
    return null;
  const catalog = new Map(tools.map((tool) => [tool.id, tool]));
  if (
    tools.some(
      (tool) =>
        !text(tool.id) ||
        !validArgs(tool) ||
        (tool.status !== 'pending' && tool.status !== 'complete')
    )
  )
    return null;
  const calls = new Set<string>(),
    results = new Set<string>();
  let human = -1,
    pendingOwner = -1;
  for (const [index, message] of messages.entries()) {
    if (
      !text(message.id) ||
      typeof message.content !== 'string' ||
      message.delivery.phase !== 'complete' ||
      message.delivery.generation !== message.id
    )
      return null;
    const pending =
      message.role === 'assistant' &&
      message.toolCallIds?.some((id) => catalog.get(id)?.status === 'pending');
    if (message.delivery.outcome !== (paused && pending ? 'paused' : 'success'))
      return null;
    if (message.role === 'user') {
      human = index;
      if (message.toolCallId !== undefined || message.toolCallIds?.length)
        return null;
    } else if (message.role === 'assistant') {
      if (message.toolCallId !== undefined) return null;
      for (const id of message.toolCallIds ?? []) {
        if (!catalog.has(id) || calls.has(id)) return null;
        calls.add(id);
        if (catalog.get(id)?.status === 'pending') pendingOwner = index;
      }
    } else if (message.role === 'tool') {
      const id = message.toolCallId,
        tool = id ? catalog.get(id) : undefined;
      if (
        !id ||
        !tool ||
        !calls.has(id) ||
        results.has(id) ||
        tool.status !== 'complete' ||
        tool.name !== message.name ||
        key(tool.result) !== key(message.content) ||
        message.toolCallIds?.length
      )
        return null;
      results.add(id);
    } else return null;
  }
  if (
    calls.size !== tools.length ||
    tools.some((tool) => tool.status === 'complete' && !results.has(tool.id))
  )
    return null;
  const pending = tools.filter((tool) => tool.status === 'pending');
  if (
    paused
      ? pending.length !== 1 ||
        pending[0].name !== 'book_flight' ||
        pendingOwner <= human ||
        pendingOwner !== messages.length - 1
      : pending.length ||
        state.interrupts.length ||
        messages.at(-1)?.role !== 'assistant' ||
        !text(messages.at(-1)?.content)
  )
    return null;
  return Object.freeze({
    threadId,
    checkpoint: key(checkpoint),
    signature: key({ history, messages, tools, interrupts: state.interrupts }),
    batch: state.interrupts,
    messages,
    tools,
  });
}

export function capturePause(
  state: InterruptsState,
  threadId: string
): PauseAuthority | null {
  try {
    if (state.interrupts.length !== 1) return null;
    const interrupt = copy(state.interrupts[0]);
    if (
      !record(interrupt) ||
      !text(interrupt['id']) ||
      !record(interrupt['value'])
    )
      return null;
    const payload = interrupt['value'],
      flight = payload['flight'];
    if (
      payload['type'] !== 'approval_request' ||
      !text(payload['summary']) ||
      !record(flight) ||
      ![
        'flight_number',
        'airline',
        'from',
        'to',
        'depart_local',
        'aircraft',
      ].every((field) => text(flight[field]))
    )
      return null;
    const authority = capture(state, threadId, true);
    if (!authority) return null;
    const pending = authority.tools.find((tool) => tool.status === 'pending');
    if (
      !pending ||
      !record(pending.args) ||
      (pending.args['flight_number'] as string).trim().toUpperCase() !==
        flight['flight_number']
    )
      return null;
    const approval: Approval = Object.freeze({
      summary: payload['summary'],
      flight: Object.freeze({
        flight_number: flight['flight_number'] as string,
        airline: flight['airline'] as string,
        from: flight['from'] as string,
        to: flight['to'] as string,
        depart_local: flight['depart_local'] as string,
        aircraft: flight['aircraft'] as string,
      }),
    });
    return Object.freeze({ ...authority, approval });
  } catch {
    return null;
  }
}
export function captureTerminal(
  state: InterruptsState,
  threadId: string
): Authority | null {
  try {
    return capture(state, threadId, false);
  } catch {
    return null;
  }
}
export function sameObservedAuthority(
  captured: PauseAuthority,
  state: InterruptsState
): boolean {
  const current = capturePause(state, captured.threadId);
  return (
    !!current &&
    current.batch === captured.batch &&
    current.checkpoint === captured.checkpoint &&
    current.signature === captured.signature
  );
}
