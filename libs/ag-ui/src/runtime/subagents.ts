import type {
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SubagentErrorEvent,
} from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data';

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
  return Object.freeze(next);
}
