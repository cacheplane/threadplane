import type { AgentSubagent, Message, ToolCall } from '@threadplane/core';
import { projectMessages, projectToolCalls } from './message-projection.js';
import type { Observation } from './session-observation.js';
import type { SubagentObservation } from './subagents.js';
import type { Transcript } from './transcript.js';

type TranscriptRecord = Transcript[number];

/**
 * One child of the current root run: the core child, with the protocol
 * evidence it was read from. `messages` and `toolCalls` are the child's own
 * and are not repeated in the root snapshot's. They are every transcript record
 * attributed to the child's run id, so a later child that reuses an id also
 * lists the earlier child's records.
 */
export type SessionSubagent = AgentSubagent & SubagentObservation;

/** A child's records read as a root transcript, so the root selectors apply. */
const unattributed = new WeakMap<TranscriptRecord, TranscriptRecord>();
function asRoot(record: TranscriptRecord): TranscriptRecord {
  let known = unattributed.get(record);
  if (!known) {
    const { subagentRunId: _child, ...rest } = record as TranscriptRecord & {
      subagentRunId?: string;
    };
    known = Object.freeze(rest) as TranscriptRecord;
    unattributed.set(record, known);
  }
  return known;
}

function status(
  evidence: SubagentObservation,
  running: boolean
): AgentSubagent['status'] {
  if (evidence.terminal)
    return evidence.terminal.type === 'SUBAGENT_ERROR' ? 'error' : 'complete';
  return running ? 'running' : 'unknown';
}

const none: readonly SessionSubagent[] = Object.freeze([]);
const noMessages: readonly Message[] = Object.freeze([]);
const noCalls: readonly ToolCall[] = Object.freeze([]);

/**
 * The current run's children as core children. Each keeps its reference, and
 * the list keeps its own, until that child's evidence, status or transcript
 * changes. `previous` is the list this function returned last.
 */
export function projectSubagents(
  native: Observation,
  previous: readonly SessionSubagent[] = none
): readonly SessionSubagent[] {
  if (!native.subagents.length) return previous.length ? none : previous;
  const records = new Map<string, TranscriptRecord[]>();
  for (const record of native.transcript) {
    const child = (record as { subagentRunId?: unknown }).subagentRunId;
    if (typeof child !== 'string') continue;
    const own = records.get(child);
    if (own) own.push(asRoot(record));
    else records.set(child, [asRoot(record)]);
  }
  const prior = new Map(previous.map((child) => [child.id, child]));
  const running = native.status === 'running';
  let changed = previous.length !== native.subagents.length;
  const children = native.subagents.map((evidence, index) => {
    const { started, terminal } = evidence;
    const id = started.subagentRunId;
    const before = prior.get(id);
    const state = status(evidence, running);
    // A child with terminal evidence streams nothing further.
    const view = {
      status: state === 'running' ? ('running' as const) : ('idle' as const),
      transcript: Object.freeze(records.get(id) ?? []) as Transcript,
      reasoningDurations: native.reasoningDurations,
    };
    const messages = projectMessages(view, before?.messages ?? noMessages);
    const toolCalls = projectToolCalls(view, before?.toolCalls ?? noCalls);
    if (
      before &&
      before.started === started &&
      before.terminal === terminal &&
      before.status === state &&
      before.messages === messages &&
      before.toolCalls === toolCalls
    ) {
      if (previous[index] !== before) changed = true;
      return before;
    }
    changed = true;
    return Object.freeze({
      id,
      ...(typeof started.name === 'string' && { name: started.name }),
      ...(typeof started.description === 'string' && {
        description: started.description,
      }),
      ...(typeof started.parentToolCallId === 'string' && {
        toolCallId: started.parentToolCallId,
      }),
      ...(typeof started.parentSubagentRunId === 'string' && {
        parentId: started.parentSubagentRunId,
      }),
      status: state,
      messages,
      toolCalls,
      ...(terminal?.type === 'SUBAGENT_ERROR' &&
        typeof terminal.message === 'string' && { error: terminal.message }),
      started,
      ...(terminal && { terminal }),
    }) as SessionSubagent;
  });
  return changed ? Object.freeze(children) : previous;
}
