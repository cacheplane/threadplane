import {
  captureCheckpoint,
  sameCheckpoint,
  type Checkpoint,
} from './checkpoint-page';
import {
  captureData,
  captureInspectionValues,
  ownField,
  plainRecord,
  type Json,
} from './inspection-values';
export interface SemanticMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly reasoning?: string;
  readonly citations?: readonly Json[];
}
export interface FirstHuman extends SemanticMessage {
  readonly generation: string;
}
export interface DebugSnapshot {
  readonly status: string;
  readonly messages: readonly unknown[];
  readonly toolCalls: readonly unknown[];
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
  readonly error?: unknown;
  readonly values?: unknown;
  readonly history?: readonly unknown[];
}
export interface ConfirmedAuthority {
  readonly checkpoint: Checkpoint;
  readonly messages: readonly SemanticMessage[];
  readonly analysis: Readonly<{ characters: number; words: number }>;
}
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw Error('Expected array.');
  return Array.from({ length: v.length }, (_, i) => ownField(v, String(i)));
};
const empty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (!plainRecord(a) || !plainRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
  );
};
const read = (v: unknown) => {
  if (!plainRecord(v)) throw Error('Expected record.');
  const cache = new Map<string, unknown>();
  return (key: string) => {
    if (!cache.has(key)) cache.set(key, ownField(v, key));
    return cache.get(key);
  };
};
function role(value: unknown): SemanticMessage['role'] | undefined {
  if (['human', 'HumanMessage', 'user'].includes(value as string))
    return 'user';
  if (
    ['ai', 'AIMessage', 'AIMessageChunk', 'assistant'].includes(value as string)
  )
    return 'assistant';
  if (['system', 'SystemMessage'].includes(value as string)) return 'system';
  if (['tool', 'ToolMessage'].includes(value as string)) return 'tool';
  return undefined;
}
/** Source-grounded aliases from runtime citation-projection; semantic extras are owned. */
function citations(input: unknown): readonly Json[] | undefined {
  if (input === undefined) return undefined;
  return Object.freeze(
    array(input).map((entry, index) => {
      if (typeof entry === 'string')
        return captureData({
          id: `c${index + 1}`,
          index: index + 1,
          url: entry,
        });
      const f = read(entry),
        first = (...keys: string[]) => {
          for (const k of keys) {
            const v = f(k);
            if (v !== undefined && typeof v !== 'string')
              throw Error('Malformed citation.');
            if (typeof v === 'string') return v;
          }
          return undefined;
        };
      const explicit = f('index');
      if (
        explicit !== undefined &&
        (typeof explicit !== 'number' || !Number.isFinite(explicit))
      )
        throw Error('Malformed index.');
      const result: Record<string, unknown> = {
        id: first('id', 'refId') ?? `c${index + 1}`,
        index: explicit ?? index + 1,
      };
      const optional = {
        title: first('title', 'name'),
        url: first('url', 'href', 'source'),
        snippet: first('snippet', 'content', 'excerpt'),
        sourceType: first('sourceType'),
        iconUrl: first('iconUrl'),
        publishedAt: f('publishedAt'),
        extra: f('extra'),
      };
      if (
        optional.publishedAt !== undefined &&
        typeof optional.publishedAt !== 'string' &&
        !(
          typeof optional.publishedAt === 'number' &&
          Number.isFinite(optional.publishedAt)
        )
      )
        throw Error('Malformed timestamp.');
      if (optional.extra !== undefined && !plainRecord(optional.extra))
        throw Error('Malformed extras.');
      for (const [k, v] of Object.entries(optional))
        if (v !== undefined) result[k] = v;
      return captureData(result);
    })
  );
}
/** Independent semantic validation: never repairs text, collapses ids, or filters titles. */
export function captureSemanticMessages(
  input: unknown
): readonly SemanticMessage[] | undefined {
  try {
    const ids = new Set<string>();
    const result = array(input).map((value) => {
      const f = read(value),
        id = f('id'),
        type = f('type'),
        r = role(type ?? f('role'));
      if (typeof id !== 'string' || !id || ids.has(id) || !r)
        throw Error('Invalid identity.');
      ids.add(id);
      for (const key of [
        'tool_calls',
        'invalid_tool_calls',
        'tool_call_chunks',
        'toolCallIds',
      ])
        if (!empty(f(key))) throw Error('Tools unsupported.');
      if (f('tool_call_id') !== undefined || f('toolCallId') !== undefined)
        throw Error('Tools unsupported.');
      const extra = f('additional_kwargs') ?? {},
        ef = read(extra);
      if (ef('function_call') !== undefined || !empty(ef('tool_calls')))
        throw Error('Calls unsupported.');
      const rawContent = f('content');
      let content = '',
        blockReasoning: string | undefined;
      if (typeof rawContent === 'string') content = rawContent;
      else
        for (const block of array(rawContent)) {
          if (typeof block === 'string') {
            content += block;
            continue;
          }
          const b = read(block),
            t = b('type');
          if (t === 'text' || t === 'output_text' || t === undefined) {
            const annotations = b('annotations');
            if (
              annotations !== undefined &&
              (!Array.isArray(annotations) || annotations.length !== 0)
            )
              throw Error('Unsupported content annotations.');
            if (typeof b('text') !== 'string') throw Error('Text required.');
            content += b('text');
          } else if (t === 'reasoning' || t === 'thinking') {
            const encrypted = b('encrypted_content');
            if (
              encrypted !== undefined &&
              encrypted !== null &&
              encrypted !== ''
            )
              throw Error('Unsupported encrypted reasoning.');
            blockReasoning ??= '';
            const text = b('text'),
              thinking = b('thinking'),
              summary = b('summary');
            if (text !== undefined && typeof text !== 'string')
              throw Error('Reasoning text.');
            if (thinking !== undefined && typeof thinking !== 'string')
              throw Error('Thinking text.');
            if (typeof text === 'string') blockReasoning += text;
            else if (t === 'thinking' && typeof thinking === 'string')
              blockReasoning += thinking;
            if (summary !== undefined)
              for (const item of array(summary)) {
                const sf = read(item),
                  s = sf('text');
                if (typeof s !== 'string') throw Error('Summary text.');
                blockReasoning += s;
              }
          } else throw Error('Unsupported content meaning.');
        }
      const supplied = [
        f('reasoning'),
        ef('reasoning_content'),
        blockReasoning,
      ].filter((v) => v !== undefined);
      if (
        supplied.some((v) => typeof v !== 'string') ||
        supplied.some((v) => v !== supplied[0])
      )
        throw Error('Contradictory reasoning.');
      const name = f('name');
      if (name !== undefined && name !== null && typeof name !== 'string')
        throw Error('Name required.');
      const wireCitations = ef('citations') ?? ef('sources'),
        direct = f('citations');
      if (type !== undefined && direct !== undefined)
        throw Error('Unsupported raw citations.');
      const projected = citations(wireCitations ?? direct);
      const m = {
        id,
        role: r,
        content,
        ...(typeof name === 'string' ? { name } : {}),
        ...(supplied.length ? { reasoning: supplied[0] as string } : {}),
        ...(projected !== undefined ? { citations: projected } : {}),
      };
      // Canonical strings are lossless; only nonmessage inspection uses display budgets.
      return Object.freeze(m);
    });
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}
export function captureBaseline(
  messages: unknown
): readonly SemanticMessage[] | undefined {
  return captureSemanticMessages(messages);
}
export function captureFirstHuman(
  snapshot: DebugSnapshot,
  prefix: readonly SemanticMessage[] | undefined,
  input: string
): FirstHuman | undefined {
  try {
    if (!prefix || ownField(snapshot, 'status') !== 'running') return undefined;
    const source = array(ownField(snapshot, 'messages')),
      messages = captureSemanticMessages(source);
    if (
      !messages ||
      messages.length !== prefix.length + 1 ||
      !same(messages.slice(0, prefix.length), prefix)
    )
      return undefined;
    const human = messages[prefix.length],
      delivery = read(ownField(source[prefix.length], 'delivery')),
      generation = delivery('generation');
    if (
      human.role !== 'user' ||
      human.content !== input ||
      typeof generation !== 'string' ||
      !generation
    )
      return undefined;
    return Object.freeze({ ...human, generation });
  } catch {
    return undefined;
  }
}
function cleanSnapshot(snapshot: DebugSnapshot): boolean {
  const f = read(snapshot);
  return (
    f('status') === 'idle' &&
    (f('error') === undefined || f('error') === null) &&
    ['toolCalls', 'interrupts', 'subgraphs'].every((k) => {
      const a = f(k);
      return Array.isArray(a) && a.length === 0;
    })
  );
}
function terminal(
  input: unknown,
  threadId: string
):
  | {
      checkpoint: Checkpoint;
      messages: readonly SemanticMessage[];
      analysis: Readonly<{ characters: number; words: number }>;
    }
  | undefined {
  try {
    const f = read(input),
      cp = captureCheckpoint(f('checkpoint'), threadId),
      next = f('next'),
      tasks = f('tasks');
    if (
      !cp ||
      !Array.isArray(next) ||
      next.length ||
      !Array.isArray(tasks) ||
      tasks.length ||
      ['interrupts', '__interrupt__', 'subgraphs', 'toolCalls'].some(
        (k) => !empty(f(k))
      ) ||
      (f('error') !== undefined && f('error') !== null)
    )
      return undefined;
    const values = f('values'),
      vf = read(values),
      messages = captureSemanticMessages(vf('messages')),
      owned = captureInspectionValues(values);
    if (!messages || owned.kind !== 'available' || !empty(vf('__interrupt__')))
      return undefined;
    const analysis = owned.values['analysis'];
    if (
      !plainRecord(analysis) ||
      typeof analysis.characters !== 'number' ||
      typeof analysis.words !== 'number' ||
      Object.keys(analysis).length !== 2
    )
      return undefined;
    return Object.freeze({
      checkpoint: cp,
      messages,
      analysis: analysis as unknown as Readonly<{
        characters: number;
        words: number;
      }>,
    });
  } catch {
    return undefined;
  }
}
function loadedMatches(
  authority: ConfirmedAuthority,
  snapshot: DebugSnapshot,
  threadId: string,
  mode: 'live' | 'static',
  generation?: string,
  prefixLength = 0
): boolean {
  try {
    if (!cleanSnapshot(snapshot)) return false;
    const f = read(snapshot),
      sources = array(f('messages')),
      messages = captureSemanticMessages(sources);
    if (!messages || !same(messages, authority.messages)) return false;
    for (let i = 0; i < sources.length; i++) {
      const d = read(ownField(sources[i], 'delivery'));
      if (d('phase') !== 'complete' || d('outcome') !== 'success') return false;
      if (
        mode === 'static'
          ? d('generation') !== messages[i].id
          : i >= prefixLength && d('generation') !== generation
      )
        return false;
    }
    if (mode === 'static') {
      const history = array(f('history'));
      if (!history.length) return false;
      const tip = read(history[0]);
      if (
        !sameCheckpoint(
          authority.checkpoint,
          captureCheckpoint(tip('checkpoint'), threadId)
        )
      )
        return false;
      if (
        !empty(tip('next')) ||
        !empty(tip('tasks')) ||
        !empty(tip('interrupts')) ||
        !empty(tip('subgraphs'))
      )
        return false;
    }
    const values = captureInspectionValues(f('values'));
    return (
      values.kind === 'available' &&
      same(values.values['analysis'], authority.analysis)
    );
  } catch {
    return false;
  }
}
export interface LiveAuthorityInput {
  readonly prefix: readonly SemanticMessage[] | undefined;
  readonly human: FirstHuman | undefined;
  readonly generation: string;
  readonly snapshot: DebugSnapshot;
  readonly current: unknown;
  readonly exact: unknown;
  readonly threadId: string;
}
/** First validate live generation, then saved current + exact root; loading is the owner's next action. */
export function confirmLiveTurn(
  input: LiveAuthorityInput
): ConfirmedAuthority | undefined {
  try {
    const prefix = captureSemanticMessages(input.prefix),
      human = input.human,
      current = terminal(input.current, input.threadId),
      exact = terminal(input.exact, input.threadId);
    if (
      !prefix ||
      !human ||
      human.generation !== input.generation ||
      !input.generation ||
      !current ||
      !exact ||
      !sameCheckpoint(current.checkpoint, exact.checkpoint) ||
      !same(current.messages, exact.messages) ||
      !same(current.analysis, exact.analysis)
    )
      return undefined;
    const messages = exact.messages,
      n = prefix.length;
    if (
      messages.length !== n + 4 ||
      !same(messages.slice(0, n), prefix) ||
      !same(messages[n], captureSemanticMessages([human])?.[0]) ||
      messages[n].role !== 'user' ||
      messages.slice(n + 1).some((m) => m.role !== 'assistant')
    )
      return undefined;
    const a = messages[n + 1].content,
      analysis = { characters: [...a].length, words: a.split(' ').length };
    if (
      !same(exact.analysis, analysis) ||
      !loadedMatches(
        exact,
        input.snapshot,
        input.threadId,
        'live',
        input.generation,
        n
      )
    )
      return undefined;
    return Object.freeze({
      checkpoint: exact.checkpoint,
      messages: exact.messages,
      analysis: exact.analysis,
    });
  } catch {
    return undefined;
  }
}
export function confirmReload(input: {
  readonly authority: ConfirmedAuthority | undefined;
  readonly snapshot: DebugSnapshot;
  readonly threadId: string;
}): boolean {
  return (
    !!input.authority &&
    loadedMatches(input.authority, input.snapshot, input.threadId, 'static')
  );
}
