import type {
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SubagentErrorEvent,
} from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { copyData } from './copy-data.js';

export type ChildStart = Pick<
  SubagentStartedEvent,
  | 'type'
  | 'subagentRunId'
  | 'name'
  | 'description'
  | 'parentSubagentRunId'
  | 'parentToolCallId'
  | 'parentMessageId'
  | 'timestamp'
  | 'metadata'
>;
export type ChildFinish = Pick<
  SubagentFinishedEvent,
  'type' | 'subagentRunId' | 'result' | 'outcome' | 'timestamp' | 'metadata'
>;
export type ChildError = Pick<
  SubagentErrorEvent,
  'type' | 'subagentRunId' | 'message' | 'code' | 'timestamp' | 'metadata'
>;
export interface SubagentObservation {
  readonly started: DeepReadonly<ChildStart>;
  readonly terminal?: DeepReadonly<ChildFinish | ChildError>;
}
export type Subagents = readonly SubagentObservation[];

/** Where in the transcript a child's own records lie: from `from`, up to but
 * not including `to`. A child of the current invocation has no `to`. */
export interface ChildSpan {
  readonly from: number;
  readonly to?: number;
}
/** Bookkeeping beside the evidence, so the published evidence keeps its shape. */
const invocationStarts = new WeakMap<Subagents, number>();
const spans = new WeakMap<SubagentObservation, ChildSpan>();

/** True for a child whose last evidence says it paused and can continue. */
export function suspended(child: SubagentObservation): boolean {
  const terminal = child.terminal;
  return (
    terminal?.type === 'SUBAGENT_FINISHED' &&
    (terminal.outcome as { type?: unknown } | undefined)?.type === 'suspended'
  );
}

/** The transcript length when the invocation that owns `current` began. */
export function invocationStart(current: Subagents): number {
  return invocationStarts.get(current) ?? 0;
}

/**
 * The records an earlier child owns. Evidence restored with a thread owns the
 * restored records attributed to it.
 */
export function earlierSpan(child: SubagentObservation): ChildSpan {
  return spans.get(child) ?? { from: 0 };
}

/**
 * Where a child of the current invocation begins. A child continues an earlier
 * one with the same ID when that one paused, so it keeps those records; any
 * other reuse of an ID starts a separate child.
 */
export function currentFrom(
  id: string,
  current: Subagents,
  earlier: Subagents | undefined
): number {
  const before = earlier?.find((child) => child.started.subagentRunId === id);
  return before && suspended(before)
    ? earlierSpan(before).from
    : invocationStart(current);
}

/** Restored evidence owns the restored transcript's records, and no later ones. */
export function restoredSubagents(
  restored: unknown,
  transcriptLength: number
): Subagents | undefined {
  const owned = ownSubagents(restored);
  for (const child of owned ?? [])
    spans.set(child, { from: 0, to: transcriptLength });
  return owned;
}

/**
 * Child evidence for the next root invocation. `ending` is the transcript
 * length the ending invocation reached, and `start` the length the next one
 * begins with; they differ when the next invocation rebuilds its history.
 */
export function nextInvocation(
  previous: {
    readonly subagents: Subagents;
    readonly earlierSubagents?: Subagents;
  },
  ending: number,
  start: number
): { readonly subagents: Subagents; readonly earlierSubagents?: Subagents } {
  for (const child of previous.subagents)
    if (child.terminal)
      spans.set(child, {
        from: currentFrom(
          child.started.subagentRunId,
          previous.subagents,
          previous.earlierSubagents
        ),
        to: ending,
      });
  const earlier = earlierSubagents(
    previous.earlierSubagents,
    previous.subagents
  );
  const subagents: Subagents = Object.freeze([]);
  invocationStarts.set(subagents, start);
  return { subagents, ...(earlier && { earlierSubagents: earlier }) };
}

/** History for the next root invocation: earlier children, then this
 * invocation's children that have terminal evidence. A child with no terminal
 * evidence is dropped, because nothing later can establish what became of it.
 * A later child replaces an earlier one with the same ID. Returns the earlier
 * list itself when nothing is added, and undefined when there is no history. */
export function earlierSubagents(
  earlier: Subagents | undefined,
  current: Subagents
): Subagents | undefined {
  const settled = current.filter((child) => child.terminal);
  if (!settled.length) return earlier;
  const replaced = new Set(settled.map((c) => c.started.subagentRunId));
  return Object.freeze([
    ...(earlier ?? []).filter(
      (child) => !replaced.has(child.started.subagentRunId)
    ),
    ...settled,
  ]);
}

/** Owns restored evidence as history. Identity is checked as for live events:
 * one record per ID, and terminal evidence names its own child. */
export function ownSubagents(restored: unknown): Subagents | undefined {
  if (restored === undefined) return undefined;
  if (!Array.isArray(restored))
    throw new TypeError('Restored subagents must be an array');
  const ids = new Set<string>();
  const owned = restored.map((record: unknown) => {
    const { started, terminal } = (record ??
      {}) as Partial<SubagentObservation>;
    const id = started?.subagentRunId;
    if (started?.type !== 'SUBAGENT_STARTED' || typeof id !== 'string')
      throw new TypeError('Restored subagent has no start evidence');
    if (ids.has(id)) throw new TypeError('Duplicate restored subagent ID');
    ids.add(id);
    if (
      terminal !== undefined &&
      ((terminal.type !== 'SUBAGENT_FINISHED' &&
        terminal.type !== 'SUBAGENT_ERROR') ||
        terminal.subagentRunId !== id)
    )
      throw new TypeError('Restored subagent terminal evidence is invalid');
    return Object.freeze({
      started: copyData(started, true) as SubagentObservation['started'],
      ...(terminal !== undefined && {
        terminal: copyData(terminal, true) as NonNullable<
          SubagentObservation['terminal']
        >,
      }),
    });
  });
  return owned.length ? Object.freeze(owned) : undefined;
}

/** Observes native evidence within one root invocation, in start order.
 * Previous records are owned; only the selected ID is checked for ambiguity.
 * Missing terminal evidence does not establish whether a child is running.
 * Parent links are descriptive; admission and root completion belong to callers. */
export function applySubagent(
  previous: Subagents,
  event: SubagentStartedEvent | SubagentFinishedEvent | SubagentErrorEvent
): Subagents {
  const { type, subagentRunId } = event;
  let index = -1;
  for (let position = 0; position < previous.length; position++) {
    if (previous[position].started.subagentRunId !== subagentRunId) continue;
    if (index !== -1) throw new TypeError('Duplicate target subagent ID');
    index = position;
  }
  const current = index === -1 ? undefined : previous[index];
  if (type === 'SUBAGENT_STARTED') {
    if (current) throw new TypeError('Subagent target already exists');
  } else {
    if (!current) throw new TypeError('Subagent target is missing');
    if (current.terminal !== undefined)
      throw new TypeError('Subagent target already has terminal evidence');
  }
  const { timestamp, metadata } = event;
  const common = {
    subagentRunId,
    ...(timestamp !== undefined && { timestamp }),
    ...(metadata !== undefined && { metadata }),
  };
  let selected: ChildStart | ChildFinish | ChildError;
  if (type === 'SUBAGENT_STARTED') {
    const {
      name,
      description,
      parentSubagentRunId,
      parentToolCallId,
      parentMessageId,
    } = event;
    selected = {
      type,
      ...common,
      name,
      ...(description !== undefined && { description }),
      ...(parentSubagentRunId !== undefined && { parentSubagentRunId }),
      ...(parentToolCallId !== undefined && { parentToolCallId }),
      ...(parentMessageId !== undefined && { parentMessageId }),
    };
  } else if (type === 'SUBAGENT_FINISHED') {
    const { result, outcome } = event;
    selected = {
      type,
      ...common,
      ...(result !== undefined && { result }),
      ...(outcome !== undefined && { outcome }),
    };
  } else {
    const { message, code } = event;
    selected = {
      type,
      ...common,
      message,
      ...(code !== undefined && { code }),
    };
  }
  // Capture only selected fields; rawEvent and extensions are not consulted.
  const captured = copyData(selected, true) as DeepReadonly<typeof selected>;
  const next = [...previous];
  if (captured.type === 'SUBAGENT_STARTED')
    next.push(Object.freeze({ started: captured }));
  else
    next[index] = Object.freeze({
      started: previous[index].started,
      terminal: captured,
    });
  const applied: Subagents = Object.freeze(next);
  invocationStarts.set(applied, invocationStart(previous));
  return applied;
}
