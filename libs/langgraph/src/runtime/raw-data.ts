import type { ThreadState } from '@langchain/langgraph-sdk';
import type {
  AgentUsage,
  AgentUsageEntry,
  Message,
  PlainValue,
} from '@threadplane/core';
import type {
  LangGraphMessageMetadata,
  LangGraphToolProgress,
  LangGraphWireMessage,
} from './langgraph-snapshot.js';
import { ownValue } from './ownership.js';
import type { StreamEvent } from './transport.types.js';
import { record, roleOf } from './wire-message.js';

function own(value: unknown): PlainValue {
  try {
    return ownValue(value as PlainValue);
  } catch {
    // Data that is not plain is not published; nothing else depends on it.
    return undefined;
  }
}

const isChunk = (raw: Record<string, unknown>) =>
  typeof raw['type'] === 'string' && raw['type'].endsWith('Chunk');

function eventMessages(event: StreamEvent): unknown[] {
  if (Array.isArray(event.messages)) return event.messages;
  const data = record(event['data']);
  const holder =
    event.type.split('|')[0] === 'checkpoints'
      ? record(data?.['values'])
      : data;
  const messages = holder?.['messages'];
  return Array.isArray(messages) ? messages : [];
}

const isRoot = (event: StreamEvent) =>
  !event.type.includes('|') && !(event.namespace?.length ?? 0);

/** The newest wire record seen for each root message id. */
export type WireMessages = ReadonlyMap<string, LangGraphWireMessage>;

function keep(
  previous: WireMessages,
  messages: readonly unknown[]
): WireMessages {
  let next: Map<string, LangGraphWireMessage> | undefined;
  for (const value of messages) {
    const raw = record(value);
    const id = raw?.['id'];
    if (!raw || typeof id !== 'string') continue;
    const owned = record(own(raw)) as LangGraphWireMessage | undefined;
    if (!owned) continue;
    // A full message is final; a later chunk for it is a stale straggler.
    const known = (next ?? previous).get(id);
    if (known && !isChunk(known) && isChunk(owned)) continue;
    (next ??= new Map(previous)).set(id, owned);
  }
  return next ?? previous;
}

/** Records the root wire messages a stream event carries. */
export function observeWireMessages(
  previous: WireMessages,
  event: StreamEvent
): WireMessages {
  const base = event.type.split('|')[0];
  if (
    !isRoot(event) ||
    (base !== 'values' &&
      base !== 'checkpoints' &&
      base !== 'messages' &&
      !base.startsWith('messages/'))
  )
    return previous;
  return keep(previous, eventMessages(event));
}

/** Replaces the record with the newest saved checkpoint's messages. */
export function observeHistoryWireMessages(
  history: readonly ThreadState[]
): WireMessages {
  const messages = record(history[0]?.values)?.['messages'];
  return keep(new Map(), Array.isArray(messages) ? messages : []);
}

const wireType: Record<Message['role'], string> = {
  user: 'human',
  assistant: 'ai',
  system: 'system',
  tool: 'tool',
};

/**
 * The transcript as LangGraph sent it: for each published message, in order,
 * the newest wire record with its id. A message still streaming is its latest
 * chunk with `content` replaced by the text accumulated so far. A message the
 * session added itself, or one sent without an id, is given in wire shape from
 * what the transcript holds.
 */
export function projectWireMessages(
  messages: readonly Message[],
  wire: WireMessages
): readonly LangGraphWireMessage[] {
  return messages.map((message) => {
    const raw = wire.get(message.id);
    if (raw) return isChunk(raw) ? { ...raw, content: message.content } : raw;
    return {
      type: wireType[message.role],
      id: message.id,
      content: message.content,
      ...(message.name !== undefined ? { name: message.name } : {}),
      ...(message.toolCallId !== undefined
        ? { tool_call_id: message.toolCallId }
        : {}),
    };
  });
}

/** Records the stream metadata of each message an event carries, root or child. */
export function observeMessageMetadata(
  previous: Readonly<Record<string, LangGraphMessageMetadata>>,
  event: StreamEvent
): Readonly<Record<string, LangGraphMessageMetadata>> {
  const metadata = record(event.messageMetadata);
  if (!metadata || !Array.isArray(event.messages) || !event.messages.length)
    return previous;
  const streamMetadata = record(own(metadata)) as
    | Readonly<Record<string, PlainValue>>
    | undefined;
  if (!streamMetadata) return previous;
  const next = { ...previous };
  event.messages.forEach((message, index) => {
    const id = record(message)?.['id'];
    const messageId = String(id ?? index);
    next[messageId] = { messageId, streamMetadata };
  });
  return next;
}

/** Folds one `tools` stream event into the progress of the running tools. */
export function observeToolProgress(
  previous: ReadonlyMap<string, LangGraphToolProgress>,
  event: StreamEvent,
  redactErrors: boolean
): ReadonlyMap<string, LangGraphToolProgress> {
  if (event.type.split('|')[0] !== 'tools') return previous;
  const data = record(event['data']);
  const kind = data?.['event'];
  const name = data?.['name'];
  if (!data || typeof kind !== 'string' || typeof name !== 'string')
    return previous;
  const toolCallId =
    typeof data['toolCallId'] === 'string' ? data['toolCallId'] : undefined;
  const key = toolCallId ?? name;
  const base = { ...(toolCallId ? { toolCallId } : {}), name };
  const existing = previous.get(key);
  let entry: LangGraphToolProgress;
  switch (kind) {
    case 'on_tool_start':
      entry = { ...base, state: 'starting', input: own(data['input']) };
      break;
    case 'on_tool_event':
      entry = {
        ...base,
        ...existing,
        state: 'running',
        data: own(data['data']),
      };
      break;
    case 'on_tool_end':
      entry = {
        ...base,
        ...existing,
        state: 'completed',
        result: own(data['output']),
      };
      break;
    case 'on_tool_error':
      entry = {
        ...base,
        ...existing,
        state: 'error',
        error: redactErrors ? 'The tool call failed.' : own(data['error']),
      };
      break;
    default:
      return previous;
  }
  return new Map(previous).set(key, entry);
}

interface UsageRecord extends AgentUsageEntry {
  readonly final: boolean;
}
/** Token counts by assistant message id, for the messages of one command. */
export type UsageObservation = ReadonlyMap<string, UsageRecord>;

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;
const sum = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : a + b;

function readUsage(
  raw: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined
): AgentUsageEntry | undefined {
  const usage = record(raw['usage_metadata']);
  if (!usage) return undefined;
  const response = record(raw['response_metadata']);
  const input = record(usage['input_token_details']);
  const output = record(usage['output_token_details']);
  const entry = {
    provider:
      text(response?.['model_provider']) ?? text(metadata?.['ls_provider']),
    model:
      text(response?.['model_name']) ??
      text(response?.['model']) ??
      text(metadata?.['ls_model_name']),
    inputTokens: count(usage['input_tokens']),
    outputTokens: count(usage['output_tokens']),
    totalTokens: count(usage['total_tokens']),
    reasoningTokens: count(output?.['reasoning']),
    cachedInputTokens: count(input?.['cache_read']),
    cacheWriteInputTokens: count(input?.['cache_creation']),
  };
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined)
  );
}

const counts = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
] as const;

function add(a: AgentUsageEntry, b: AgentUsageEntry): AgentUsageEntry {
  const result: Record<string, unknown> = {
    ...(a.provider ?? b.provider ? { provider: a.provider ?? b.provider } : {}),
    ...(a.model ?? b.model ? { model: a.model ?? b.model } : {}),
  };
  for (const key of counts) {
    const value = sum(a[key], b[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Collects the token usage of the assistant messages one command produced.
 * A full message's `usage_metadata` is that message's total and replaces what
 * its chunks reported; chunk usage is summed until then. Messages that were
 * already in the transcript when the command began are not counted.
 */
export function observeUsage(
  previous: UsageObservation,
  event: StreamEvent,
  baselineIds: readonly string[]
): UsageObservation {
  if (!isRoot(event)) return previous;
  const metadata = record(event.messageMetadata);
  let next: Map<string, UsageRecord> | undefined;
  for (const value of eventMessages(event)) {
    const raw = record(value);
    const id = raw?.['id'];
    if (
      !raw ||
      typeof id !== 'string' ||
      roleOf(raw) !== 'assistant' ||
      baselineIds.includes(id)
    )
      continue;
    const usage = readUsage(raw, metadata);
    if (!usage) continue;
    const known = (next ?? previous).get(id);
    const final = !isChunk(raw);
    if (known?.final && !final) continue;
    (next ??= new Map(previous)).set(
      id,
      final || !known ? { ...usage, final } : { ...add(known, usage), final }
    );
  }
  return next ?? previous;
}

/** Usage for a settled command, one entry for each provider and model. */
export function projectUsage(
  observed: UsageObservation
): AgentUsage | undefined {
  const entries = new Map<string, AgentUsageEntry>();
  for (const { final: _final, ...usage } of observed.values()) {
    const key = JSON.stringify([usage.provider ?? null, usage.model ?? null]);
    const known = entries.get(key);
    entries.set(key, known ? add(known, usage) : usage);
  }
  return entries.size ? { entries: [...entries.values()] } : undefined;
}

/** A tool call of the raw transcript with the message that answered it. */
export interface LangGraphToolCallWithResult {
  readonly id: string;
  readonly call: {
    readonly id: string;
    readonly name: string;
    readonly args: PlainValue;
  };
  /** The tool message with this call's id; undefined while the call is pending. */
  readonly result: LangGraphWireMessage | undefined;
  /** The assistant message that made the call. */
  readonly aiMessage: LangGraphWireMessage;
  /** The call's position among that message's tool calls. */
  readonly index: number;
  readonly state: 'pending' | 'completed' | 'error';
}

/**
 * Every tool call in a raw transcript, such as `snapshot.langGraphMessages`,
 * paired with its tool message. A call is `error` when that message's
 * `status` is `'error'`.
 */
export function langGraphToolCalls(
  messages: readonly LangGraphWireMessage[]
): readonly LangGraphToolCallWithResult[] {
  const results = new Map<string, LangGraphWireMessage>();
  for (const message of messages) {
    const id = message['tool_call_id'];
    if (roleOf(message) === 'tool' && typeof id === 'string')
      results.set(id, message);
  }
  const calls: LangGraphToolCallWithResult[] = [];
  for (const aiMessage of messages) {
    const entries = aiMessage['tool_calls'];
    if (roleOf(aiMessage) !== 'assistant' || !Array.isArray(entries)) continue;
    entries.forEach((value, index) => {
      const call = record(value);
      const id = call?.['id'];
      const name = call?.['name'];
      if (!call || typeof id !== 'string' || typeof name !== 'string') return;
      const result = results.get(id);
      calls.push({
        id,
        call: { id, name, args: call['args'] as PlainValue },
        result,
        aiMessage,
        index,
        state: !result
          ? 'pending'
          : result['status'] === 'error'
          ? 'error'
          : 'completed',
      });
    });
  }
  return calls;
}

/** The tool calls one assistant message made, with their results. */
export function getToolCalls(
  aiMessage: LangGraphWireMessage,
  messages: readonly LangGraphWireMessage[]
): readonly LangGraphToolCallWithResult[] {
  const id = aiMessage['id'];
  return typeof id === 'string'
    ? langGraphToolCalls(messages).filter((call) => call.aiMessage['id'] === id)
    : [];
}
