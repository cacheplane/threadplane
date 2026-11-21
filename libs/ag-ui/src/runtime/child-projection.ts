import type { AgentSubagent, Message, ToolCall } from '@threadplane/core';
import { projectMessages, projectToolCalls } from './message-projection.js';
import type { Observation } from './session-observation.js';
import {
  currentFrom,
  earlierSpan,
  suspended,
  type ChildSpan,
  type SubagentObservation,
} from './subagents.js';
import type { Transcript } from './transcript.js';

type TranscriptRecord = Transcript[number];

/**
 * One child agent: the core child, with the protocol evidence it was read
 * from. `messages` and `toolCalls` are the child's own and are not repeated in
 * the root snapshot's.
 */
export type SessionSubagent = AgentSubagent &
  SubagentObservation & {
    /** Set on a child that settled in an earlier root run or came with the thread. */
    readonly earlier?: true;
  };

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

/**
 * - Error evidence is `error`, and finished evidence is `complete`, unless the
 *   child finished `suspended`: it paused and can continue, so it is `running`
 *   in its own run and while a later run is going, and `unknown` once a later
 *   run ends without continuing it.
 * - A child with no ending is `running` while the root run is going and
 *   `unknown` after it.
 */
function status(
  evidence: SubagentObservation,
  running: boolean,
  earlier: boolean
): AgentSubagent['status'] {
  const terminal = evidence.terminal;
  if (terminal?.type === 'SUBAGENT_ERROR') return 'error';
  if (terminal && !suspended(evidence)) return 'complete';
  if (terminal) return running || !earlier ? 'running' : 'unknown';
  return running ? 'running' : 'unknown';
}

const none: readonly SessionSubagent[] = Object.freeze([]);
const noMessages: readonly Message[] = Object.freeze([]);
const noCalls: readonly ToolCall[] = Object.freeze([]);

/**
 * Every child the session knows as a core child: those of earlier root runs
 * first, then the current run's, each list in start order. A current child
 * replaces an earlier one with the same run ID.
 *
 * A child lists the records attributed to its run ID within its own run. A
 * child that starts again after pausing continues, and keeps the records from
 * before the pause; any other child that reuses an ID starts with none.
 *
 * Each child keeps its reference, and the list keeps its own, until that
 * child's evidence, status or records change. `previous` is the list this
 * function returned last.
 */
export function projectSubagents(
  native: Observation,
  previous: readonly SessionSubagent[] = none
): readonly SessionSubagent[] {
  const current = native.subagents;
  const replaced = new Set(current.map((c) => c.started.subagentRunId));
  const earlier = (native.earlierSubagents ?? []).filter(
    (child) => !replaced.has(child.started.subagentRunId)
  );
  if (!current.length && !earlier.length)
    return previous.length ? none : previous;
  const running = native.status === 'running';
  const transcript = native.transcript;
  const prior = new Map(previous.map((child) => [child.id, child]));
  let changed = previous.length !== earlier.length + current.length;
  const project = (
    evidence: SubagentObservation,
    span: ChildSpan,
    isEarlier: boolean,
    index: number
  ): SessionSubagent => {
    const { started, terminal } = evidence;
    const id = started.subagentRunId;
    const records: TranscriptRecord[] = [];
    const end = Math.min(span.to ?? transcript.length, transcript.length);
    for (let position = span.from; position < end; position++) {
      const record = transcript[position];
      if ((record as { subagentRunId?: unknown }).subagentRunId === id)
        records.push(asRoot(record));
    }
    const before = prior.get(id);
    const state = status(evidence, running, isEarlier);
    // Only a child of the run that is going can still be streaming.
    const view = {
      status:
        state === 'running' && running && !terminal
          ? ('running' as const)
          : ('idle' as const),
      transcript: Object.freeze(records) as Transcript,
      reasoningDurations: native.reasoningDurations,
    };
    const messages = projectMessages(view, before?.messages ?? noMessages);
    const toolCalls = projectToolCalls(view, before?.toolCalls ?? noCalls);
    if (
      before &&
      before.started === started &&
      before.terminal === terminal &&
      before.status === state &&
      before.earlier === (isEarlier || undefined) &&
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
      ...(isEarlier && { earlier: true as const }),
    }) as SessionSubagent;
  };
  const children = [
    ...earlier.map((child, index) =>
      project(child, earlierSpan(child), true, index)
    ),
    ...current.map((child, index) =>
      project(
        child,
        {
          from: currentFrom(
            child.started.subagentRunId,
            current,
            native.earlierSubagents
          ),
        },
        false,
        earlier.length + index
      )
    ),
  ];
  return changed ? Object.freeze(children) : previous;
}
