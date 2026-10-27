import type { Session, TextTranscriptRow } from '@threadplane/ag-ui';
import type { RenderSpecData } from '@threadplane/react/render';
import {
  dashboardState,
  dashboardText,
  plainRecord,
  type DashboardState,
} from './dashboard-data';
import { dashboardSpec } from './dashboard-spec';

export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: TextTranscriptRow;
  readonly prefix: NativeSnapshot['transcript'];
}
export interface DashboardProjection {
  readonly ownerId: string | null;
  readonly spec: RenderSpecData | null;
  readonly state: DashboardState;
}
type Transcript = NativeSnapshot['transcript'];
type Call = Extract<Transcript[number], { role: 'assistant' }>['toolCalls'];
const names = [
  'render_spec',
  'query_airline_kpis',
  'query_on_time_trend',
  'query_flights_by_airline',
  'query_recent_disruptions',
];
function parsed(text: string): unknown {
  try {
    return text.length <= 100_000 ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}
function same(
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
      left.every((item, index) => same(item, right[index], valid, depth + 1)) &&
      valid()
    );
  if (!plainRecord(left) || !plainRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        same(left[key], right[key], valid, depth + 1)
    ) &&
    valid()
  );
}
function structural(transcript: Transcript, valid: () => boolean) {
  const ids = new Set<string>(),
    calls = new Set<string>(),
    results = new Set<string>();
  for (const message of transcript) {
    if (
      !valid() ||
      typeof message.id !== 'string' ||
      !message.id ||
      ids.has(message.id) ||
      typeof message.subagentRunId === 'string' ||
      !['user', 'assistant', 'tool'].includes(message.role)
    )
      return false;
    ids.add(message.id);
    if (
      message.role === 'user' &&
      (typeof message.content !== 'string' || !message.content)
    )
      return false;
    if (message.role === 'assistant') {
      if (
        message.content !== undefined &&
        message.content !== null &&
        typeof message.content !== 'string'
      )
        return false;
      for (const call of message.toolCalls ?? []) {
        if (
          !call.id ||
          calls.has(call.id) ||
          call.type !== 'function' ||
          !names.includes(call.function.name) ||
          typeof call.function.arguments !== 'string'
        )
          return false;
        calls.add(call.id);
      }
    }
    if (message.role === 'tool') {
      if (
        typeof message.content !== 'string' ||
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
  const { status, run, transcript, decision, subagents } = snapshot;
  if (
    !valid() ||
    decision ||
    subagents.length ||
    run?.legacyInterrupt ||
    !structural(transcript, valid) ||
    status === 'error' ||
    (run?.outcome !== undefined && run.outcome !== 'success') ||
    run?.terminal?.type === 'RUN_ERROR' ||
    run?.terminal?.type === 'CUSTOM' ||
    (run?.terminal?.type === 'RUN_FINISHED' &&
      (run.terminal.runId !== run.id ||
        (run.terminal.outcome !== undefined &&
          (run.terminal.outcome.type !== 'success' ||
            run.terminal.outcome.pendingToolCallIds?.length))))
  )
    return;
  return valid() ? { status, run, transcript } : undefined;
}
export function unsupportedSnapshot(
  snapshot: NativeSnapshot,
  valid: () => boolean = () => true
): boolean {
  return !read(snapshot, valid);
}
export function captureTurn(
  snapshot: NativeSnapshot,
  thread: string,
  previous: string | undefined,
  prefix: Transcript,
  valid: () => boolean = () => true
): OwnedTurn | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'running' ||
    !thread ||
    !state.run?.id ||
    state.run.id === previous ||
    state.run.outcome !== undefined ||
    state.transcript.length !== prefix.length + 1 ||
    !prefix.every((row, index) => same(row, state.transcript[index], valid)) ||
    !valid()
  )
    return;
  const human = state.transcript.at(-1);
  if (human?.role !== 'user' || typeof human.content !== 'string' || !valid())
    return;
  return Object.freeze({
    threadId: thread,
    runId: state.run.id,
    prefix,
    human: Object.freeze({
      id: human.id,
      role: 'user',
      content: human.content,
    }),
  });
}
function argumentsFor(
  call: NonNullable<Call>[number]
): Record<string, unknown> | undefined {
  const args = parsed(call.function.arguments),
    name = call.function.name;
  if (!plainRecord(args)) return;
  if (name === 'render_spec') return dashboardSpec(args) ? args : undefined;
  const allowed =
    name === 'query_airline_kpis'
      ? []
      : name === 'query_on_time_trend'
      ? ['months']
      : name === 'query_flights_by_airline'
      ? ['airlines']
      : ['limit', 'type'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) return;
  for (const key of ['months', 'limit'])
    if (
      Object.hasOwn(args, key) &&
      (typeof args[key] !== 'number' ||
        !Number.isInteger(args[key]) ||
        args[key] < 1 ||
        args[key] > 100)
    )
      return;
  if (
    Object.hasOwn(args, 'airlines') &&
    args.airlines !== null &&
    (!Array.isArray(args.airlines) ||
      args.airlines.length > 100 ||
      !args.airlines.every(dashboardText))
  )
    return;
  if (
    Object.hasOwn(args, 'type') &&
    args.type !== null &&
    !dashboardText(args.type)
  )
    return;
  return args;
}
function validResult(
  owner: Extract<Transcript[number], { role: 'assistant' }>,
  call: NonNullable<Call>[number],
  args: Record<string, unknown>,
  text: string,
  valid: () => boolean
) {
  const name = call.function.name;
  if (name === 'render_spec') {
    if (text === 'rendered')
      return same(
        parsed(typeof owner.content === 'string' ? owner.content : ''),
        args,
        valid
      );
    return (
      typeof owner.content === 'string' &&
      owner.content.trim().length > 0 &&
      same(parsed(text), args, valid)
    );
  }
  const value = parsed(text);
  if (name === 'query_airline_kpis') {
    const keys = ['on_time', 'flights_today', 'avg_delay', 'load_factor'];
    return (
      plainRecord(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key) && value[key] !== null) &&
      dashboardState(value) !== undefined
    );
  }
  const key =
    name === 'query_on_time_trend'
      ? 'on_time_trend'
      : name === 'query_flights_by_airline'
      ? 'flights_by_airline'
      : 'recent_disruptions';
  if (!Array.isArray(value) || dashboardState({ [key]: value }) === undefined)
    return false;
  if (
    key === 'on_time_trend' &&
    typeof args.months === 'number' &&
    value.length > args.months
  )
    return false;
  const airlines = args.airlines;
  if (
    key === 'flights_by_airline' &&
    Array.isArray(airlines) &&
    airlines.length > 0 &&
    value.some((row) => !airlines.includes(row.airline))
  )
    return false;
  if (
    key === 'recent_disruptions' &&
    ((typeof args.limit === 'number' && value.length > args.limit) ||
      (typeof args.type === 'string' &&
        value.some((row) => row.type !== args.type)))
  )
    return false;
  return valid();
}
function settled(messages: Transcript, valid: () => boolean) {
  if (messages.length < 2 || messages[0].role !== 'user') return false;
  let index = 1;
  while (index < messages.length) {
    if (!valid()) return false;
    const owner = messages[index++];
    if (owner.role !== 'assistant') return false;
    const calls = owner.toolCalls ?? [];
    if (!calls.length) {
      if (index === messages.length)
        return (
          typeof owner.content === 'string' &&
          owner.content.length > 0 &&
          valid()
        );
      continue;
    }
    const pending = new Map(
      calls.map((call) => [call.id, { call, args: argumentsFor(call) }])
    );
    if ([...pending.values()].some((item) => !item.args)) return false;
    while (index < messages.length && messages[index].role === 'tool') {
      const result = messages[index++];
      if (result.role !== 'tool' || typeof result.content !== 'string')
        return false;
      const match = pending.get(result.toolCallId);
      if (
        !match?.args ||
        result.id !== result.toolCallId ||
        !validResult(owner, match.call, match.args, result.content, valid)
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
    !turn.prefix.every((row, index) =>
      same(row, state.transcript[index], valid)
    ) ||
    !same(state.transcript[turn.prefix.length], turn.human, valid) ||
    !settled(state.transcript.slice(turn.prefix.length), valid) ||
    !valid()
  )
    return;
  return state.transcript;
}
export function selectDashboard(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  previous?: DashboardProjection,
  valid: () => boolean = () => true
): DashboardProjection | undefined {
  const transcript = confirmTranscript(snapshot, turn, valid);
  if (!transcript || !valid()) return;
  const state = dashboardState(snapshot.state);
  if (!state || !valid()) return;
  let spec = previous?.spec ?? null,
    ownerId = previous?.ownerId ?? null;
  for (const owner of transcript.slice(turn.prefix.length)) {
    if (!valid()) return;
    if (owner.role !== 'assistant') continue;
    for (const call of owner.toolCalls ?? [])
      if (call.function.name === 'render_spec') {
        const selected = dashboardSpec(parsed(call.function.arguments));
        if (!selected || !valid()) return;
        spec = selected;
        ownerId = owner.id;
      }
  }
  return valid() ? Object.freeze({ spec, ownerId, state }) : undefined;
}
