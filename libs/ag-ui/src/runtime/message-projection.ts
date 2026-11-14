import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type Message,
} from '@threadplane/core';
import type { SessionSnapshot } from './session-observation.js';

const empty: readonly Message[] = Object.freeze([]);

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
 * - User and assistant text become messages. System, developer, tool and
 *   activity records, child-attributed records and tool calls are not projected
 *   in this slice.
 * - The protocol sends reasoning as its own records. Each is attached to the
 *   next assistant record as that message's `reasoning`; several before one
 *   assistant are joined by blank lines. Reasoning with no assistant record
 *   after it yet is shown as an assistant message under the reasoning record's
 *   identifier, so the row's identifier changes once the answer record arrives.
 * - `reasoningDurationMs` is the sum of the times the session measured for the
 *   attached reasoning records, and absent when it measured none.
 * - While the session runs, the message built from the transcript's last root
 *   record is streaming. Every other message is complete: with the run's
 *   outcome for the last message of the latest turn, otherwise with success.
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
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    reasoningDurationMs?: number;
    /** Position of the newest transcript record this message was built from. */
    last: number;
  }[] = [];
  let pending: Pending | undefined;
  let pendingLast = -1;
  let lastRoot = -1;
  let lastUser = -1;
  const reasoned = (waiting: Pending) => ({
    reasoning: waiting.text.join('\n\n'),
    ...(waiting.durationMs !== undefined && {
      reasoningDurationMs: waiting.durationMs,
    }),
  });
  const flush = () => {
    if (!pending) return;
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
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
          ? content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
          : '';
      if (text === '') continue;
      lastUser = drafts.length;
      drafts.push({ id, role, content: text, last: position });
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content : '';
    if (text === '' && !pending) continue;
    drafts.push({
      id,
      role,
      content: text,
      ...(pending && reasoned(pending)),
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
          index === drafts.length - 1 &&
          index > lastUser &&
          outcome !== 'success'
        ? completeDelivery(draft.id, outcome)
        : staticDelivery(draft.id);
    const old = prior.get(draft.id);
    return old &&
      old.role === draft.role &&
      old.content === draft.content &&
      old.reasoning === draft.reasoning &&
      old.reasoningDurationMs === draft.reasoningDurationMs &&
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
