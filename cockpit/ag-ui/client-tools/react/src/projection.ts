import {
  projectTextTranscript,
  type TextTranscriptRow,
} from '@threadplane/ag-ui';
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
