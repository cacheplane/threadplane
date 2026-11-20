import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type Citation,
  type ContentBlock,
  type Message,
  type PlainValue,
  type StreamingToolCall,
  type ToolCall,
} from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data.js';
import type { Observation } from './session-observation.js';

/**
 * What the selectors read. Both a session's published snapshot and the
 * observation behind it qualify; the published `state` may be absent.
 */
export type Projectable = Pick<
  Observation,
  'status' | 'transcript' | 'reasoningDurations' | 'run'
> & { readonly state?: unknown };
import type { Transcript } from './transcript.js';

const empty: readonly Message[] = Object.freeze([]);
const noCalls: readonly ToolCall[] = Object.freeze([]);
const noStreaming: readonly StreamingToolCall[] = Object.freeze([]);

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
        .filter(
          (part) => part?.type === 'text' && typeof part.text === 'string'
        )
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
function selectCalls(snapshot: Projectable) {
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
  const withheld: CallRecord[] = [];
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
      ) {
        withheld.push(call);
        continue;
      }
      shown.push({ call, ...(result && { result }), args, invalid });
    }
    if (shown.length > 0) owners.set(record.id, shown);
  }
  return { owners, withheld };
}

/**
 * Reads argument text that is still arriving, as far as it can be read: the
 * text closed where it stands, or cut back to the last complete member. Only
 * an object or an array is returned; anything else is not arguments yet.
 */
function readPartialArguments(text: string): PlainValue | undefined {
  const closers: string[] = [];
  /** Where the text can be cut and closed, newest last, with the closers there. */
  const cuts: { readonly at: number; readonly close: string }[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      closers.push(char === '{' ? '}' : ']');
      cuts.push({ at: index + 1, close: [...closers].reverse().join('') });
    } else if (char === '}' || char === ']') closers.pop();
    else if (char === ',')
      cuts.push({ at: index, close: [...closers].reverse().join('') });
  }
  const attempts = [
    text +
      (inString ? (escaped ? '\\"' : '"') : '') +
      closers.reverse().join(''),
    ...cuts
      .slice(-3)
      .reverse()
      .map((cut) => text.slice(0, cut.at) + cut.close),
  ];
  for (const attempt of attempts)
    try {
      const value: unknown = JSON.parse(attempt);
      if (typeof value === 'object' && value !== null)
        return copyData(value, true) as PlainValue;
    } catch {
      /* Try the next, shorter reading. */
    }
  return undefined;
}

/** What a streaming call was built from, to reuse it while that is unchanged. */
const streamingSources = new WeakMap<object, CallRecord>();

/**
 * Display only: the root tool calls whose arguments are still arriving, for
 * the `streamingToolCalls` of a core snapshot. These are the calls
 * `projectToolCalls` withholds (see `selectCalls`): each has the argument text
 * so far in `argsText` and, when that text can be read, a best-effort `args`.
 * A call leaves this list when its arguments are final and it enters the
 * projected tool calls under the same `id`.
 *
 * `previous` is an optional identity hint, as in `projectMessages`.
 */
export function projectStreamingToolCalls(
  snapshot: Projectable,
  previous: readonly StreamingToolCall[] = noStreaming
): readonly StreamingToolCall[] {
  if (snapshot.status !== 'running')
    return previous.length ? noStreaming : previous;
  const { withheld } = selectCalls(snapshot);
  if (!withheld.length) return previous.length ? noStreaming : previous;
  const prior = new Map(previous.map((call) => [call.id, call]));
  const calls = withheld.map((call) => {
    const old = prior.get(call.id);
    if (old && streamingSources.get(old) === call) return old;
    const argsText = call.function.arguments;
    const args = argsText === '' ? undefined : readPartialArguments(argsText);
    const projected: StreamingToolCall = Object.freeze({
      id: call.id,
      name: call.function.name,
      argsText,
      ...(args !== undefined && { args }),
    });
    streamingSources.set(projected, call);
    return projected;
  });
  return calls.length === previous.length &&
    calls.every((call, index) => call === previous[index])
    ? previous
    : Object.freeze(calls);
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
  snapshot: Projectable,
  previous: readonly ToolCall[] = noCalls
): readonly ToolCall[] {
  const running = snapshot.status === 'running';
  const prior = new Map(previous.map((call) => [call.id, call]));
  const calls: ToolCall[] = [];
  for (const shown of selectCalls(snapshot).owners.values())
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
      // A result sent as parts keeps them beside its text.
      const parts =
        result && Array.isArray(result.content)
          ? { parts: result.content as readonly PlainValue[] }
          : undefined;
      const projected = Object.freeze(
        result && typeof result.error === 'string' && result.error !== ''
          ? { ...base, status: 'error', error: result.error, ...parts }
          : result
          ? { ...base, status: 'complete', result: value, ...parts }
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

const plain = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** One source entry as a core citation. A string is a URL; common aliases are read. */
function citation(entry: unknown, position: number): Citation {
  const index = position + 1;
  if (typeof entry === 'string') return { id: `c${index}`, index, url: entry };
  const source = plain(entry);
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === 'string') return value;
    }
    return undefined;
  };
  const explicit = source?.['index'];
  const publishedAt = source?.['publishedAt'];
  const fields = {
    title: first('title', 'name'),
    url: first('url', 'href', 'source'),
    snippet: first('snippet', 'content', 'excerpt'),
    sourceType: first('sourceType'),
    iconUrl: first('iconUrl'),
    publishedAt:
      typeof publishedAt === 'string' ||
      (typeof publishedAt === 'number' && Number.isFinite(publishedAt))
        ? publishedAt
        : undefined,
    extra: plain(source?.['extra']),
  };
  const result: Record<string, unknown> = {
    id: first('id', 'refId') ?? `c${index}`,
    index:
      typeof explicit === 'number' && Number.isFinite(explicit)
        ? explicit
        : index,
  };
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined) result[key] = value;
  return result as unknown as Citation;
}

/** State lists are owned and frozen, so one list is projected once. */
const projected = new WeakMap<object, readonly Citation[]>();

/**
 * The sources the application state lists for one message, read from
 * `state.citations[messageId]`. AG-UI has no citation event, so a backend
 * sends them as state, keyed by the assistant message's identifier.
 */
function citationsFor(
  byMessage: Record<string, unknown> | undefined,
  id: string
): readonly Citation[] | undefined {
  const list =
    byMessage && Object.prototype.hasOwnProperty.call(byMessage, id)
      ? byMessage[id]
      : undefined;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  let result = projected.get(list);
  if (!result) {
    result = copyData(list.map(citation), true) as readonly Citation[];
    projected.set(list, result);
  }
  return result;
}

const sameCitations = (
  a: readonly Citation[] | undefined,
  b: readonly Citation[] | undefined
) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/** A record's structured content as core blocks, by the content list it was read from. */
const structured = new WeakMap<
  object,
  {
    readonly blocks: readonly ContentBlock[];
    readonly extra?: Readonly<Record<string, PlainValue>>;
  }
>();

/**
 * A record whose content is a list of parts, as core blocks. Text and
 * URL-sourced images have a block; every other part is kept verbatim under
 * `extra['ag-ui'].parts`, as the Angular adapter kept them, so nothing the
 * producer sent is dropped. Content lists are owned and frozen, so one list is
 * read once.
 */
function structuredContent(content: unknown) {
  if (!Array.isArray(content)) return undefined;
  let known = structured.get(content);
  if (!known) {
    const blocks: ContentBlock[] = [];
    const rest: PlainValue[] = [];
    for (const part of content as readonly PlainValue[]) {
      const fields = plain(part);
      const source = plain(fields?.['source']);
      if (fields?.['type'] === 'text' && typeof fields['text'] === 'string')
        blocks.push(Object.freeze({ type: 'text', text: fields['text'] }));
      else if (
        fields?.['type'] === 'image' &&
        source?.['type'] === 'url' &&
        typeof source['value'] === 'string'
      )
        blocks.push(Object.freeze({ type: 'image', url: source['value'] }));
      else rest.push(part);
    }
    known = Object.freeze({
      blocks: Object.freeze(blocks),
      ...(rest.length > 0 && {
        extra: Object.freeze({
          'ag-ui': Object.freeze({ parts: Object.freeze(rest) }),
        }),
      }),
    });
    structured.set(content, known);
  }
  return known;
}
/** What marks a `developer` record, which the core contract shows as `system`. */
const DEVELOPER_EXTRA = Object.freeze({
  'ag-ui': Object.freeze({ role: 'developer' }),
});

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
 *   with its text and `toolCallId`.
 * - A system record with text becomes a `system` message, as the Angular
 *   adapter showed one a messages snapshot carried. A developer record does
 *   too, the core contract having no such role, marked
 *   `extra['ag-ui'].role: 'developer'`. Activity records and child-attributed
 *   records are not messages: a subagent activity is a child agent, and every
 *   record stays in `transcript`.
 * - A user or tool record whose content is a list of parts also carries
 *   `blocks`: a text block for each text part and an image block for each
 *   image part with a URL source. `content` stays the text. Any other part
 *   (audio, video, a document, inline image data) is kept verbatim under
 *   `extra['ag-ui'].parts`.
 * - The protocol sends reasoning as its own records. Each is attached to the
 *   next assistant record as that message's `reasoning`; several before one
 *   assistant are joined by blank lines. Reasoning with no assistant record
 *   after it yet is shown as an assistant message under the reasoning record's
 *   identifier, so the row's identifier changes once the answer record arrives.
 * - An assistant message carries the sources the application state lists for
 *   it under `state.citations[messageId]`, as core citations.
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
  snapshot: Projectable,
  previous: readonly Message[] = empty
): readonly Message[] {
  const durations = snapshot.reasoningDurations;
  const drafts: {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    blocks?: readonly ContentBlock[];
    extra?: Readonly<Record<string, PlainValue>>;
    reasoning?: string;
    reasoningDurationMs?: number;
    toolCallId?: string;
    toolCallIds?: readonly string[];
    citations?: readonly Citation[];
    /** Position of the newest transcript record this message was built from. */
    last: number;
  }[] = [];
  let pending: Pending | undefined;
  let pendingLast = -1;
  let lastRoot = -1;
  let lastUser = -1;
  let lastAssistant = -1;
  const { owners } = selectCalls(snapshot);
  const sources = plain(plain(snapshot.state)?.['citations']);
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
      const parts = structuredContent(content);
      // An image alone is still a message.
      if (text === '' && !parts?.blocks.length && !parts?.extra) continue;
      lastUser = drafts.length;
      drafts.push({ id, role, content: text, ...parts, last: position });
      continue;
    }
    if (role === 'system' || role === 'developer') {
      flush();
      const text = textOf(content);
      if (text === '') continue;
      drafts.push({
        id,
        role: 'system',
        content: text,
        ...(role === 'developer' && { extra: DEVELOPER_EXTRA }),
        last: position,
      });
      continue;
    }
    if (role === 'tool') {
      drafts.push({
        id,
        role,
        content: textOf(content),
        ...structuredContent(content),
        toolCallId: record.toolCallId,
        last: position,
      });
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content : '';
    const shown = owners.get(id);
    const cited = citationsFor(sources, id);
    if (text === '' && !pending && !shown) continue;
    lastAssistant = drafts.length;
    drafts.push({
      id,
      role,
      content: text,
      ...(pending && reasoned(pending)),
      ...(shown && { toolCallIds: shown.map(({ call }) => call.id) }),
      ...(cited && { citations: cited }),
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
    // A state snapshot can replace the list with an equal one.
    if (old && draft.citations && sameCitations(old.citations, draft.citations))
      draft.citations = old.citations;
    return old &&
      old.role === draft.role &&
      old.content === draft.content &&
      old.blocks === draft.blocks &&
      old.extra === draft.extra &&
      old.reasoning === draft.reasoning &&
      old.reasoningDurationMs === draft.reasoningDurationMs &&
      old.toolCallId === draft.toolCallId &&
      old.toolCallIds === draft.toolCallIds &&
      old.citations === draft.citations &&
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
