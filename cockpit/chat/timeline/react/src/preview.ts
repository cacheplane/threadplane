import type { Message } from '@threadplane/core';
import {
  checkpointSource,
  copyData,
  record,
  text,
  type ForkSource,
} from './checkpoints';
export interface Preview {
  readonly source: ForkSource;
  readonly messages: readonly Message[];
}
const emptyOptional = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.length === 0);
/** Known-checkpoint reads must prove the exact requested source before conversion. */
export function capturePreview(
  input: unknown,
  requested: ForkSource
): Preview | null {
  try {
    const state = copyData(input),
      request = copyData(requested);
    if (!record(state) || !record(request) || !text(request['thread_id']))
      return null;
    const source = checkpointSource(request, request['thread_id']);
    const actual = checkpointSource(state['checkpoint'], request['thread_id']);
    if (
      !source ||
      !actual ||
      JSON.stringify(source) !== JSON.stringify(actual) ||
      !Array.isArray(state['next']) ||
      state['next'].length ||
      !Array.isArray(state['tasks']) ||
      state['tasks'].length ||
      (state['error'] !== undefined && state['error'] !== null)
    )
      return null;
    for (const key of ['interrupts', 'subgraphs', 'tool_calls', 'toolCalls'])
      if (!emptyOptional(state[key])) return null;
    const values = state['values'];
    if (
      !record(values) ||
      !Array.isArray(values['messages']) ||
      !values['messages'].length ||
      values['messages'].length % 2
    )
      return null;
    if (values['error'] !== undefined && values['error'] !== null) return null;
    for (const key of [
      '__interrupt__',
      'interrupts',
      'subgraphs',
      'tool_calls',
      'toolCalls',
    ])
      if (!emptyOptional(values[key])) return null;
    const messages: Message[] = [],
      ids = new Set<string>();
    for (const [index, raw] of values['messages'].entries()) {
      if (
        !record(raw) ||
        !text(raw['id']) ||
        ids.has(raw['id']) ||
        raw['type'] !== (index % 2 ? 'ai' : 'human') ||
        typeof raw['content'] !== 'string'
      )
        return null;
      if (
        raw['tool_call_id'] !== undefined ||
        raw['toolCallId'] !== undefined ||
        raw['function_call'] !== undefined ||
        !emptyOptional(raw['toolCallIds']) ||
        !emptyOptional(raw['interrupts']) ||
        !emptyOptional(raw['subgraphs']) ||
        !emptyOptional(raw['tool_calls']) ||
        !emptyOptional(raw['invalid_tool_calls'])
      )
        return null;
      const extra = raw['additional_kwargs'];
      if (
        extra !== undefined &&
        (!record(extra) ||
          extra['function_call'] !== undefined ||
          !emptyOptional(extra['tool_calls']))
      )
        return null;
      ids.add(raw['id']);
      messages.push(
        Object.freeze({
          id: raw['id'],
          role: index % 2 ? 'assistant' : 'user',
          content: raw['content'],
          delivery: Object.freeze({
            generation: raw['id'],
            phase: 'complete',
            outcome: 'success',
          }),
        })
      );
    }
    return Object.freeze({ source, messages: Object.freeze(messages) });
  } catch {
    return null;
  }
}
