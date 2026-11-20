import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type AgentSubagent,
  type Message,
  type PlainValue,
  type StreamingToolCall,
  type ToolCall,
} from '@threadplane/core';
import {
  projectMessages,
  projectStreamingToolCalls,
  projectToolCalls,
} from './message-projection.js';
import type { Observation } from './session-observation.js';
import {
  currentFrom,
  earlierSpan,
  invocationStart,
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
    /**
     * Set on a child the backend reported as an `ACTIVITY` record with
     * `activityType: 'subagent'` and not through `SUBAGENT_*` events: the
     * record's content. `started` is then derived from that content, and
     * there is no `terminal`. The core `state` is this content's `state`.
     */
    readonly activity?: { readonly [key: string]: PlainValue };
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

const isRecord = (value: unknown): value is Record<string, PlainValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** A child's messages as an activity record lists them, or its one text. */
function activityMessages(
  id: string,
  content: Record<string, PlainValue>,
  state: AgentSubagent['status']
): readonly Message[] {
  const delivery = (messageId: string) =>
    state === 'error'
      ? completeDelivery(messageId, 'error')
      : state === 'running'
      ? streamingDelivery(messageId)
      : staticDelivery(messageId);
  const listed = content['messages'];
  if (!Array.isArray(listed))
    return Object.freeze([
      Object.freeze({
        id,
        role: 'assistant' as const,
        content: String(content['text'] ?? ''),
        delivery: delivery(id),
      }),
    ]);
  return Object.freeze(
    listed.map((entry: PlainValue, index: number): Message => {
      const message = isRecord(entry) ? entry : {};
      const messageId = text(message['id']) ?? `${id}-${index}`;
      const calls = message['toolCallIds'];
      const reasoning = text(message['reasoning']);
      return Object.freeze({
        id: messageId,
        // A child's records are shown as its own output, whatever their role.
        role: 'assistant' as const,
        content: text(message['content']) ?? '',
        delivery:
          message['role'] === 'assistant'
            ? delivery(messageId)
            : staticDelivery(messageId),
        ...(Array.isArray(calls) && {
          toolCallIds: calls.filter(
            (call): call is string => typeof call === 'string'
          ),
        }),
        ...(reasoning !== undefined && { reasoning }),
      });
    })
  );
}

/** Projections of activity children, by the record they were read from. */
const activityChildren = new WeakMap<
  object,
  {
    readonly state: AgentSubagent['status'];
    readonly earlier: boolean;
    readonly child: SessionSubagent;
  }
>();

/**
 * A child the backend reported as an `ACTIVITY` record of type `subagent`,
 * read the way the Angular adapter read one: `name`, `description`,
 * `toolCallId`, `status`, `messages` (or one `text`), `toolCalls`, `state`
 * and `state.error` from the record's content. A record that says `pending`
 * is `pending`: the root agent asked for the child and it has not started. A
 * record without a settled status is otherwise `running` in its own run and
 * `unknown` after it.
 */
function projectActivity(
  record: TranscriptRecord & { readonly role: 'activity' },
  running: boolean,
  earlier: boolean
): SessionSubagent {
  const content = (isRecord(record.content) ? record.content : {}) as Record<
    string,
    PlainValue
  >;
  const reported = content['status'];
  const state: AgentSubagent['status'] =
    reported === 'complete' || reported === 'error'
      ? reported
      : reported === 'pending' && running && !earlier
      ? 'pending'
      : running && !earlier
      ? 'running'
      : 'unknown';
  const known = activityChildren.get(record);
  if (known && known.state === state && known.earlier === earlier)
    return known.child;
  const name = text(content['name']);
  const description = text(content['description']);
  const toolCallId = text(content['toolCallId']);
  const childState = isRecord(content['state']) ? content['state'] : undefined;
  const failure = childState ? text(childState['error']) : undefined;
  const calls = content['toolCalls'];
  const child = Object.freeze({
    id: record.id,
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(toolCallId !== undefined && { toolCallId }),
    status: state,
    messages: activityMessages(record.id, content, state),
    toolCalls: Object.freeze(
      Array.isArray(calls)
        ? calls.filter(
            (call) =>
              isRecord(call) &&
              typeof call['id'] === 'string' &&
              typeof call['name'] === 'string'
          )
        : []
    ) as unknown as readonly ToolCall[],
    ...(childState && { state: childState }),
    ...(state === 'error' && failure !== undefined && { error: failure }),
    started: Object.freeze({
      type: 'SUBAGENT_STARTED' as const,
      subagentRunId: record.id,
      name: name ?? '',
      ...(description !== undefined && { description }),
      ...(toolCallId !== undefined && { parentToolCallId: toolCallId }),
    }),
    ...((earlier || undefined) && { earlier: true as const }),
    activity: content,
  }) as SessionSubagent;
  activityChildren.set(record, { state, earlier, child });
  return child;
}

const none: readonly SessionSubagent[] = Object.freeze([]);
const noMessages: readonly Message[] = Object.freeze([]);
const noCalls: readonly ToolCall[] = Object.freeze([]);
const noStreaming: readonly StreamingToolCall[] = Object.freeze([]);

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
  const running = native.status === 'running';
  const transcript = native.transcript;
  // Children the backend reported as activity records, in transcript order.
  // A child with event evidence under the same ID is read from the events.
  const evident = new Set([
    ...replaced,
    ...earlier.map((child) => child.started.subagentRunId),
  ]);
  const begins = invocationStart(current);
  const activities: SessionSubagent[] = [];
  for (let position = 0; position < transcript.length; position++) {
    const record = transcript[position];
    if (
      record.role !== 'activity' ||
      record.activityType !== 'subagent' ||
      typeof record.subagentRunId === 'string' ||
      evident.has(record.id)
    )
      continue;
    activities.push(projectActivity(record, running, position < begins));
  }
  if (!current.length && !earlier.length && !activities.length)
    return previous.length ? none : previous;
  const prior = new Map(previous.map((child) => [child.id, child]));
  let changed =
    previous.length !== earlier.length + current.length + activities.length;
  activities.forEach((child, index) => {
    if (previous[earlier.length + current.length + index] !== child)
      changed = true;
  });
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
    const streaming = projectStreamingToolCalls(
      view,
      before?.streamingToolCalls ?? noStreaming
    );
    if (
      before &&
      (before.streamingToolCalls ?? noStreaming) === streaming &&
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
      ...(streaming.length > 0 && { streamingToolCalls: streaming }),
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
    ...activities,
  ];
  return changed ? Object.freeze(children) : previous;
}
