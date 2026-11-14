import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type Message,
  type ToolCall,
} from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data.js';
import type { SessionSnapshot } from './session-observation.js';
import type { Transcript } from './transcript.js';

const empty: readonly Message[] = Object.freeze([]);
const noCalls: readonly ToolCall[] = Object.freeze([]);

type Assistant = Extract<Transcript[number], { role: 'assistant' }>;
type ToolRecord = Extract<Transcript[number], { role: 'tool' }>;
type CallRecord = NonNullable<Assistant['toolCalls']>[number];

interface SelectedCall {
  readonly call: CallRecord;
  /** The first root tool record that answers the call. */
  readonly result?: ToolRecord;
  readonly args: unknown;
  /** The arguments are final and are not JSON. */
  readonly invalid: boolean;
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
    ? content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    : '';

/**
 * Root tool calls whose arguments are final, by owning assistant record.
 *
 * The transcript keeps argument fragments as they arrive and does not record
 * the end event, so finality is read from what the snapshot shows. Arguments
 * are final when the session is not running, the call has a result, anything
 * follows the call in the root transcript, or the text already parses as a JSON
 * object or array (more fragments could not keep it valid). Until then the call
 * is withheld, so a view never sees half an argument object.
 */
function selectCalls(snapshot: SessionSnapshot) {
  const { transcript } = snapshot;
  const running = snapshot.status === 'running';
  const results = new Map<string, ToolRecord>();
  let lastRoot = -1;
  for (let position = 0; position < transcript.length; position++) {
    const record = transcript[position];
    if (typeof record.subagentRunId === 'string' || record.role === 'activity')
      continue;
    lastRoot = position;
    if (record.role === 'tool' && !results.has(record.toolCallId))
      results.set(record.toolCallId, record);
  }
  const owners = new Map<string, SelectedCall[]>();
  for (let position = 0; position < transcript.length; position++) {
    const record = transcript[position];
    if (record.role !== 'assistant' || typeof record.subagentRunId === 'string')
      continue;
    const calls = record.toolCalls ?? [];
    const shown: SelectedCall[] = [];
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index];
      const raw = call.function.arguments;
      const result = results.get(call.id);
      let args: unknown;
      let invalid = false;
      if (raw !== '')
        try {
          args = JSON.parse(raw);
        } catch {
          invalid = true;
        }
      const closed = typeof args === 'object' && args !== null;
      if (
        running &&
        !result &&
        !closed &&
        index === calls.length - 1 &&
        position === lastRoot
      )
        continue;
      shown.push({ call, ...(result && { result }), args, invalid });
    }
    if (shown.length > 0) owners.set(record.id, shown);
  }
  return owners;
}

/** What a projected call was built from, to reuse it while that is unchanged. */
const sources = new WeakMap<
  object,
  { call: CallRecord; result?: ToolRecord; running: boolean }
>();

/**
 * Display only: projects the root transcript's tool calls into core tool calls,
 * in transcript order, for the `toolCalls` of a core snapshot. The identifiers
 * match `toolCallIds` and `toolCallId` on the messages from `projectMessages`.
 *
 * - A call appears once its arguments are final (see `selectCalls`). Empty
 *   argument text is a call without input, with `args` undefined.
 * - A call with a root tool record is `complete`, with the record's text parsed
 *   as JSON when it is JSON and kept as text otherwise, or `error` when the
 *   record carries an error.
 * - A call without a record is `running` while the session runs and `pending`
 *   once it stops, which is where a call waiting for a decision or a client
 *   tool sits. Final arguments that are not JSON make the call an `error`.
 * - Calls owned by a child-attributed record are not projected.
 *
 * `previous` is an optional identity hint, as in `projectMessages`.
 */
export function projectToolCalls(
  snapshot: SessionSnapshot,
  previous: readonly ToolCall[] = noCalls
): readonly ToolCall[] {
  const running = snapshot.status === 'running';
  const prior = new Map(previous.map((call) => [call.id, call]));
  const calls: ToolCall[] = [];
  for (const shown of selectCalls(snapshot).values())
    for (const { call, result, args, invalid } of shown) {
      const old = prior.get(call.id);
      const source = old && sources.get(old);
      if (
        old &&
        source &&
        source.call === call &&
        source.result === result &&
        (result !== undefined || invalid || source.running === running)
      ) {
        calls.push(old);
        continue;
      }
      const base = {
        id: call.id,
        name: call.function.name,
        args: invalid ? undefined : copyData(args, true),
      };
      let value: unknown;
      if (result) {
        const text = textOf(result.content);
        try {
          value = copyData(JSON.parse(text), true);
        } catch {
          value = text;
        }
      }
      const projected = Object.freeze(
        result && typeof result.error === 'string' && result.error !== ''
          ? { ...base, status: 'error', error: result.error }
          : result
          ? { ...base, status: 'complete', result: value }
          : invalid
          ? { ...base, status: 'error', error: 'Invalid JSON arguments' }
          : { ...base, status: running ? 'running' : 'pending' }
      ) as ToolCall;
      sources.set(projected, { call, ...(result && { result }), running });
      calls.push(projected);
    }
  return calls.length === previous.length &&
    calls.every((call, index) => call === previous[index])
    ? previous
    : Object.freeze(calls);
}

const sameIds = (a?: readonly string[], b?: readonly string[]) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((id, index) => id === b[index]));

interface Pending {
  readonly ids: string[];
  readonly text: string[];
  durationMs?: number;
}

/**
 * Display only: projects the session's root transcript into core messages, so
 * views written for core snapshots (message rows, the reasoning disclosure) can
 * render an AG-UI conversation. Request history stays owned by the session.
 *
 * - User and assistant text become messages. An assistant record lists the
 *   calls `projectToolCalls` shows for it as `toolCallIds`, and is a message
 *   even without text once it has one. A tool record becomes a `tool` message
 *   with its text and `toolCallId`. System, developer and activity records and
 *   child-attributed records are not projected in this slice.
 * - The protocol sends reasoning as its own records. Each is attached to the
 *   next assistant record as that message's `reasoning`; several before one
 *   assistant are joined by blank lines. Reasoning with no assistant record
 *   after it yet is shown as an assistant message under the reasoning record's
 *   identifier, so the row's identifier changes once the answer record arrives.
 * - `reasoningDurationMs` is the sum of the times the session measured for the
 *   attached reasoning records, and absent when it measured none.
 * - While the session runs, the message built from the transcript's last root
 *   record is streaming. Every other message is complete: with the run's
 *   outcome for the last assistant message of the latest turn, otherwise with
 *   success.
 *
 * `previous` is an optional identity hint: unchanged messages, and an unchanged
 * list, are returned as the same references. Selection is O(N).
 */
export function projectMessages(
  snapshot: SessionSnapshot,
  previous: readonly Message[] = empty
): readonly Message[] {
  const durations = snapshot.reasoningDurations;
  const drafts: {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    reasoning?: string;
    reasoningDurationMs?: number;
    toolCallId?: string;
    toolCallIds?: readonly string[];
    /** Position of the newest transcript record this message was built from. */
    last: number;
  }[] = [];
  let pending: Pending | undefined;
  let pendingLast = -1;
  let lastRoot = -1;
  let lastUser = -1;
  let lastAssistant = -1;
  const owners = selectCalls(snapshot);
  const reasoned = (waiting: Pending) => ({
    reasoning: waiting.text.join('\n\n'),
    ...(waiting.durationMs !== undefined && {
      reasoningDurationMs: waiting.durationMs,
    }),
  });
  const flush = () => {
    if (!pending) return;
    lastAssistant = drafts.length;
    drafts.push({
      id: pending.ids[0],
      role: 'assistant',
      content: '',
      ...reasoned(pending),
      last: pendingLast,
    });
    pending = undefined;
  };
  for (let position = 0; position < snapshot.transcript.length; position++) {
    const record = snapshot.transcript[position];
    const { id, role, content } = record;
    if (typeof record.subagentRunId === 'string' || role === 'activity')
      continue;
    lastRoot = position;
    if (role === 'reasoning') {
      if (typeof content !== 'string' || content === '') continue;
      pending ??= { ids: [], text: [] };
      pending.ids.push(id);
      pending.text.push(content);
      pendingLast = position;
      const measured = durations?.[id];
      if (typeof measured === 'number' && Number.isFinite(measured))
        pending.durationMs = (pending.durationMs ?? 0) + measured;
      continue;
    }
    if (role === 'user') {
      flush();
      const text = textOf(content);
      if (text === '') continue;
      lastUser = drafts.length;
      drafts.push({ id, role, content: text, last: position });
      continue;
    }
    if (role === 'tool') {
      drafts.push({
        id,
        role,
        content: textOf(content),
        toolCallId: record.toolCallId,
        last: position,
      });
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content : '';
    const shown = owners.get(id);
    if (text === '' && !pending && !shown) continue;
    lastAssistant = drafts.length;
    drafts.push({
      id,
      role,
      content: text,
      ...(pending && reasoned(pending)),
      ...(shown && { toolCallIds: shown.map(({ call }) => call.id) }),
      last: position,
    });
    pending = undefined;
  }
  flush();

  const prior = new Map(previous.map((message) => [message.id, message]));
  const running = snapshot.status === 'running';
  const outcome = snapshot.run?.outcome ?? 'success';
  const messages = drafts.map(({ last, ...draft }, index): Message => {
    const delivery =
      draft.role === 'assistant' && running && last === lastRoot
        ? streamingDelivery(draft.id)
        : draft.role === 'assistant' &&
          !running &&
          index === lastAssistant &&
          index > lastUser &&
          outcome !== 'success'
        ? completeDelivery(draft.id, outcome)
        : staticDelivery(draft.id);
    const old = prior.get(draft.id);
    if (old && sameIds(old.toolCallIds, draft.toolCallIds) && draft.toolCallIds)
      draft.toolCallIds = old.toolCallIds;
    else if (draft.toolCallIds) Object.freeze(draft.toolCallIds);
    return old &&
      old.role === draft.role &&
      old.content === draft.content &&
      old.reasoning === draft.reasoning &&
      old.reasoningDurationMs === draft.reasoningDurationMs &&
      old.toolCallId === draft.toolCallId &&
      old.toolCallIds === draft.toolCallIds &&
      old.delivery.phase === delivery.phase &&
      (old.delivery.phase !== 'complete' ||
        (delivery.phase === 'complete' &&
          old.delivery.outcome === delivery.outcome))
      ? old
      : Object.freeze({ ...draft, delivery });
  });
  return messages.length === previous.length &&
    messages.every((message, index) => message === previous[index])
    ? previous
    : Object.freeze(messages);
}
