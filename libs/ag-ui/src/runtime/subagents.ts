import type {
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SubagentErrorEvent,
} from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data.js';

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
  /** Evidence carried over from an earlier root invocation or supplied at restore, not observed in the current one. */
  readonly earlier?: true;
}
export type Subagents = readonly SubagentObservation[];

/** Children with terminal evidence, marked as earlier, for the next root invocation.
 * A child with no terminal evidence is dropped: nothing later can establish what
 * became of it, and it must not read as running in a run that did not start it.
 * Returns the input when nothing changes. */
export function settledSubagents(previous: Subagents): Subagents {
  if (previous.every((child) => child.terminal && child.earlier))
    return previous;
  return Object.freeze(
    previous
      .filter((child) => child.terminal)
      .map((child) =>
        child.earlier ? child : Object.freeze({ ...child, earlier: true })
      )
  );
}

/** Owns restored evidence as earlier children. Identity is checked as for live
 * events: one record per ID, and terminal evidence names its own child. */
export function ownSubagents(restored: unknown): Subagents {
  if (restored === undefined) return Object.freeze([]);
  if (!Array.isArray(restored))
    throw new TypeError('Restored subagents must be an array');
  const ids = new Set<string>();
  return Object.freeze(
    restored.map((record: unknown) => {
      const { started, terminal } = (record ?? {}) as Partial<SubagentObservation>;
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
        earlier: true as const,
      });
    })
  );
}

/** Observes native evidence within one root invocation, in start order.
 * Earlier children are history: a start may reuse an earlier child's ID and
 * replaces it, and terminal evidence never targets an earlier child.
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
  // An earlier child is not a target in this invocation.
  const replaced = index !== -1 && previous[index].earlier ? index : -1;
  if (replaced !== -1) index = -1;
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
  if (captured.type === 'SUBAGENT_STARTED') {
    if (replaced !== -1) next.splice(replaced, 1);
    next.push(Object.freeze({ started: captured }));
  }
  else
    next[index] = Object.freeze({
      started: previous[index].started,
      terminal: captured,
    });
  return Object.freeze(next);
}
