import type { Message, ToolCall } from '@threadplane/core';
import {
  copyJson,
  plainRecord,
  planState,
  sameJson,
  type PlanState,
} from './plan-state';
import { writeEvidence } from './tool-evidence';

export interface Baseline {
  readonly messages: readonly unknown[];
  readonly plan: Exclude<PlanState, { readonly kind: 'invalid' }>;
}
export interface TurnIdentity {
  readonly owner: string;
  /** Local application attempt identity, never a backend run id. */
  readonly generation: string;
  readonly threadId: string;
  readonly humanId: string;
  readonly humanContent: string;
  readonly backendRunId?: string;
}
export interface Turn extends TurnIdentity {
  readonly baseline: Baseline;
}
export interface Checkpoint {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
export interface PlanningSnapshot {
  readonly status: string;
  readonly error?: unknown;
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly values?: unknown;
  readonly history?: readonly unknown[];
}
export interface TerminalInput {
  readonly turn: Turn | undefined;
  readonly owner: string;
  readonly generation: string;
  readonly threadId: string;
  readonly backendRunId?: string;
  /** Only true for the native submit result outcome === 'success'. A resolved
   * promise alone also covers failed, paused and cancelled outcomes. */
  readonly submittedSuccessfully: boolean;
  /** Root checkpoint identity and values actually observed for this attempt. */
  readonly observedCheckpoint: unknown;
  readonly observedValues: unknown;
  /** Result of loading that exact root checkpoint, never a current-state guess. */
  readonly loadedCheckpoint: unknown;
  readonly snapshot: PlanningSnapshot;
}
export type Confirmation =
  | { readonly kind: 'unconfirmed' }
  | {
      readonly kind: 'confirmed';
      readonly update: 'replacement' | 'retained';
      readonly plan: Baseline['plan'];
      readonly checkpoint: Checkpoint;
      readonly values: Readonly<Record<string, unknown>>;
    };

/** Capture the exact current pre-send canonical prefix. Undefined is the inert
 * first turn. Default plan authority is safe only for initial/already-confirmed
 * values. After an unconfirmed attempt, supply the separately retained saved
 * plan: current canonical messages may advance without advancing authority.
 * Current malformed todos do not prevent a later successful replacement. */
export function captureBaseline(
  input: unknown,
  retainedSavedPlan?: Baseline['plan']
): Baseline | undefined {
  try {
    const values = copyJson(input === undefined ? { messages: [] } : input);
    if (!plainRecord(values) || !Array.isArray(values.messages))
      return undefined;
    const plan =
      retainedSavedPlan === undefined
        ? planState(values)
        : savedPlanSource(retainedSavedPlan);
    if (!plan || plan.kind === 'invalid') return undefined;
    return Object.freeze({ messages: values.messages, plan });
  } catch {
    return undefined;
  }
}

function savedPlanSource(input: unknown): Baseline['plan'] | undefined {
  const value = copyJson(input);
  if (!plainRecord(value)) return undefined;
  if (value.kind === 'missing' && Object.keys(value).length === 1)
    return Object.freeze({ kind: 'missing' });
  if (
    value.kind !== 'valid' ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'items')
  )
    return undefined;
  const plan = planState({ todos: value.items });
  return plan.kind === 'valid' ? plan : undefined;
}

/** Bind the captured baseline only after the native runtime supplies its actual
 * current human id. These are application facts, not invented graph fields. */
export function captureTurn(
  baseline: Baseline | undefined,
  input: TurnIdentity
): Turn | undefined {
  try {
    const identity = copyJson(input, true);
    if (
      !baseline ||
      !plainRecord(identity) ||
      ['owner', 'generation', 'threadId', 'humanId'].some(
        (k) => typeof identity[k] !== 'string' || !identity[k]
      ) ||
      typeof identity.humanContent !== 'string' ||
      (identity.backendRunId !== undefined &&
        (typeof identity.backendRunId !== 'string' || !identity.backendRunId))
    )
      return undefined;
    const copied = copyJson(baseline);
    if (
      !plainRecord(copied) ||
      !Array.isArray(copied.messages) ||
      !savedPlanSource(copied.plan) ||
      copied.messages.some((m) => plainRecord(m) && m.id === identity.humanId)
    )
      return undefined;
    return Object.freeze({ ...identity, baseline: copied }) as unknown as Turn;
  } catch {
    return undefined;
  }
}

export function checkpointSource(
  input: unknown,
  threadId: string
): Checkpoint | undefined {
  try {
    const value = copyJson(input);
    if (
      !plainRecord(value) ||
      value.thread_id !== threadId ||
      value.checkpoint_ns !== '' ||
      typeof value.checkpoint_id !== 'string' ||
      !value.checkpoint_id ||
      Object.keys(value).some(
        (k) =>
          ![
            'thread_id',
            'checkpoint_ns',
            'checkpoint_id',
            'checkpoint_map',
          ].includes(k)
      )
    )
      return undefined;
    if (
      value.checkpoint_map !== undefined &&
      (!plainRecord(value.checkpoint_map) ||
        Object.entries(value.checkpoint_map).some(
          ([k, v]) => k !== '' || v !== value.checkpoint_id
        ))
    )
      return undefined;
    return value as unknown as Checkpoint;
  } catch {
    return undefined;
  }
}
function empty(value: unknown) {
  return value === undefined || (Array.isArray(value) && !value.length);
}
function clean(record: Record<string, unknown>) {
  return (
    (record.error === undefined || record.error === null) &&
    ['interrupts', '__interrupt__', 'subgraphs'].every((k) => empty(record[k]))
  );
}
function terminal(record: Record<string, unknown>) {
  return (
    clean(record) &&
    Array.isArray(record.next) &&
    !record.next.length &&
    Array.isArray(record.tasks) &&
    !record.tasks.length
  );
}
function projectValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([k]) => k !== 'messages' && k !== '__interrupt__'
    )
  );
}

/** Confirmation is fail-closed. An unconfirmed result carries no replacement;
 * the application retains its previous saved authority until a later success. */
export function captureTerminal(input: TerminalInput): Confirmation {
  const unconfirmed: Confirmation = Object.freeze({ kind: 'unconfirmed' });
  try {
    const turn = copyJson(input.turn, true);
    const state = copyJson(input.snapshot, true);
    const raw = copyJson(input.loadedCheckpoint);
    const observed = copyJson(input.observedValues);
    if (
      !plainRecord(turn) ||
      !plainRecord(state) ||
      !plainRecord(raw) ||
      !plainRecord(observed) ||
      input.submittedSuccessfully !== true ||
      turn.owner !== input.owner ||
      turn.generation !== input.generation ||
      turn.threadId !== input.threadId ||
      state.status !== 'idle' ||
      !clean(state) ||
      !Array.isArray(state.interrupts) ||
      state.interrupts.length ||
      !Array.isArray(state.subgraphs) ||
      state.subgraphs.length ||
      !terminal(raw)
    )
      return unconfirmed;
    const knownRunId = input.backendRunId ?? turn.backendRunId;
    if (
      turn.backendRunId !== undefined &&
      input.backendRunId !== undefined &&
      turn.backendRunId !== input.backendRunId
    )
      return unconfirmed;
    if (
      knownRunId !== undefined &&
      (typeof knownRunId !== 'string' ||
        !knownRunId ||
        (raw.run_id !== undefined && raw.run_id !== knownRunId) ||
        (plainRecord(raw.metadata) &&
          raw.metadata.run_id !== undefined &&
          raw.metadata.run_id !== knownRunId))
    )
      return unconfirmed;
    const requested = checkpointSource(
      input.observedCheckpoint,
      input.threadId
    );
    const checkpoint = checkpointSource(raw.checkpoint, input.threadId);
    const latest = Array.isArray(state.history) ? state.history[0] : undefined;
    // Native history deliberately carries only checkpoint/parent/date/next.
    // Raw saved execution tasks and values are proved by the exact state read.
    if (
      !requested ||
      !checkpoint ||
      !sameJson(requested, checkpoint) ||
      !plainRecord(latest) ||
      !clean(latest) ||
      !Array.isArray(latest.next) ||
      latest.next.length ||
      (latest.tasks !== undefined &&
        (!Array.isArray(latest.tasks) || latest.tasks.length)) ||
      !sameJson(
        checkpointSource(latest.checkpoint, input.threadId),
        checkpoint
      ) ||
      (latest.values !== undefined && !sameJson(latest.values, raw.values))
    )
      return unconfirmed;
    const values = raw.values;
    if (
      !plainRecord(values) ||
      !clean(values) ||
      !sameJson(values, observed) ||
      !sameJson(projectValues(values), state.values) ||
      !Array.isArray(values.messages) ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !plainRecord(turn.baseline) ||
      !Array.isArray(turn.baseline.messages)
    )
      return unconfirmed;
    const prefix = turn.baseline.messages;
    if (!sameJson(prefix, values.messages.slice(0, prefix.length)))
      return unconfirmed;
    const human = values.messages[prefix.length];
    if (
      !plainRecord(human) ||
      human.type !== 'human' ||
      human.id !== turn.humanId ||
      human.content !== turn.humanContent
    )
      return unconfirmed;
    const evidence = writeEvidence(values.messages, turn.humanId as string);
    if (evidence.kind === 'invalid' || evidence.kind === 'rejected')
      return unconfirmed;
    const plan = planState(values);
    if (
      plan.kind === 'invalid' ||
      (evidence.kind === 'replacement'
        ? plan.kind !== 'valid' || !sameJson(plan.items, evidence.items)
        : !sameJson(plan, turn.baseline.plan))
    )
      return unconfirmed;
    if (!canonicalMatches(values.messages, state.messages, state.toolCalls))
      return unconfirmed;
    const last = values.messages.at(-1);
    if (
      !plainRecord(last) ||
      last.type !== 'ai' ||
      typeof last.content !== 'string' ||
      !last.content.trim() ||
      !empty(last.tool_calls)
    )
      return unconfirmed;
    return Object.freeze({
      kind: 'confirmed',
      update: evidence.kind === 'replacement' ? 'replacement' : 'retained',
      plan,
      checkpoint,
      values,
    });
  } catch {
    return unconfirmed;
  }
}

function canonicalMatches(
  raw: unknown[],
  messages: unknown[],
  tools: unknown[]
): boolean {
  if (raw.length !== messages.length) return false;
  const calls = new Map<string, Record<string, unknown>>();
  const ids = new Set<string>();
  for (const tool of tools) {
    if (
      !plainRecord(tool) ||
      typeof tool.id !== 'string' ||
      calls.has(tool.id) ||
      tool.status !== 'complete'
    )
      return false;
    calls.set(tool.id, tool);
  }
  const pending = new Set<string>();
  const seen = new Set<string>();
  for (const [i, wire] of raw.entries()) {
    const m = messages[i];
    if (
      !plainRecord(wire) ||
      !clean(wire) ||
      !plainRecord(m) ||
      typeof wire.id !== 'string' ||
      !wire.id ||
      ids.has(wire.id) ||
      wire.id !== m.id ||
      typeof wire.content !== 'string' ||
      wire.content !== m.content ||
      !plainRecord(m.delivery) ||
      m.delivery.phase !== 'complete' ||
      m.delivery.outcome !== 'success' ||
      wire.type !==
        (m.role === 'user'
          ? 'human'
          : m.role === 'assistant'
          ? 'ai'
          : m.role === 'tool'
          ? 'tool'
          : '') ||
      m.name !== (typeof wire.name === 'string' ? wire.name : undefined) ||
      !empty(wire.invalid_tool_calls) ||
      !empty(m.citations)
    )
      return false;
    ids.add(wire.id);
    const extra = plainRecord(wire.additional_kwargs)
      ? wire.additional_kwargs
      : {};
    if (
      (wire.additional_kwargs !== undefined &&
        !plainRecord(wire.additional_kwargs)) ||
      extra.function_call !== undefined ||
      !empty(extra.tool_calls) ||
      !empty(extra.citations) ||
      !empty(extra.sources)
    )
      return false;
    const reasoning =
      typeof wire.reasoning === 'string'
        ? wire.reasoning
        : typeof extra.reasoning_content === 'string'
        ? extra.reasoning_content
        : undefined;
    if (m.reasoning !== reasoning || m.toolCallId !== wire.tool_call_id)
      return false;
    if (wire.type === 'ai') {
      if (pending.size) return false;
      const rawCalls = wire.tool_calls ?? [];
      const projectedIds = m.toolCallIds ?? [];
      if (
        !Array.isArray(rawCalls) ||
        !Array.isArray(projectedIds) ||
        rawCalls.length !== projectedIds.length
      )
        return false;
      for (const [j, call] of rawCalls.entries()) {
        if (
          !plainRecord(call) ||
          typeof call.id !== 'string' ||
          !call.id ||
          call.id !== projectedIds[j] ||
          seen.has(call.id)
        )
          return false;
        const tool = calls.get(call.id);
        if (!tool || tool.name !== call.name || !sameJson(tool.args, call.args))
          return false;
        seen.add(call.id);
        pending.add(call.id);
      }
    } else if (wire.type === 'tool') {
      const tool = calls.get(wire.tool_call_id as string);
      if (
        !tool ||
        !pending.delete(wire.tool_call_id as string) ||
        tool.result !== wire.content ||
        !['success', 'error'].includes(wire.status as string) ||
        (wire.name !== tool.name &&
          !(
            wire.status === 'error' &&
            (wire.name === null || wire.name === undefined)
          )) ||
        !empty(wire.tool_calls) ||
        !empty(m.toolCallIds)
      )
        return false;
    } else if (
      pending.size ||
      !empty(wire.tool_calls) ||
      !empty(m.toolCallIds) ||
      wire.tool_call_id !== undefined
    )
      return false;
  }
  return !pending.size && seen.size === calls.size;
}
