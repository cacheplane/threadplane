import {
  completeDelivery,
  projectAgentError,
  streamingDelivery,
  type AgentError,
  type AgentSnapshot,
  type Message,
  type PlainValue,
  type ToolCall,
} from '@threadplane/core';
import type {
  LangGraphInterrupt,
  LangGraphSnapshot,
  LangGraphValues,
} from './langgraph-snapshot';

// Only objects projected here are trusted. Object.isFrozen on external input is
// insufficient: its children may still be mutable. The weak set retains no data.
const owned = new WeakSet<object>();

function freeze<T extends object>(value: T): T {
  owned.add(value);
  return Object.freeze(value);
}

export function ownValue(
  value: PlainValue,
  ancestors = new Set<object>()
): PlainValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value !== 'object')
    throw new TypeError('Tool snapshots require plain data.');
  if (owned.has(value)) return value;
  // This is an ownership boundary, not argument/schema validation. Unsupported
  // SDK instances and cycles must be projected by the effect adapter explicitly.
  if (
    ancestors.has(value) ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Tool snapshots require acyclic plain data.');
  }
  ancestors.add(value);
  const result = Array.isArray(value)
    ? freeze(value.map((item) => ownValue(item, ancestors)))
    : freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            ownValue(item, ancestors),
          ])
        )
      );
  ancestors.delete(value);
  return result;
}

/** Full-state ingress can reuse equal owned branches while replacing changed
 * data. Both inputs pass the same ownership boundary before any reuse. */
export function ownValueWithSharing(
  value: PlainValue,
  previous?: PlainValue
): PlainValue {
  return shareOwnedValue(ownValue(value), ownValue(previous));
}

function shareOwnedValue(next: PlainValue, previous: PlainValue): PlainValue {
  if (Object.is(next, previous)) return previous;
  if (
    next === null ||
    previous === null ||
    typeof next !== 'object' ||
    typeof previous !== 'object' ||
    Array.isArray(next) !== Array.isArray(previous)
  )
    return next;
  const prior = previous as Record<string, PlainValue>;
  let equal =
    Object.keys(next).length === Object.keys(previous).length &&
    (!Array.isArray(next) ||
      next.length === (previous as readonly PlainValue[]).length);
  let shared = false;
  const child = (value: PlainValue, key: string) => {
    const exists = Object.hasOwn(previous, key);
    const projected = exists ? shareOwnedValue(value, prior[key]) : value;
    if (!exists || !Object.is(projected, prior[key])) equal = false;
    if (!Object.is(projected, value)) shared = true;
    return projected;
  };
  const result = Array.isArray(next)
    ? next.map((value, index) => child(value, String(index)))
    : Object.fromEntries(
        Object.entries(next).map(([key, value]) => [key, child(value, key)])
      );
  return equal ? previous : shared ? freeze(result) : next;
}

function equalValue(a: PlainValue, b: PlainValue): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equalValue(
          (a as Record<string, PlainValue>)[key],
          (b as Record<string, PlainValue>)[key]
        )
    )
  );
}

function sameError(
  a: AgentError | undefined,
  b: AgentError | undefined
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.kind === b.kind &&
      a.message === b.message &&
      a.status === b.status &&
      a.retryable === b.retryable &&
      a.recovery === b.recovery &&
      a.detail === b.detail)
  );
}

function ownError(error: AgentError): AgentError {
  if (owned.has(error)) return error;
  const projected = projectAgentError(error);
  owned.add(projected);
  return projected;
}

export function sameMessage(a: Message, b: Message): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.role === b.role &&
      a.content === b.content &&
      a.name === b.name &&
      a.toolCallId === b.toolCallId &&
      equalValue(a.toolCallIds, b.toolCallIds) &&
      a.delivery.generation === b.delivery.generation &&
      a.delivery.phase === b.delivery.phase &&
      (a.delivery.phase !== 'complete' ||
        (b.delivery.phase === 'complete' &&
          a.delivery.outcome === b.delivery.outcome)))
  );
}

export function ownMessage(message: Message): Message {
  if (owned.has(message)) return message;
  return freeze({
    id: message.id,
    role: message.role,
    content: message.content,
    delivery:
      message.delivery.phase === 'complete'
        ? completeDelivery(
            message.delivery.generation,
            message.delivery.outcome
          )
        : streamingDelivery(message.delivery.generation),
    name: message.name,
    toolCallId: message.toolCallId,
    toolCallIds:
      message.toolCallIds === undefined
        ? undefined
        : freeze([...message.toolCallIds]),
  });
}

export function sameToolCall(a: ToolCall, b: ToolCall): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.name === b.name &&
      a.status === b.status &&
      equalValue(a.args, b.args) &&
      (a.status !== 'complete' ||
        (b.status === 'complete' && equalValue(a.result, b.result))) &&
      (a.status !== 'error' || (b.status === 'error' && a.error === b.error)))
  );
}

export function ownToolCall(call: ToolCall): ToolCall {
  if (owned.has(call)) return call;
  const base = { id: call.id, name: call.name, args: ownValue(call.args) };
  if (call.status === 'complete')
    return freeze({
      ...base,
      status: call.status,
      result: ownValue(call.result),
    });
  if (call.status === 'error')
    return freeze({ ...base, status: call.status, error: call.error });
  return freeze({ ...base, status: call.status });
}

function ownArray<T>(
  values: readonly T[],
  previous: readonly T[] | undefined,
  project: (value: T) => T,
  equal: (a: T, b: T) => boolean
): readonly T[] {
  if (values === previous) return values;
  const alreadyOwned = owned.has(values);
  if (alreadyOwned && previous === undefined) return values;
  const next = values.map((value, index) => {
    // Ownership permits reuse, not a change notification. A distinct owned
    // array may still equal the current one (including queued publications).
    const projected = alreadyOwned ? value : project(value);
    return previous?.[index] !== undefined && equal(projected, previous[index])
      ? previous[index]
      : projected;
  });
  if (
    previous &&
    next.length === previous.length &&
    next.every((item, index) => item === previous[index])
  )
    return previous;
  return alreadyOwned && next.every((item, index) => item === values[index])
    ? values
    : freeze(next);
}

export function ownSnapshot(
  input: AgentSnapshot,
  previous?: AgentSnapshot
): AgentSnapshot {
  if (input === previous) return input;
  const messages = ownArray(
    input.messages,
    previous?.messages,
    ownMessage,
    sameMessage
  );
  const toolCalls = ownArray(
    input.toolCalls,
    previous?.toolCalls,
    ownToolCall,
    sameToolCall
  );
  const error = sameError(input.error, previous?.error)
    ? previous?.error
    : input.error && ownError(input.error);
  if (
    previous &&
    input.status === previous.status &&
    messages === previous.messages &&
    toolCalls === previous.toolCalls &&
    error === previous.error
  )
    return previous;
  return freeze({ status: input.status, messages, toolCalls, error });
}

/** One backend aggregate, composing the core fields and owned application data. */
export function ownLangGraphSnapshot(
  input: LangGraphSnapshot,
  previous?: LangGraphSnapshot
): LangGraphSnapshot {
  const core = ownSnapshot(input, previous);
  const values = ownValueWithSharing(input.values, previous?.values) as
    | LangGraphValues
    | undefined;
  const interrupts = ownValueWithSharing(
    input.interrupts,
    previous?.interrupts
  ) as readonly LangGraphInterrupt[];
  if (
    core === previous &&
    values === previous?.values &&
    interrupts === previous?.interrupts
  )
    return previous;
  return freeze({ ...core, values, interrupts });
}
