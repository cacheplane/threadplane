import type { Message, ToolCall } from '@threadplane/core';
import {
  approvalState,
  mutationArgs,
  type ApprovalState,
} from './approval-state';
import {
  copyJson,
  inspectJson,
  ownValue,
  plainRecord,
  sameJson,
  workspaceState,
  type WorkspaceState,
} from './workspace-state';

export interface TurnIdentity {
  readonly owner: string;
  /** Local attempt identity, never a backend run id. */
  readonly generation: string;
  readonly threadId: string;
  readonly humanId: string;
  readonly humanContent: string;
  readonly backendRunId?: string;
}
export interface Baseline {
  readonly messages: readonly unknown[];
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
export interface FilesystemSnapshot {
  readonly status: string;
  readonly error?: unknown;
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly values?: unknown;
  readonly history?: readonly unknown[];
}
export interface AuthorityInput {
  readonly turn: Turn | undefined;
  readonly owner: string;
  readonly generation: string;
  readonly threadId: string;
  readonly backendRunId?: string;
  /** Native submit/resume result outcome, not server run status. */
  readonly outcome: string;
  readonly observedCheckpoint: unknown;
  readonly observedValues: unknown;
  /** State loaded from the exact observed checkpoint. */
  readonly loadedCheckpoint: unknown;
  readonly snapshot: FilesystemSnapshot;
}
interface Confirmed {
  readonly checkpoint: Checkpoint;
  readonly workspace: Exclude<WorkspaceState, { kind: 'invalid' }>;
  /** Actual saved wire messages for the next pre-send canonical prefix. */
  readonly messages: readonly unknown[];
  readonly turn: Turn;
  readonly signature: string;
}
export type Authority =
  | { readonly kind: 'unconfirmed' }
  | (Confirmed & { readonly kind: 'terminal' })
  | (Confirmed & {
      readonly kind: 'paused';
      readonly approval: Extract<ApprovalState, { kind: 'valid' }>;
    });

export function captureBaseline(input?: unknown): Baseline | undefined {
  try {
    const values = input === undefined ? { messages: [] } : input;
    inspectJson(values, false, [[]]);
    if (!plainRecord(values)) return undefined;
    const messages = copyJson(ownValue(values, 'messages'));
    if (!Array.isArray(messages)) return undefined;
    return Object.freeze({ messages });
  } catch {
    return undefined;
  }
}
export function captureTurn(
  baseline: Baseline | undefined,
  input: TurnIdentity
): Turn | undefined {
  try {
    const identity = copyJson(input, true),
      prefix = copyJson(baseline);
    if (
      !plainRecord(identity) ||
      !plainRecord(prefix) ||
      !Array.isArray(prefix.messages) ||
      ['owner', 'generation', 'threadId', 'humanId'].some(
        (k) => typeof identity[k] !== 'string' || !identity[k]
      ) ||
      typeof identity.humanContent !== 'string' ||
      (identity.backendRunId !== undefined &&
        (typeof identity.backendRunId !== 'string' ||
          !identity.backendRunId)) ||
      prefix.messages.some((m) => plainRecord(m) && m.id === identity.humanId)
    )
      return undefined;
    return Object.freeze({ ...identity, baseline: prefix }) as unknown as Turn;
  } catch {
    return undefined;
  }
}
/** A resume is another attempt of the original human turn, not a new human. */
export function captureResume(
  turn: Turn | undefined,
  generation: string
): Turn | undefined {
  if (!turn || !generation || generation === turn.generation) return undefined;
  return captureTurn(turn.baseline, { ...turn, generation });
}
export function checkpointSource(
  input: unknown,
  threadId: string
): Checkpoint | undefined {
  try {
    const cp = copyJson(input);
    if (
      !plainRecord(cp) ||
      cp.thread_id !== threadId ||
      cp.checkpoint_ns !== '' ||
      typeof cp.checkpoint_id !== 'string' ||
      !cp.checkpoint_id ||
      Object.keys(cp).some(
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
      Object.hasOwn(cp, 'checkpoint_map') &&
      (!plainRecord(cp.checkpoint_map) ||
        Object.keys(cp.checkpoint_map).length !== 1 ||
        cp.checkpoint_map[''] !== cp.checkpoint_id)
    )
      return undefined;
    return cp as unknown as Checkpoint;
  } catch {
    return undefined;
  }
}
const empty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length === 0);
const clean = (r: Record<string, unknown>) =>
  (r.error === undefined || r.error === null) &&
  ['subgraphs', '__interrupt__', 'interrupts'].every((k) => empty(r[k]));
const except = (v: unknown, omit: string[]): Record<string, unknown> => {
  if (!plainRecord(v)) throw new Error('Expected record');
  return Object.fromEntries(
    Object.keys(v)
      .filter((k) => !omit.includes(k))
      .map((k) => [k, ownValue(v, k)])
  );
};
const projectedValues = (v: Record<string, unknown>) =>
  except(v, ['messages', '__interrupt__']);
const withoutTransient = (v: Record<string, unknown>) =>
  except(v, ['__interrupt__']);
const pauseNext = ['HumanInTheLoopMiddleware.after_model'];

/** Files authority is checkpoint data, never a ToolMessage repr or prediction.
 * A failed confirmation returns no replacement; callers retain prior authority. */
export function captureAuthority(input: AuthorityInput): Authority {
  const unconfirmed: Authority = Object.freeze({ kind: 'unconfirmed' });
  try {
    inspectJson(input.loadedCheckpoint, false, [['values']]);
    inspectJson(input.observedValues, false, [[]]);
    inspectJson(input.snapshot, true, [['values'], ['history', '0', 'values']]);
    const sourceValues = ownValue(input.loadedCheckpoint as object, 'values');
    const workspace = workspaceState(sourceValues);
    if (workspace.kind === 'invalid') return unconfirmed;
    const historySource = ownValue(input.snapshot, 'history');
    if (historySource !== undefined && !Array.isArray(historySource))
      return unconfirmed;
    const history = Array.isArray(historySource)
      ? Array.from(
          { length: ownValue(historySource, 'length') as number },
          (_, i) => except(ownValue(historySource, String(i)), ['values'])
        )
      : undefined;
    const latestSource = Array.isArray(historySource)
      ? ownValue(historySource, '0')
      : undefined;
    const turn = copyJson(input.turn, true),
      state = copyJson(
        {
          ...except(input.snapshot, ['values', 'history']),
          ...(history === undefined ? {} : { history }),
        },
        true
      ),
      raw = copyJson(except(input.loadedCheckpoint, ['values'])),
      observed = input.observedValues;
    const otherValues = copyJson(except(sourceValues, ['files']));
    if (!plainRecord(otherValues)) return unconfirmed;
    const values: Record<string, unknown> = {
      ...otherValues,
      ...(plainRecord(sourceValues) && Object.hasOwn(sourceValues, 'files')
        ? { files: ownValue(sourceValues, 'files') }
        : {}),
    };
    const paused = input.outcome === 'paused';
    if (
      (!paused && input.outcome !== 'success') ||
      !plainRecord(turn) ||
      !plainRecord(turn.baseline) ||
      !Array.isArray(turn.baseline.messages) ||
      !plainRecord(state) ||
      !plainRecord(raw) ||
      !plainRecord(observed) ||
      turn.owner !== input.owner ||
      turn.generation !== input.generation ||
      turn.threadId !== input.threadId ||
      state.status !== 'idle' ||
      (state.error !== undefined && state.error !== null) ||
      !Array.isArray(state.subgraphs) ||
      state.subgraphs.length ||
      !Array.isArray(state.interrupts) ||
      (raw.error !== undefined && raw.error !== null) ||
      !empty(raw.subgraphs)
    )
      return unconfirmed;
    const runId = input.backendRunId ?? turn.backendRunId;
    if (
      (turn.backendRunId !== undefined &&
        input.backendRunId !== undefined &&
        turn.backendRunId !== input.backendRunId) ||
      (runId !== undefined &&
        (typeof runId !== 'string' ||
          !runId ||
          (raw.run_id !== undefined && raw.run_id !== runId) ||
          (plainRecord(raw.metadata) &&
            raw.metadata.run_id !== undefined &&
            raw.metadata.run_id !== runId)))
    )
      return unconfirmed;
    const checkpoint = checkpointSource(raw.checkpoint, input.threadId),
      requested = checkpointSource(input.observedCheckpoint, input.threadId);
    const latest = Array.isArray(state.history) ? state.history[0] : undefined;
    const next = paused ? pauseNext : [];
    if (
      !checkpoint ||
      !requested ||
      !sameJson(checkpoint, requested) ||
      !plainRecord(latest) ||
      !clean(latest) ||
      !sameJson(latest.next, next) ||
      !sameJson(
        checkpointSource(latest.checkpoint, input.threadId),
        checkpoint
      ) ||
      !sameJson(raw.next, next) ||
      !Array.isArray(raw.tasks) ||
      (latest.tasks !== undefined && !sameJson(latest.tasks, raw.tasks)) ||
      (plainRecord(latestSource) &&
        ownValue(latestSource, 'values') !== undefined &&
        !sameJson(ownValue(latestSource, 'values'), values))
    )
      return unconfirmed;
    if (
      !plainRecord(values) ||
      !clean(values) ||
      !sameJson(values, withoutTransient(observed)) ||
      !sameJson(projectedValues(values), ownValue(input.snapshot, 'values')) ||
      !Array.isArray(values.messages) ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls)
    )
      return unconfirmed;
    let approval: Extract<ApprovalState, { kind: 'valid' }> | undefined;
    if (paused) {
      if (state.interrupts.length !== 1 || raw.tasks.length !== 1)
        return unconfirmed;
      const task = raw.tasks[0];
      if (
        !plainRecord(task) ||
        typeof task.id !== 'string' ||
        !task.id ||
        task.name !== pauseNext[0] ||
        !Array.isArray(task.interrupts) ||
        task.interrupts.length !== 1 ||
        (task.error !== undefined && task.error !== null) ||
        (task.state !== undefined && task.state !== null) ||
        !empty(task.subgraphs) ||
        !sameJson(task.interrupts, state.interrupts) ||
        (ownValue(observed, '__interrupt__') !== undefined &&
          !sameJson(ownValue(observed, '__interrupt__'), state.interrupts))
      )
        return unconfirmed;
      const proposal = approvalState(state.interrupts[0]);
      if (proposal.kind !== 'valid') return unconfirmed;
      approval = proposal;
    } else if (
      state.interrupts.length ||
      raw.tasks.length ||
      !clean(raw) ||
      !empty(ownValue(observed, '__interrupt__'))
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
      human.content !== turn.humanContent ||
      values.messages
        .slice(prefix.length + 1)
        .some((m) => plainRecord(m) && m.type === 'human')
    )
      return unconfirmed;
    if (
      !canonicalMatches(
        values.messages,
        state.messages,
        state.toolCalls,
        approval
      )
    )
      return unconfirmed;
    if (!paused) {
      const last = values.messages.at(-1);
      if (
        !plainRecord(last) ||
        last.type !== 'ai' ||
        typeof last.content !== 'string' ||
        !last.content.trim() ||
        !empty(last.tool_calls)
      )
        return unconfirmed;
    }
    const confirmed = {
      checkpoint,
      workspace,
      messages: values.messages,
      turn: turn as unknown as Turn,
      signature: JSON.stringify({
        checkpoint,
        turn,
        workspace,
        otherValues: except(values, ['files']),
        messages: state.messages,
        tools: state.toolCalls,
        interrupts: state.interrupts,
      }),
    };
    return approval
      ? Object.freeze({ ...confirmed, kind: 'paused', approval })
      : Object.freeze({ ...confirmed, kind: 'terminal' });
  } catch {
    return unconfirmed;
  }
}

/** Canonical native projections must match every raw id, call, argument, result,
 * text and delivery. Pending calls may exist only in the final paused AI step. */
function canonicalMatches(
  raw: unknown[],
  messages: unknown[],
  tools: unknown[],
  approval?: Extract<ApprovalState, { kind: 'valid' }>
): boolean {
  if (raw.length !== messages.length) return false;
  const catalog = new Map<string, Record<string, unknown>>(),
    ids = new Set<string>(),
    seen = new Set<string>();
  for (const t of tools) {
    if (
      !plainRecord(t) ||
      typeof t.id !== 'string' ||
      !t.id ||
      catalog.has(t.id) ||
      !['complete', 'pending'].includes(t.status as string)
    )
      return false;
    catalog.set(t.id, t);
  }
  const pending = new Map<string, Record<string, unknown>>();
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
      !empty(m.citations) ||
      !plainRecord(m.delivery) ||
      m.delivery.phase !== 'complete' ||
      m.delivery.generation !== m.id
    )
      return false;
    ids.add(wire.id);
    const extra = wire.additional_kwargs ?? {};
    if (
      !plainRecord(extra) ||
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
      const calls = wire.tool_calls ?? [],
        projected = m.toolCallIds ?? [];
      if (
        !Array.isArray(calls) ||
        !Array.isArray(projected) ||
        calls.length !== projected.length
      )
        return false;
      for (const [j, c] of calls.entries()) {
        if (
          !plainRecord(c) ||
          typeof c.id !== 'string' ||
          !c.id ||
          c.id !== projected[j] ||
          seen.has(c.id) ||
          typeof c.name !== 'string' ||
          !c.name ||
          !plainRecord(c.args) ||
          (c.type !== undefined && c.type !== 'tool_call') ||
          Object.keys(c).some(
            (k) => !['id', 'name', 'args', 'type'].includes(k)
          )
        )
          return false;
        const t = catalog.get(c.id);
        if (!t || t.name !== c.name || !sameJson(t.args, c.args)) return false;
        seen.add(c.id);
        pending.set(c.id, c);
      }
      const pausedMessage =
        !!approval && i === raw.length - 1 && calls.length > 0;
      if (m.delivery.outcome !== (pausedMessage ? 'paused' : 'success'))
        return false;
    } else if (wire.type === 'tool') {
      const t = catalog.get(wire.tool_call_id as string);
      if (
        !t ||
        !pending.delete(wire.tool_call_id as string) ||
        t.status !== 'complete' ||
        t.result !== wire.content ||
        !['success', 'error'].includes(wire.status as string) ||
        (wire.name !== t.name &&
          !(
            wire.status === 'error' &&
            (wire.name === undefined || wire.name === null)
          )) ||
        !empty(wire.tool_calls) ||
        !empty(m.toolCallIds) ||
        m.delivery.outcome !== 'success'
      )
        return false;
    } else if (
      pending.size ||
      !empty(wire.tool_calls) ||
      !empty(m.toolCallIds) ||
      wire.tool_call_id !== undefined ||
      m.delivery.outcome !== 'success'
    )
      return false;
  }
  if (seen.size !== catalog.size) return false;
  if (!approval) return pending.size === 0;
  if (
    !pending.size ||
    [...pending.keys()].some(
      (id) =>
        catalog.get(id)?.status !== 'pending' ||
        Object.hasOwn(catalog.get(id)!, 'result')
    )
  )
    return false;
  const protectedCalls: Record<string, unknown>[] = [];
  for (const call of pending.values()) {
    if (['write_file', 'edit_file', 'delete'].includes(call.name as string)) {
      if (!mutationArgs(call.name, call.args)) return false;
      const path = (call.args as Record<string, string>).file_path;
      // Pinned graph permission: exact write/edit descendants; recursive delete
      // checks subtree overlap with the /reports anchor.
      if (
        path.startsWith('/reports/') ||
        (call.name === 'delete' && (path === '/reports' || path === '/'))
      )
        protectedCalls.push(call);
    } else if (
      ![
        'ls',
        'read_file',
        'glob',
        'grep',
        'lookup_field_elevation',
        'lookup_runway_length',
      ].includes(call.name as string)
    )
      return false;
  }
  return (
    protectedCalls.length === approval.actions.length &&
    protectedCalls.every(
      (c, i) =>
        c.name === approval.actions[i].name &&
        sameJson(c.args, approval.actions[i].args)
    )
  );
}
export function sameObservedAuthority(
  captured: Authority,
  input: AuthorityInput
): boolean {
  if (captured.kind !== 'paused') return false;
  const current = captureAuthority(input);
  return (
    current.kind === 'paused' &&
    captured.signature === current.signature &&
    captured.approval.signature === current.approval.signature
  );
}
