import type { PlainValue, StreamingToolCall } from '@threadplane/core';
import { ownValue } from './ownership.js';
import type { StreamEvent } from './transport.types.js';
import { record } from './wire-message.js';

interface Fragment {
  readonly id?: string;
  readonly name?: string;
  readonly argsText: string;
}

/**
 * Tool calls the model is still writing, by where they stream: the namespace
 * path as JSON (`[]` for the root graph), then message id and chunk index.
 * Private to one run; a new run starts with none.
 */
export type StreamingToolCallObservation = ReadonlyMap<
  string,
  ReadonlyMap<string, Fragment>
>;

const none: StreamingToolCallObservation = new Map();
const empty: readonly StreamingToolCall[] = Object.freeze([]);

export function initialStreamingToolCalls(): StreamingToolCallObservation {
  return none;
}

function namespaceOf(event: StreamEvent): readonly string[] {
  const parts = event.type.split('|');
  return parts.length > 1 ? parts.slice(1) : event.namespace ?? [];
}

/**
 * Records the tool call chunks a `messages` event carries. A chunk streamed
 * with its metadata is a fragment and is appended; a chunk of a cumulative
 * message (`messages/partial`) replaces what is held. A chunk names its call
 * only once, so later fragments are matched by message id and chunk index.
 */
export function observeStreamingToolCalls(
  previous: StreamingToolCallObservation,
  event: StreamEvent
): StreamingToolCallObservation {
  const base = event.type.split('|')[0];
  if (base !== 'messages' && !base.startsWith('messages/')) return previous;
  if (!Array.isArray(event.messages)) return previous;
  const cumulative = !event.messageMetadata;
  let next: Map<string, ReadonlyMap<string, Fragment>> | undefined;
  let calls: Map<string, Fragment> | undefined;
  const key = JSON.stringify(namespaceOf(event));
  for (const value of event.messages) {
    const message = record(value);
    const chunks = message?.['tool_call_chunks'];
    if (!message || !Array.isArray(chunks)) continue;
    const messageId = typeof message['id'] === 'string' ? message['id'] : '';
    chunks.forEach((entry, position) => {
      const chunk = record(entry);
      if (!chunk) return;
      const index =
        typeof chunk['index'] === 'number' ? chunk['index'] : position;
      const text = typeof chunk['args'] === 'string' ? chunk['args'] : '';
      const id = typeof chunk['id'] === 'string' ? chunk['id'] : undefined;
      const name =
        typeof chunk['name'] === 'string' ? chunk['name'] : undefined;
      if (!calls) {
        next = new Map(previous);
        calls = new Map(previous.get(key));
        next.set(key, calls);
      }
      const at = `${messageId}:${index}`;
      const held = calls.get(at);
      calls.set(at, {
        id: id || held?.id,
        name: name || held?.name,
        argsText: cumulative ? text : (held?.argsText ?? '') + text,
      });
    });
  }
  return next ?? previous;
}

const BACKSLASH = String.fromCharCode(92);
const absent = Symbol('absent');

/**
 * Reads as much of a JSON text as is there: an open string, array or object
 * ends where the text does, and a dangling key or partial literal is dropped.
 * Returns undefined when nothing can be read yet. Never throws.
 */
export function parsePartialJson(text: string): PlainValue | undefined {
  let at = 0;
  const end = text.length;
  const skip = () => {
    while (at < end && text[at].trim() === '') at += 1;
  };
  const readString = (): { text: string; closed: boolean } => {
    at += 1;
    const start = at;
    while (at < end && text[at] !== '"') at += text[at] === BACKSLASH ? 2 : 1;
    const closed = at < end;
    let raw = text.slice(start, Math.min(at, end));
    at = closed ? at + 1 : end;
    for (;;) {
      try {
        return { text: JSON.parse(`"${raw}"`) as string, closed };
      } catch {
        // An escape cut short: drop it and read what precedes it.
        const cut = raw.lastIndexOf(BACKSLASH);
        if (cut < 0) return { text: '', closed };
        raw = raw.slice(0, cut);
      }
    }
  };
  const readValue = (): PlainValue | typeof absent => {
    skip();
    if (at >= end) return absent;
    const char = text[at];
    if (char === '"') return readString().text;
    if (char === '[') {
      at += 1;
      const items: PlainValue[] = [];
      for (;;) {
        skip();
        if (at >= end) return items;
        if (text[at] === ']') {
          at += 1;
          return items;
        }
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        const item = readValue();
        if (item === absent) return items;
        items.push(item);
      }
    }
    if (char === '{') {
      at += 1;
      const entries: Record<string, PlainValue> = {};
      for (;;) {
        skip();
        if (at >= end) return entries;
        if (text[at] === '}') {
          at += 1;
          return entries;
        }
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] !== '"') {
          at = end;
          return entries;
        }
        const key = readString();
        skip();
        if (!key.closed || at >= end || text[at] !== ':') {
          at = end;
          return entries;
        }
        at += 1;
        const item = readValue();
        if (item === absent) return entries;
        entries[key.text] = item;
      }
    }
    const start = at;
    while (at < end && /[-+0-9.eEa-z]/.test(text[at])) at += 1;
    let token = text.slice(start, at);
    if (!token || /^[a-z]/.test(token)) {
      const literal =
        token === 'true'
          ? true
          : token === 'false'
          ? false
          : token === 'null'
          ? null
          : absent;
      // Anything else is not JSON, or a literal still being written.
      if (literal === absent) at = end;
      return literal;
    }
    while (token) {
      const parsed = Number(token);
      if (Number.isFinite(parsed) && /[0-9]$/.test(token)) return parsed;
      token = token.slice(0, -1);
    }
    at = end;
    return absent;
  };
  try {
    const value = readValue();
    return value === absent ? undefined : value;
  } catch {
    return undefined;
  }
}

const projected = new WeakMap<
  ReadonlyMap<string, Fragment>,
  { readonly finalized: string; readonly calls: readonly StreamingToolCall[] }
>();

/**
 * The calls of one graph that are still being written, in the order they
 * began: those that have named themselves and are not yet finalized tool
 * calls. `args` is the best reading of the text so far.
 */
export function projectStreamingToolCalls(
  observation: StreamingToolCallObservation,
  namespace: readonly string[],
  finalizedIds: readonly string[]
): readonly StreamingToolCall[] {
  const calls = observation.get(JSON.stringify(namespace));
  if (!calls?.size) return empty;
  const finalized = finalizedIds.join('\n');
  const known = projected.get(calls);
  if (known?.finalized === finalized) return known.calls;
  const done = new Set(finalizedIds);
  const result: StreamingToolCall[] = [];
  for (const fragment of calls.values()) {
    if (!fragment.id || !fragment.name || done.has(fragment.id)) continue;
    const args = parsePartialJson(fragment.argsText);
    result.push({
      id: fragment.id,
      name: fragment.name,
      argsText: fragment.argsText,
      ...(args !== undefined ? { args } : {}),
    });
  }
  const owned = result.length
    ? (ownValue(
        result as unknown as PlainValue
      ) as unknown as readonly StreamingToolCall[])
    : empty;
  projected.set(calls, { finalized, calls: owned });
  return owned;
}
