import {
  projectTextTranscript,
  type TextTranscriptRow,
} from '@threadplane/ag-ui';
import type {
  AgentSnapshot,
  CompleteOutcome,
  Message,
  MessageDelivery,
  PlainValue,
  ToolCall,
} from '@threadplane/core';
import type { NativeSnapshot } from './application';
import { validateWeatherArguments, type WeatherArguments } from './tools';
type LocalCall = NativeSnapshot['clientTools']['calls'][number];
export interface ClientToolView {
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string;
  readonly resultText?: string;
  readonly sourceRunId?: string;
  readonly local?: LocalCall;
  readonly weather?: Readonly<WeatherArguments>;
}
export interface ClientToolMessageView {
  readonly id: string;
  readonly text?: TextTranscriptRow;
  readonly tools: readonly ClientToolView[];
}
/** Literal protocol rows plus separate matched local evidence. Never creates request history. */
export function projectClientToolViews(
  native: NativeSnapshot,
  valid: () => boolean = () => true
): readonly ClientToolMessageView[] {
  const rows: ClientToolMessageView[] = [];
  if (!valid()) return Object.freeze([]);
  const text = new Map(
    projectTextTranscript(native.transcript).map((row) => [row.id, row])
  );
  for (const message of native.transcript) {
    if (!valid()) return Object.freeze([]);
    if (message.role !== 'assistant' && message.role !== 'user') continue;
    const tools: ClientToolView[] = [];
    for (const call of message.role === 'assistant'
      ? message.toolCalls ?? []
      : []) {
      if (!valid()) return Object.freeze([]);
      const candidates =
        typeof message.subagentRunId === 'string'
          ? []
          : native.clientTools.calls.filter(
              (local) =>
                local.provenance === 'local' &&
                local.callId === call.id &&
                local.assistantMessageId === message.id &&
                local.name === call.function.name &&
                local.rawArguments === call.function.arguments
            );
      const blocked = native.clientTools.blocker?.callIds.includes(call.id);
      const local =
        candidates.length === 1 && !blocked ? candidates[0] : undefined;
      let weather: Readonly<WeatherArguments> | undefined;
      if (local?.status === 'complete') {
        try {
          if (local.name === 'get_weather') {
            const value = validateWeatherArguments(local.result);
            if (value.location === local.args?.location)
              weather = Object.freeze(value);
          } else if (
            (local.name === 'weather_card' ||
              local.name === 'weather_snapshot') &&
            local.result?.displayed === true
          ) {
            weather = Object.freeze(validateWeatherArguments(local.args));
          }
        } catch {
          /* Invalid business data remains literal native evidence. */
        }
      }
      const results = native.transcript.filter(
        (row) =>
          row.role === 'tool' &&
          row.toolCallId === call.id &&
          (typeof message.subagentRunId === 'string'
            ? row.subagentRunId === message.subagentRunId
            : typeof row.subagentRunId !== 'string')
      );
      const result = results.length === 1 ? results[0] : undefined;
      tools.push(
        Object.freeze({
          id: call.id,
          name: call.function.name,
          argumentsText: call.function.arguments,
          ...(result && typeof result.content === 'string'
            ? { resultText: result.content }
            : {}),
          ...(local ? { local, sourceRunId: local.sourceRunId } : {}),
          ...(weather ? { weather } : {}),
        })
      );
    }
    rows.push(
      Object.freeze({
        id: message.id,
        ...(text.has(message.id) ? { text: text.get(message.id) } : {}),
        tools: Object.freeze(tools),
      })
    );
  }
  return valid() ? Object.freeze(rows) : Object.freeze([]);
}

/** Parses literal call arguments or result text as plain data; text that is not JSON stays text. */
function plain(text: string): PlainValue {
  try {
    return JSON.parse(text) as PlainValue;
  } catch {
    return text;
  }
}
const NONE = Object.freeze([]) as readonly never[];
/**
 * The core view `Chat` observes: root user and assistant messages, each call
 * with its local execution status or recorded result, and the plan the graph
 * declared. Child messages stay out. The application stays the only owner of execution.
 */
export function projectAgentSnapshot(
  native: NativeSnapshot | undefined,
  busy: boolean,
  outcome: CompleteOutcome | null
): AgentSnapshot {
  const status = busy ? 'running' : 'idle';
  if (!native) return Object.freeze({ status, messages: NONE, toolCalls: NONE });
  const root = native.transcript.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') &&
      typeof (message as { subagentRunId?: unknown }).subagentRunId !== 'string'
  );
  // Results travel on their calls. A browser result enters the native transcript
  // before the continuation, so as a row it would end the turn that is still waiting.
  const conversation = root.filter((message) => message.role !== 'tool');
  const last = conversation.at(-1);
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  for (const message of conversation) {
    // The latest message of a stopped or failed command carries that outcome.
    const delivery: MessageDelivery =
      message === last && busy && message.role === 'assistant' && !message.toolCalls?.length
        ? { generation: native.run?.id ?? 'ag-ui', phase: 'streaming' }
        : {
            generation: native.run?.id ?? 'ag-ui',
            phase: 'complete',
            outcome: message === last && !busy && outcome ? outcome : 'success',
          };
    const content = typeof message.content === 'string' ? message.content : '';
    const calls = message.role === 'assistant' ? message.toolCalls ?? [] : [];
    messages.push(
      Object.freeze({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
        delivery,
        ...(calls.length ? { toolCallIds: Object.freeze(calls.map((call) => call.id)) } : {}),
      })
    );
    for (const call of calls) {
      const local = native.clientTools.calls.find(
        (entry) => entry.callId === call.id && entry.assistantMessageId === message.id
      );
      const result = root.find((entry) => entry.role === 'tool' && entry.toolCallId === call.id);
      const base = { id: call.id, name: call.function.name, args: plain(call.function.arguments) };
      toolCalls.push(
        Object.freeze(
          local?.status === 'error' || local?.status === 'cancelled'
            ? { ...base, status: 'error' as const, error: local.error ?? 'The browser tool was cancelled.' }
            : local?.status === 'complete'
            ? { ...base, status: 'complete' as const, result: (local.result ?? null) as PlainValue }
            : local?.status === 'running'
            ? { ...base, status: 'running' as const }
            : result && typeof result.content === 'string'
            ? { ...base, status: 'complete' as const, result: plain(result.content) }
            : { ...base, status: 'pending' as const }
        )
      );
    }
  }
  return Object.freeze({
    status,
    messages: Object.freeze(messages),
    toolCalls: Object.freeze(toolCalls),
    ...(native.plan ? { plan: native.plan } : {}),
  });
}
