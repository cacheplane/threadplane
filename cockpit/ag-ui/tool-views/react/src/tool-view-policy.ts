import type { Session, TextTranscriptRow } from '@threadplane/ag-ui';

export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
type Transcript = NativeSnapshot['transcript'];
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: TextTranscriptRow;
  /** Borrowed immutable native history; the app never constructs request history. */
  readonly prefix: Transcript;
}
export interface WeatherReading {
  readonly location: string;
  readonly temperatureF: number;
  readonly conditions: string;
  readonly humidity: number;
  readonly windMph: number;
}
export interface WeatherToolView {
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string;
  readonly resultText?: string;
  readonly weather?: WeatherReading;
}
export interface WeatherMessageView {
  readonly id: string;
  readonly text?: TextTranscriptRow;
  readonly tools: readonly WeatherToolView[];
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
      Object.hasOwn(descriptor, 'value')
    )
  );
}
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function locationArguments(text: string) {
  const value = parsed(text);
  return record(value) &&
    Object.keys(value).length === 1 &&
    typeof value.location === 'string' &&
    value.location.trim()
    ? value.location
    : undefined;
}
function weatherReading(
  text: string,
  location: string | undefined
): WeatherReading | undefined {
  const value = parsed(text);
  if (
    !location ||
    !record(value) ||
    Object.keys(value).length !== 5 ||
    value.location !== location ||
    typeof value.conditions !== 'string' ||
    !value.conditions.trim() ||
    typeof value.temperatureF !== 'number' ||
    !Number.isFinite(value.temperatureF) ||
    typeof value.humidity !== 'number' ||
    !Number.isFinite(value.humidity) ||
    value.humidity < 0 ||
    value.humidity > 100 ||
    typeof value.windMph !== 'number' ||
    !Number.isFinite(value.windMph) ||
    value.windMph < 0
  )
    return;
  return Object.freeze({
    location,
    temperatureF: value.temperatureF,
    conditions: value.conditions,
    humidity: value.humidity,
    windMph: value.windMph,
  });
}
/** Semantic comparison of already-owned native data, including optional metadata. */
function sameData(
  left: unknown,
  right: unknown,
  valid: () => boolean,
  depth = 0
): boolean {
  if (!valid() || depth > 100) return false;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) =>
        sameData(value, right[index], valid, depth + 1)
      ) &&
      valid()
    );
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameData(left[key], right[key], valid, depth + 1)
    ) &&
    valid()
  );
}
function structuralTranscript(
  transcript: Transcript,
  valid: () => boolean
): boolean {
  const ids = new Set<string>(),
    calls = new Set<string>(),
    results = new Set<string>();
  for (const message of transcript) {
    if (!valid()) return false;
    const { id, role, content, subagentRunId } = message;
    if (
      typeof id !== 'string' ||
      !id ||
      ids.has(id) ||
      typeof subagentRunId === 'string' ||
      (role !== 'user' && role !== 'assistant' && role !== 'tool')
    )
      return false;
    ids.add(id);
    if (role === 'user' && (typeof content !== 'string' || !content))
      return false;
    if (role === 'assistant') {
      if (
        content !== undefined &&
        content !== null &&
        typeof content !== 'string'
      )
        return false;
      for (const call of message.toolCalls ?? []) {
        if (
          typeof call.id !== 'string' ||
          !call.id ||
          calls.has(call.id) ||
          call.type !== 'function' ||
          call.function.name !== 'weather_card' ||
          typeof call.function.arguments !== 'string'
        )
          return false;
        calls.add(call.id);
      }
    }
    if (role === 'tool') {
      if (
        typeof content !== 'string' ||
        !calls.has(message.toolCallId) ||
        results.has(message.toolCallId)
      )
        return false;
      results.add(message.toolCallId);
    }
  }
  return valid();
}
function read(snapshot: NativeSnapshot, valid: () => boolean) {
  if (!valid()) return;
  const { status, run, decision, subagents, transcript } = snapshot;
  if (
    !valid() ||
    decision ||
    subagents.length ||
    run?.legacyInterrupt ||
    !structuralTranscript(transcript, valid)
  )
    return;
  if (
    status === 'error' ||
    (run?.outcome !== undefined && run.outcome !== 'success') ||
    run?.terminal?.type === 'RUN_ERROR' ||
    run?.terminal?.type === 'CUSTOM' ||
    (run?.terminal?.type === 'RUN_FINISHED' && run.terminal.runId !== run.id)
  )
    return;
  if (
    run?.terminal?.type === 'RUN_FINISHED' &&
    run.terminal.outcome?.type === 'success' &&
    run.terminal.outcome.pendingToolCallIds?.length
  )
    return;
  return valid() ? { status, run, transcript } : undefined;
}
/** Incomplete current arguments and results remain observable, never executable. */
export function unsupportedSnapshot(
  snapshot: NativeSnapshot,
  valid: () => boolean = () => true
): boolean {
  return !read(snapshot, valid);
}
export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previousRunId: string | undefined,
  prefix: Transcript,
  valid: () => boolean = () => true
): OwnedTurn | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'running' ||
    !threadId ||
    !state.run?.id ||
    state.run.id === previousRunId ||
    state.run.outcome !== undefined ||
    state.transcript.length !== prefix.length + 1 ||
    !prefix.every((row, index) =>
      sameData(row, state.transcript[index], valid)
    ) ||
    !valid()
  )
    return;
  const message = state.transcript.at(-1)!;
  if (
    message.role !== 'user' ||
    typeof message.content !== 'string' ||
    !valid()
  )
    return;
  return Object.freeze({
    threadId,
    runId: state.run.id,
    prefix,
    human: Object.freeze({
      id: message.id,
      role: 'user',
      content: message.content,
    }),
  });
}
function settledTurn(messages: Transcript, valid: () => boolean): boolean {
  if (messages.length < 2 || messages[0].role !== 'user') return false;
  let index = 1;
  while (index < messages.length) {
    if (!valid()) return false;
    const owner = messages[index++];
    if (owner.role !== 'assistant') return false;
    const calls = owner.toolCalls ?? [];
    if (!calls.length)
      return (
        index === messages.length &&
        typeof owner.content === 'string' &&
        !!owner.content &&
        valid()
      );
    const pending = new Map(
      calls.map((call) => [call.id, locationArguments(call.function.arguments)])
    );
    if ([...pending.values()].some((location) => location === undefined))
      return false;
    while (index < messages.length && messages[index].role === 'tool') {
      const result = messages[index++];
      if (
        result.role !== 'tool' ||
        !pending.has(result.toolCallId) ||
        typeof result.content !== 'string' ||
        !weatherReading(result.content, pending.get(result.toolCallId))
      )
        return false;
      pending.delete(result.toolCallId);
    }
    if (pending.size || !valid()) return false;
  }
  return false;
}
export function confirmTranscript(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid: () => boolean = () => true
): Transcript | undefined {
  const state = read(snapshot, valid),
    terminal = state?.run?.terminal;
  if (
    !state ||
    state.status !== 'idle' ||
    state.run?.id !== turn.runId ||
    state.run.outcome !== 'success' ||
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.threadId !== turn.threadId ||
    terminal.runId !== turn.runId ||
    (terminal.outcome !== undefined && terminal.outcome.type !== 'success') ||
    !turn.prefix.every((row, index) =>
      sameData(row, state.transcript[index], valid)
    ) ||
    !sameData(state.transcript[turn.prefix.length], turn.human, valid) ||
    !settledTurn(state.transcript.slice(turn.prefix.length), valid) ||
    !valid()
  )
    return;
  return state.transcript;
}
/** Pure presentation; selected scalars never become command or completion authority. */
export function projectWeatherViews(
  transcript: Transcript,
  valid: () => boolean = () => true
): readonly WeatherMessageView[] {
  const views: WeatherMessageView[] = [];
  for (const message of transcript) {
    if (!valid()) return Object.freeze([]);
    if (
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.subagentRunId === 'string'
    )
      continue;
    const text =
      typeof message.content === 'string' && message.content
        ? Object.freeze({
            id: message.id,
            role: message.role,
            content: message.content,
          })
        : undefined;
    const tools: WeatherToolView[] = [];
    for (const call of message.role === 'assistant'
      ? message.toolCalls ?? []
      : []) {
      if (call.function.name !== 'weather_card') continue;
      const results = transcript.filter(
        (result) =>
          result.role === 'tool' &&
          result.toolCallId === call.id &&
          typeof result.subagentRunId !== 'string'
      );
      const resultText =
        results.length === 1 && typeof results[0].content === 'string'
          ? results[0].content
          : undefined;
      const weather =
        resultText === undefined
          ? undefined
          : weatherReading(
              resultText,
              locationArguments(call.function.arguments)
            );
      tools.push(
        Object.freeze({
          id: call.id,
          name: call.function.name,
          argumentsText: call.function.arguments,
          ...(resultText !== undefined && { resultText }),
          ...(weather && { weather }),
        })
      );
    }
    if (text || tools.length)
      views.push(
        Object.freeze({
          id: message.id,
          ...(text && { text }),
          tools: Object.freeze(tools),
        })
      );
  }
  return valid() ? Object.freeze(views) : Object.freeze([]);
}
