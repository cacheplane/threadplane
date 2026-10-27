import type { Message, ToolCall } from '@threadplane/core';

/** All limits count UTF16 code units, including property keys. */
export const LIMITS = Object.freeze({
  depth: 32,
  nodes: 10000,
  copyText: 4 * 1024 * 1024,
  displayText: 1024 * 1024,
  fieldText: 65536,
  tasks: 100,
  namespaces: 100,
});
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

/** Bounded capture before recursion or serialization. Never evaluates an accessor.
 * Enumerable keys are counted before the reflective own-key scan; descriptors
 * are inspected individually rather than allocating an unbounded descriptor map. */
export function copyData(value: unknown, allowUndefined = true): unknown {
  let nodes = 0,
    units = 0;
  const parents = new Set<object>();
  const charge = (s: string) => {
    units += s.length;
    if (units > LIMITS.copyText) throw new Error('Data text limit');
  };
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth)
      throw new Error('Data structure limit');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      charge(v);
      return v;
    }
    if (v === undefined && allowUndefined) return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || v === null || parents.has(v))
      throw new Error('Nonplain data');
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      throw new Error('Nonplain prototype');
    const length = array
      ? Object.getOwnPropertyDescriptor(v, 'length')?.value
      : undefined;
    if (
      array &&
      (!Number.isInteger(length) || length > LIMITS.nodes - nodes || length < 0)
    )
      throw new Error('Array limit');
    let enumerable = 0;
    for (const k in v)
      if (Object.hasOwn(v, k) && ++enumerable > LIMITS.nodes - nodes)
        throw new Error('Key limit');
    const keys = Reflect.ownKeys(v);
    if (keys.length > LIMITS.nodes - nodes + (array ? 1 : 0))
      throw new Error('Key limit');
    if (array && keys.length !== length + 1)
      throw new Error('Sparse or decorated array');
    const out: Record<string, unknown> | unknown[] = array
      ? []
      : Object.create(null);
    parents.add(v);
    for (const k of keys) {
      if (typeof k !== 'string') throw new Error('Symbol data');
      if (array && k === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))
        throw new Error('Decorated array');
      charge(k);
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d || !('value' in d) || !d.enumerable)
        throw new Error('Accessor or hidden data');
      Object.defineProperty(out, k, {
        value: visit(d.value, depth + 1),
        enumerable: true,
      });
    }
    parents.delete(v);
    return Object.freeze(out);
  }
  return visit(value, 0);
}

/** Stable semantic equality for already-owned bounded plain data. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every((k) => Object.hasOwn(b, k) && sameData(a[k], b[k]))
  );
}

/** One ledger per local conversation. Retained scopes replace their own charge;
 * followups reuse this ledger, so repeated snapshots are never counted twice. */
export class ConversationBudget {
  private entries = new Map<
    string,
    { tasks: number; namespaces: number; units: number }
  >();
  replace(
    key: string,
    tasks: number,
    namespaces: number,
    units: number
  ): boolean {
    if (
      !text(key) ||
      key.length > LIMITS.fieldText ||
      [tasks, namespaces, units].some((n) => !Number.isInteger(n) || n < 0)
    )
      return false;
    let t = tasks,
      n = namespaces,
      u = units;
    for (const [k, v] of this.entries)
      if (k !== key) {
        t += v.tasks;
        n += v.namespaces;
        u += v.units;
      }
    if (
      t > LIMITS.tasks ||
      n > LIMITS.namespaces ||
      u > LIMITS.displayText ||
      (!this.entries.has(key) &&
        this.entries.size >= LIMITS.tasks + LIMITS.namespaces)
    )
      return false;
    this.entries.set(key, { tasks, namespaces, units });
    return true;
  }
}
export function displayUnits(strings: readonly string[]): number {
  let total = 0;
  for (const s of strings) {
    if (typeof s !== 'string') throw new Error('Unavailable display text');
    if (s.length > LIMITS.fieldText) throw new Error('Display field limit');
    total += s.length;
    if (total > LIMITS.displayText) throw new Error('Display aggregate limit');
  }
  return total;
}
/** Already-owned optional native metadata stays literal and contract-shaped. */
export function validMessageMetadata(m: Record<string, unknown>): boolean {
  if (
    ['name', 'reasoning', 'toolCallId'].some(
      (k) => m[k] !== undefined && typeof m[k] !== 'string'
    )
  )
    return false;
  if (
    m.toolCallIds !== undefined &&
    (!Array.isArray(m.toolCallIds) ||
      m.toolCallIds.some((v) => !text(v)) ||
      new Set(m.toolCallIds).size !== m.toolCallIds.length)
  )
    return false;
  if (
    m.citations !== undefined &&
    (!Array.isArray(m.citations) ||
      m.citations.some(
        (c) =>
          !record(c) ||
          !text(c.id) ||
          typeof c.index !== 'number' ||
          !Number.isFinite(c.index) ||
          ['title', 'url', 'snippet', 'sourceType', 'iconUrl'].some(
            (k) => c[k] !== undefined && typeof c[k] !== 'string'
          ) ||
          (c.publishedAt !== undefined &&
            typeof c.publishedAt !== 'string' &&
            typeof c.publishedAt !== 'number')
      ))
  )
    return false;
  return true;
}
/** Preflight encoded JSON size before allocating its representation. */
export function literal(
  value: unknown,
  maximum: number = LIMITS.fieldText
): string {
  const owned = copyData(value);
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > LIMITS.displayText)
    throw new Error('Display limit');
  if (typeof owned === 'string') {
    if (owned.length > maximum) throw new Error('Display field limit');
    return owned;
  }
  let units = 0;
  const charge = (n: number) => {
    units += n;
    if (units > maximum) throw new Error('Display field limit');
  };
  const stringSize = (s: string) => {
    charge(s.length + 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 92) charge(1);
      else if (c < 32) charge([8, 9, 10, 12, 13].includes(c) ? 1 : 5);
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i++;
        else charge(5);
      } else if (c >= 0xdc00 && c <= 0xdfff) charge(5);
    }
  };
  function size(v: unknown, depth: number): void {
    if (typeof v === 'string') {
      stringSize(v);
      return;
    }
    if (Array.isArray(v)) {
      charge(2);
      if (v.length) {
        charge(
          v.length + 1 + 2 * (depth + 1) * v.length + 2 * depth + v.length - 1
        );
        for (const entry of v)
          size(entry === undefined ? null : entry, depth + 1);
      }
    } else if (record(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      charge(2);
      if (keys.length) {
        charge(
          keys.length +
            1 +
            2 * (depth + 1) * keys.length +
            2 * depth +
            keys.length -
            1
        );
        for (const k of keys) {
          stringSize(k);
          charge(2);
          size(v[k], depth + 1);
        }
      }
    } else charge(v === undefined ? 'Unavailable'.length : String(v).length);
  }
  size(owned, 0);
  return JSON.stringify(owned, null, 2) ?? 'Unavailable';
}

export interface Baseline {
  readonly messages: readonly unknown[];
}
export interface TurnIdentity {
  readonly owner: string;
  readonly generation: string;
  readonly threadId: string;
  readonly humanId: string;
  readonly humanContent: string;
}
export interface Turn extends TurnIdentity {
  readonly baseline: Baseline;
}
export interface Checkpoint {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
export interface NativeSnapshot {
  readonly status: string;
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly values?: unknown;
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly error?: unknown;
}
export interface AuthorityInput {
  readonly turn: Turn | undefined;
  readonly owner: string;
  readonly generation: string;
  readonly threadId: string;
  readonly outcome: string;
  /** Current root from the owned raw client, never child values or native synthesis. */
  readonly observedState: unknown;
  /** Fresh raw history from that same client and thread, newest first. */
  readonly history: readonly unknown[];
  /** Exact getState(thread, history[0].checkpoint), not a second current lookup. */
  readonly loadedCheckpoint: unknown;
  readonly snapshot: NativeSnapshot;
  readonly loadedSnapshot: NativeSnapshot;
}
export type Authority =
  | { readonly kind: 'unconfirmed' }
  | {
      readonly kind: 'terminal';
      readonly checkpoint: Checkpoint;
      readonly messages: readonly unknown[];
      readonly values: Readonly<Record<string, unknown>>;
      readonly rawToolStatuses: Readonly<Record<string, 'success' | 'error'>>;
      readonly turn: Turn;
    };
export function captureBaseline(
  input: unknown = { messages: [] }
): Baseline | undefined {
  try {
    const v = copyData(input, false);
    if (!record(v) || !Array.isArray(v.messages)) return undefined;
    return Object.freeze({ messages: v.messages });
  } catch {
    return undefined;
  }
}
export function captureTurn(
  baseline: Baseline | undefined,
  input: TurnIdentity
): Turn | undefined {
  try {
    const b = copyData(baseline, false),
      identity = copyData(input, false);
    if (
      !record(b) ||
      !Array.isArray(b.messages) ||
      !record(identity) ||
      ['owner', 'generation', 'threadId', 'humanId'].some(
        (k) =>
          !text(identity[k]) ||
          (identity[k] as string).length > LIMITS.fieldText
      ) ||
      typeof identity.humanContent !== 'string' ||
      identity.humanContent.length > LIMITS.fieldText ||
      b.messages.some((m) => record(m) && m.id === identity.humanId)
    )
      return undefined;
    return Object.freeze({ ...identity, baseline: b }) as unknown as Turn;
  } catch {
    return undefined;
  }
}
function checkpointSource(
  value: unknown,
  threadId: string
): Checkpoint | undefined {
  if (
    !record(value) ||
    value.thread_id !== threadId ||
    value.checkpoint_ns !== '' ||
    !text(value.checkpoint_id) ||
    value.checkpoint_id.length > LIMITS.fieldText ||
    Object.keys(value).some(
      (k) =>
        ![
          'thread_id',
          'checkpoint_ns',
          'checkpoint_id',
          'checkpoint_map',
        ].includes(k)
    )
  )
    return undefined;
  if (
    value.checkpoint_map !== undefined &&
    (!record(value.checkpoint_map) ||
      Object.keys(value.checkpoint_map).length !== 1 ||
      value.checkpoint_map[''] !== value.checkpoint_id)
  )
    return undefined;
  return value as unknown as Checkpoint;
}
const empty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length === 0);
const clean = (v: Record<string, unknown>) =>
  (v.error === undefined || v.error === null) &&
  empty(v.interrupts) &&
  empty(v.subgraphs) &&
  empty(v.__interrupt__);

/** Canonical root semantics independent of native delivery bookkeeping. */
function normalizedRaw(raw: readonly unknown[]):
  | {
      messages: Record<string, unknown>[];
      tools: Record<string, unknown>[];
      statuses: Record<string, 'success' | 'error'>;
    }
  | undefined {
  const messages: Record<string, unknown>[] = [],
    tools = new Map<string, Record<string, unknown>>(),
    ids = new Set<string>(),
    pending = new Set<string>(),
    statuses: Record<string, 'success' | 'error'> = Object.create(null);
  for (const w of raw) {
    if (
      !record(w) ||
      !text(w.id) ||
      ids.has(w.id) ||
      typeof w.content !== 'string' ||
      !clean(w) ||
      !empty(w.invalid_tool_calls) ||
      !['human', 'ai', 'tool'].includes(w.type as string)
    )
      return undefined;
    ids.add(w.id);
    const extra = w.additional_kwargs ?? {};
    if (
      !record(extra) ||
      !empty(extra.tool_calls) ||
      extra.function_call !== undefined
    )
      return undefined;
    const reasoning =
      typeof w.reasoning === 'string'
        ? w.reasoning
        : typeof extra.reasoning_content === 'string'
        ? extra.reasoning_content
        : undefined;
    // Supported citation shape is normalized explicitly; no private runtime imports.
    const source = extra.citations ?? extra.sources;
    let citations: unknown;
    if (Array.isArray(source))
      citations = source.map((s, i) => {
        if (typeof s === 'string')
          return { id: `c${i + 1}`, index: i + 1, url: s };
        const r = record(s) ? s : {},
          out: Record<string, unknown> = {
            id:
              [r.id, r.refId].find((x) => typeof x === 'string') ?? `c${i + 1}`,
            index:
              typeof r.index === 'number' && Number.isFinite(r.index)
                ? r.index
                : i + 1,
          };
        for (const [k, aliases] of Object.entries({
          title: ['title', 'name'],
          url: ['url', 'href', 'source'],
          snippet: ['snippet', 'content', 'excerpt'],
          sourceType: ['sourceType'],
          iconUrl: ['iconUrl'],
        })) {
          const v = aliases.map((a) => r[a]).find((x) => typeof x === 'string');
          if (v !== undefined) out[k] = v;
        }
        if (
          typeof r.publishedAt === 'string' ||
          typeof r.publishedAt === 'number'
        )
          out.publishedAt = r.publishedAt;
        if (record(r.extra)) out.extra = r.extra;
        return out;
      });
    const m: Record<string, unknown> = {
      id: w.id,
      role:
        w.type === 'human' ? 'user' : w.type === 'ai' ? 'assistant' : 'tool',
      content: w.content,
      ...(typeof w.name === 'string' ? { name: w.name } : {}),
    };
    if (reasoning !== undefined) m.reasoning = reasoning;
    if (citations !== undefined) m.citations = citations;
    if (w.type === 'ai') {
      if (pending.size || w.tool_call_id !== undefined) return undefined;
      const calls = w.tool_calls ?? [];
      if (!Array.isArray(calls)) return undefined;
      m.toolCallIds = [];
      for (const c of calls) {
        if (
          !record(c) ||
          !text(c.id) ||
          !text(c.name) ||
          tools.has(c.id) ||
          !Object.hasOwn(c, 'args') ||
          (c.type !== undefined && c.type !== 'tool_call') ||
          Object.keys(c).some(
            (k) => !['id', 'name', 'args', 'type'].includes(k)
          )
        )
          return undefined;
        (m.toolCallIds as string[]).push(c.id);
        tools.set(c.id, {
          id: c.id,
          name: c.name,
          args: c.args,
          status: 'pending',
        });
        pending.add(c.id);
      }
    } else if (w.type === 'tool') {
      const t =
        typeof w.tool_call_id === 'string'
          ? tools.get(w.tool_call_id)
          : undefined;
      if (
        !t ||
        !pending.delete(w.tool_call_id as string) ||
        !['success', 'error'].includes(w.status as string) ||
        (w.name !== t.name &&
          !(
            w.status === 'error' &&
            (w.name === null || w.name === undefined)
          )) ||
        !empty(w.tool_calls)
      )
        return undefined;
      m.toolCallId = w.tool_call_id;
      t.status = 'complete';
      t.result = w.content;
      statuses[w.tool_call_id as string] = w.status as 'success' | 'error';
    } else if (
      pending.size ||
      !empty(w.tool_calls) ||
      w.tool_call_id !== undefined
    )
      return undefined;
    messages.push(m);
  }
  if (
    pending.size ||
    messages[0]?.role !== 'user' ||
    messages.at(-1)?.role !== 'assistant' ||
    !text(messages.at(-1)?.content) ||
    (messages.at(-1)?.toolCallIds as unknown[])?.length
  )
    return undefined;
  return { messages, tools: [...tools.values()], statuses };
}
function nativeSemantic(
  input: NativeSnapshot
):
  | { messages: Record<string, unknown>[]; tools: readonly ToolCall[] }
  | undefined {
  if (
    input.status !== 'idle' ||
    (input.error !== undefined && input.error !== null) ||
    !Array.isArray(input.interrupts) ||
    input.interrupts.length ||
    !Array.isArray(input.subgraphs) ||
    !Array.isArray(input.messages) ||
    !Array.isArray(input.toolCalls)
  )
    return undefined;
  const messages: Record<string, unknown>[] = [],
    ids = new Set<string>();
  for (const m of input.messages) {
    if (
      !record(m) ||
      !text(m.id) ||
      ids.has(m.id) ||
      typeof m.content !== 'string' ||
      !validMessageMetadata(m) ||
      !record(m.delivery) ||
      !text(m.delivery.generation) ||
      m.delivery.phase !== 'complete' ||
      m.delivery.outcome !== 'success' ||
      Object.keys(m).some(
        (k) =>
          ![
            'id',
            'role',
            'content',
            'delivery',
            'reasoning',
            'citations',
            'name',
            'toolCallId',
            'toolCallIds',
          ].includes(k)
      )
    )
      return undefined;
    ids.add(m.id);
    const out: Record<string, unknown> = {
      id: m.id,
      role: m.role,
      content: m.content,
    };
    for (const k of ['name', 'reasoning', 'citations', 'toolCallId'])
      if (m[k as keyof Message] !== undefined) out[k] = m[k as keyof Message];
    if (m.role === 'assistant') {
      if (m.toolCallIds !== undefined && !Array.isArray(m.toolCallIds))
        return undefined;
      out.toolCallIds = m.toolCallIds ?? [];
    } else if (!empty(m.toolCallIds)) return undefined;
    messages.push(out);
  }
  return { messages, tools: input.toolCalls };
}
/** Only contiguous, complete result batches declared by a current assistant may
 * permute. Prior canonical history and all human/assistant boundaries stay strict. */
function matchesRoot(
  raw: ReturnType<typeof normalizedRaw>,
  native: ReturnType<typeof nativeSemantic>,
  prefix: number
): boolean {
  if (
    !raw ||
    !native ||
    raw.messages.length !== native.messages.length ||
    raw.tools.length !== native.tools.length
  )
    return false;
  const catalog = new Map<string, ToolCall>();
  for (const t of native.tools) {
    if (
      !record(t) ||
      !text(t.id) ||
      catalog.has(t.id) ||
      t.status !== 'complete'
    )
      return false;
    catalog.set(t.id, t);
  }
  for (const t of raw.tools)
    if (!sameData(t, catalog.get(t.id as string))) return false;
  for (let i = 0; i < raw.messages.length; i++) {
    const r = raw.messages[i],
      n = native.messages[i];
    if (!sameData(r, n)) return false;
    const callIds = r.role === 'assistant' ? (r.toolCallIds as string[]) : [];
    if (i >= prefix && callIds.length) {
      const batch = raw.messages.slice(i + 1, i + 1 + callIds.length),
        observed = native.messages.slice(i + 1, i + 1 + callIds.length);
      if (
        batch.length !== callIds.length ||
        observed.length !== callIds.length ||
        batch.some((m) => m.role !== 'tool') ||
        observed.some((m) => m.role !== 'tool')
      )
        return false;
      const byId = new Map(observed.map((m) => [m.toolCallId, m]));
      if (
        byId.size !== callIds.length ||
        batch.some(
          (m) =>
            !callIds.includes(m.toolCallId as string) ||
            !sameData(m, byId.get(m.toolCallId))
        )
      )
        return false;
      i += callIds.length;
    }
  }
  return true;
}

/** A failure yields no replacement: callers retain previously confirmed authority.
 * The caller captures its owned client and turn once before asynchronous reads. */
export function captureAuthority(input: unknown): Authority {
  const unavailable: Authority = Object.freeze({ kind: 'unconfirmed' });
  try {
    const captured = copyData(input) as AuthorityInput;
    const turn = captured.turn;
    if (
      !turn ||
      ['owner', 'generation', 'threadId', 'humanId'].some(
        (k) =>
          !text((turn as unknown as Record<string, unknown>)[k]) ||
          ((turn as unknown as Record<string, unknown>)[k] as string).length >
            LIMITS.fieldText
      ) ||
      typeof turn.humanContent !== 'string' ||
      turn.humanContent.length > LIMITS.fieldText ||
      captured.outcome !== 'success' ||
      turn.owner !== captured.owner ||
      turn.generation !== captured.generation ||
      turn.threadId !== captured.threadId ||
      !Array.isArray(turn.baseline?.messages)
    )
      return unavailable;
    const observed = copyData(captured.observedState, false),
      loaded = copyData(captured.loadedCheckpoint, false),
      history = copyData(captured.history, false);
    if (
      !record(observed) ||
      !record(loaded) ||
      !Array.isArray(history) ||
      !history.length ||
      !sameData(observed, loaded) ||
      !sameData(history[0], loaded) ||
      !clean(loaded) ||
      !Array.isArray(loaded.next) ||
      loaded.next.length ||
      !Array.isArray(loaded.tasks) ||
      loaded.tasks.length ||
      !record(loaded.values) ||
      !clean(loaded.values) ||
      !Array.isArray(loaded.values.messages)
    )
      return unavailable;
    const cp = checkpointSource(loaded.checkpoint, captured.threadId);
    if (!cp) return unavailable;
    const checkpointIds = new Set<string>();
    for (const h of history) {
      if (!record(h)) return unavailable;
      const c = checkpointSource(h.checkpoint, captured.threadId);
      if (!c || checkpointIds.has(c.checkpoint_id)) return unavailable;
      checkpointIds.add(c.checkpoint_id);
    }
    const messages = loaded.values.messages,
      prefix = turn.baseline.messages;
    if (!sameData(prefix, messages.slice(0, prefix.length))) return unavailable;
    const human = messages[prefix.length];
    if (
      !record(human) ||
      human.type !== 'human' ||
      human.id !== turn.humanId ||
      human.content !== turn.humanContent ||
      messages.filter((m) => record(m) && m.id === turn.humanId).length !== 1 ||
      messages
        .slice(prefix.length + 1)
        .some((m) => record(m) && m.type === 'human')
    )
      return unavailable;
    const raw = normalizedRaw(messages),
      before = nativeSemantic(captured.snapshot),
      after = nativeSemantic(captured.loadedSnapshot);
    const otherValues: Record<string, unknown> = {};
    for (const k of Object.keys(loaded.values))
      if (k !== 'messages' && k !== '__interrupt__')
        otherValues[k] = loaded.values[k];
    if (
      !raw ||
      !matchesRoot(raw, before, prefix.length) ||
      !matchesRoot(raw, after, prefix.length) ||
      !sameData(captured.snapshot.values, otherValues) ||
      !sameData(captured.loadedSnapshot.values, otherValues)
    )
      return unavailable;
    return Object.freeze({
      kind: 'terminal',
      checkpoint: cp,
      messages,
      values: loaded.values,
      rawToolStatuses: Object.freeze(raw.statuses),
      turn,
    });
  } catch {
    return unavailable;
  }
}
