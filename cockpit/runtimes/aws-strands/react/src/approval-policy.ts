import type { Session } from '@threadplane/ag-ui';
export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
type Transcript = NativeSnapshot['transcript'];
export interface Meeting {
  readonly topic: string;
  readonly slot: string;
}
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: Transcript[number];
  readonly prefix: Transcript;
}
export interface MeetingApproval {
  readonly threadId: string;
  readonly sourceRunId: string;
  /** Keep the original opaque branded occurrence, never decode an interrupt identifier. */
  readonly pause: Parameters<Session['resume']>[0];
  readonly interruptId: string;
  readonly toolCallId: string;
  readonly meeting: Meeting;
  readonly transcript: Transcript;
  readonly observation: NativeSnapshot;
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Reject accessors/cycles and bound both traversal and retained text. Recheck after every proxy trap. */
export function ownData(value: unknown, valid = () => true): unknown {
  let nodes = 100000,
    characters = 1000000;
  const seen = new Set<object>();
  function copy(input: unknown, depth: number): unknown {
    if (!valid() || --nodes < 0 || depth > 32)
      throw Error('Revoked or oversized observation');
    if (typeof input === 'string') {
      characters -= input.length;
      if (characters < 0) throw Error('Oversized text');
      return input;
    }
    if (input === null || input === undefined || typeof input === 'boolean')
      return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || seen.has(input))
      throw Error('Not plain data');
    const array = Array.isArray(input),
      prototype = Object.getPrototypeOf(input);
    if (
      !valid() ||
      (!array && prototype !== Object.prototype && prototype !== null)
    )
      throw Error('Not plain data');
    let arrayLength: number | undefined;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(input, 'length');
      if (
        !valid() ||
        !descriptor ||
        !('value' in descriptor) ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0 ||
        descriptor.value > nodes
      )
        throw Error('Revoked or oversized array');
      arrayLength = descriptor.value as number;
    }
    seen.add(input);
    const output: Record<string, unknown> | unknown[] = array ? [] : {};
    const keys = Reflect.ownKeys(input);
    if (!valid() || keys.length > nodes)
      throw Error('Revoked or oversized keys');
    if (arrayLength !== undefined) {
      // Reject sparse arrays instead of retaining uncharged logical slots.
      // Check bounds too: a proxy may under-report its writable length.
      let slots = 0;
      for (const key of keys) {
        if (typeof key !== 'string') throw Error('Not plain data');
        const index = Number(key);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < 4294967295 &&
          String(index) === key
        ) {
          if (index >= arrayLength) throw Error('Array index exceeds length');
          slots++;
        }
      }
      if (slots !== arrayLength) throw Error('Sparse array');
    }
    for (const key of keys) {
      if (!valid() || typeof key !== 'string') throw Error('Not plain data');
      characters -= key.length;
      if (characters < 0) throw Error('Oversized keys');
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!valid() || !descriptor || !('value' in descriptor))
        throw Error('Accessor data');
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    seen.delete(input);
    if (!valid()) throw Error('Revoked');
    return Object.freeze(output);
  }
  return copy(value, 0);
}
export function ownSnapshot(
  value: NativeSnapshot,
  valid = () => true
): NativeSnapshot | undefined {
  try {
    return ownData(value, valid) as NativeSnapshot;
  } catch {
    return undefined;
  }
}
export function same(left: unknown, right: unknown): boolean {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    const r = record(value);
    return r
      ? Object.fromEntries(
          Object.keys(r)
            .sort()
            .map((k) => [k, canonical(r[k])])
        )
      : value;
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function rootRows(s: NativeSnapshot): Transcript | undefined {
  if (!Array.isArray(s.transcript) || !Array.isArray(s.subagents)) return;
  const ids = new Set<string>(),
    calls = new Set<string>();
  for (const message of s.transcript) {
    const m = record(message);
    if (!m || typeof m['id'] !== 'string' || !m['id'] || ids.has(m['id']))
      return;
    ids.add(m['id']);
    if (
      m['subagentRunId'] !== undefined &&
      (typeof m['subagentRunId'] !== 'string' || !m['subagentRunId'])
    )
      return;
    const roles =
      typeof m['subagentRunId'] === 'string'
        ? [
            'user',
            'assistant',
            'tool',
            'developer',
            'system',
            'activity',
            'reasoning',
          ]
        : ['user', 'assistant', 'tool'];
    if (!roles.includes(m['role'] as string)) return;
    if (m['toolCalls'] !== undefined) {
      if (m['role'] !== 'assistant' || !Array.isArray(m['toolCalls'])) return;
      for (const call of m['toolCalls']) {
        const c = record(call),
          f = record(c?.['function']);
        if (
          !c ||
          typeof c['id'] !== 'string' ||
          !c['id'] ||
          calls.has(c['id']) ||
          c['type'] !== 'function' ||
          !f ||
          typeof f['name'] !== 'string' ||
          typeof f['arguments'] !== 'string'
        )
          return;
        calls.add(c['id']);
      }
    }
  }
  const rows = s.transcript.filter((m) => m.subagentRunId === undefined);
  const rootCalls = new Set<string>(),
    results = new Set<string>();
  for (const m of rows) {
    if (m.role === 'assistant')
      for (const call of m.toolCalls ?? []) rootCalls.add(call.id);
    else if (m.role === 'tool') {
      // A result can only belong to a root declaration already observed before it.
      if (!rootCalls.has(m.toolCallId) || results.has(m.toolCallId)) return;
      results.add(m.toolCallId);
    }
  }
  return Object.freeze(rows);
}
function semantic(message: Transcript[number]) {
  if (message.role !== 'assistant') return message;
  return {
    ...message,
    content: message.content ?? '',
    toolCalls: message.toolCalls?.map((c) => ({
      ...c,
      function: { ...c.function, arguments: parse(c.function.arguments) },
    })),
  };
}
function history(past: Transcript, current: Transcript) {
  let next = 0;
  for (const message of current) {
    if (next === past.length) break;
    const retained = past[next];
    if (message.id !== retained.id) continue;
    if (!same(semantic(retained), semantic(message))) return false;
    next++;
  }
  // New observations may interleave retained rows, but never reorder them.
  return next === past.length;
}
export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previous: string | undefined,
  prefix: Transcript,
  valid = () => true
): OwnedTurn | undefined {
  const s = ownSnapshot(snapshot, valid),
    rows = s && rootRows(s);
  if (
    !s ||
    !rows ||
    s.status !== 'running' ||
    s.decision ||
    typeof threadId !== 'string' ||
    !threadId ||
    typeof s.run?.id !== 'string' ||
    !s.run.id ||
    s.run.id === previous ||
    s.run.outcome !== undefined ||
    rows.length !== prefix.length + 1 ||
    !history(prefix, rows)
  )
    return;
  const human = rows.at(-1);
  if (
    !human ||
    human.role !== 'user' ||
    typeof human.content !== 'string' ||
    !human.content.trim() ||
    !valid()
  )
    return;
  return Object.freeze({
    threadId,
    runId: s.run.id,
    human,
    prefix: Object.freeze([...prefix]),
  });
}
function parse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
export function boundedText(value: unknown, maximum = 500): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= maximum;
}
export function meetingValue(value: unknown): Meeting | undefined {
  const m = record(value);
  if (
    !m ||
    Object.keys(m).length !== 2 ||
    !boundedText(m['topic']) ||
    !boundedText(m['slot'])
  )
    return;
  return Object.freeze({ topic: m['topic'], slot: m['slot'] });
}
function lookupArgs(value: unknown) {
  const a = record(value);
  return !!a && Object.keys(a).length === 1 && boundedText(a['day']);
}
function submitCalls(rows: Transcript) {
  return rows.flatMap((m) => (m.role === 'assistant' ? m.toolCalls ?? [] : []));
}
function nativeInterrupt(value: unknown, now: number) {
  const i = record(value);
  if (
    !i ||
    !boundedText(i['id'], 2000) ||
    i['reason'] !== 'book_meeting' ||
    i['toolCallId'] !== undefined ||
    i['responseSchema'] !== undefined ||
    i['subagentRunId'] !== undefined
  )
    return;
  const expiry = i['expiresAt'];
  if (
    expiry !== undefined &&
    (typeof expiry !== 'string' ||
      !Number.isFinite(Date.parse(expiry)) ||
      Date.parse(expiry) <= now)
  )
    return;
  return i;
}
export function captureApproval(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid = () => true
): MeetingApproval | undefined {
  const s = ownSnapshot(snapshot, valid),
    rows = s && rootRows(s);
  if (!s || !rows || !turn) return;
  const d = s.decision,
    r = s.run,
    t = r?.terminal;
  if (
    s.status !== 'idle' ||
    r?.id !== turn.runId ||
    r.outcome !== 'paused' ||
    d?.kind !== 'native' ||
    !boundedText(d.id, 4000) ||
    d.attempt ||
    d.sourceRunId !== turn.runId ||
    !Array.isArray(d.interrupts) ||
    d.interrupts.length !== 1 ||
    t?.type !== 'RUN_FINISHED' ||
    record(t)?.['subagentRunId'] !== undefined ||
    t.threadId !== turn.threadId ||
    t.runId !== turn.runId ||
    t.outcome?.type !== 'interrupt' ||
    !Array.isArray(t.outcome.interrupts) ||
    t.outcome.interrupts.length !== 1 ||
    !history([...turn.prefix, turn.human], rows)
  )
    return;
  const i = nativeInterrupt(d.interrupts[0], Date.now()),
    end = nativeInterrupt(t.outcome.interrupts[0], Date.now());
  if (!i || !end || !same(i, end)) return;
  const metadata = record(i['metadata']),
    meeting = meetingValue(metadata?.['reason']);
  if (!meeting) return;
  const previousCalls = submitCalls(turn.prefix),
    calls = submitCalls(rows).filter(
      (c) => !previousCalls.some((p) => p.id === c.id)
    ),
    books = calls.filter((c) => c.function.name === 'book_meeting'),
    lookups = calls.filter((c) => c.function.name === 'check_availability');
  const humanIndex = rows.findIndex((m) => m.id === turn.human.id);
  if (
    humanIndex < 0 ||
    submitCalls(rows.slice(0, humanIndex + 1)).some((c) =>
      calls.some((current) => current.id === c.id)
    )
  )
    return;
  if (
    books.length !== 1 ||
    lookups.length > 1 ||
    calls.length !== books.length + lookups.length ||
    !same(parse(books[0].function.arguments), meeting) ||
    lookups.some((c) => !lookupArgs(parse(c.function.arguments))) ||
    rows.some(
      (m) =>
        m.role === 'tool' && m.error && calls.some((c) => c.id === m.toolCallId)
    ) ||
    rows.some((m) => m.role === 'tool' && m.toolCallId === books[0].id) ||
    !same(
      rows.filter((m) => m.role === 'user'),
      [...turn.prefix.filter((m) => m.role === 'user'), turn.human]
    ) ||
    !valid()
  )
    return;
  try {
    const original = Object.getOwnPropertyDescriptor(
      snapshot,
      'decision'
    )?.value;
    if (!valid()) return;
    const pause =
      original &&
      (Object.getOwnPropertyDescriptor(original, 'id')?.value as Parameters<
        Session['resume']
      >[0]);
    if (!valid() || pause !== d.id) return;
    return Object.freeze({
      threadId: turn.threadId,
      sourceRunId: turn.runId,
      pause,
      interruptId: i['id'] as string,
      toolCallId: books[0].id,
      meeting,
      transcript: rows,
      observation: s,
    });
  } catch {
    return;
  }
}
export function sameApproval(a: MeetingApproval, b: MeetingApproval): boolean {
  return (
    a.pause === b.pause &&
    a.threadId === b.threadId &&
    a.sourceRunId === b.sourceRunId &&
    a.interruptId === b.interruptId &&
    a.toolCallId === b.toolCallId &&
    same(a.meeting, b.meeting) &&
    same(a.transcript.map(semantic), b.transcript.map(semantic)) &&
    same(a.observation.decision, b.observation.decision) &&
    same(a.observation.run, b.observation.run)
  );
}
export function confirmResume(
  snapshot: NativeSnapshot,
  approval: MeetingApproval,
  runId: string,
  approved: boolean,
  valid = () => true
): { readonly transcript: Transcript; readonly result: string } | undefined {
  const s = ownSnapshot(snapshot, valid),
    rows = s && rootRows(s);
  if (
    !s ||
    !rows ||
    !approval ||
    !runId ||
    runId === approval.sourceRunId ||
    s.status !== 'idle' ||
    s.decision ||
    s.run?.id !== runId ||
    s.run.outcome !== 'success'
  )
    return;
  const t = s.run.terminal;
  if (
    t?.type !== 'RUN_FINISHED' ||
    record(t)?.['subagentRunId'] !== undefined ||
    t.threadId !== approval.threadId ||
    t.runId !== runId ||
    (t.outcome !== undefined && t.outcome.type !== 'success') ||
    (t.outcome?.type === 'success' && !!t.outcome.pendingToolCallIds?.length) ||
    !history(approval.transcript, rows)
  )
    return;
  const ownedCalls = submitCalls(approval.transcript),
    calls = submitCalls(rows),
    results = rows.filter(
      (m) => m.role === 'tool' && m.toolCallId === approval.toolCallId
    ),
    pending = ownedCalls.filter(
      (c) =>
        c.id !== approval.toolCallId &&
        !approval.transcript.some(
          (m) => m.role === 'tool' && m.toolCallId === c.id
        )
    );
  if (pending.length > 1) return;
  for (const call of pending) {
    const lookup = rows.filter(
      (m) => m.role === 'tool' && m.toolCallId === call.id
    );
    if (
      call.function.name !== 'check_availability' ||
      !lookupArgs(parse(call.function.arguments)) ||
      lookup.length !== 1 ||
      lookup[0].role !== 'tool' ||
      lookup[0].error ||
      !boundedText(lookup[0].content, 100000)
    )
      return;
  }
  const expected = approved
    ? `Meeting booked for ${approval.meeting.slot}: ${approval.meeting.topic}`
    : `The human declined. Meeting NOT booked: ${approval.meeting.topic}`;
  if (
    results.length !== 1 ||
    results[0].role !== 'tool' ||
    results[0].error ||
    typeof results[0].content !== 'string' ||
    parse(results[0].content) !== expected ||
    rows.some(
      (m) =>
        m.role === 'user' && !approval.transcript.some((p) => p.id === m.id)
    ) ||
    rows.some(
      (m) =>
        m.role === 'tool' &&
        m.toolCallId !== approval.toolCallId &&
        !approval.transcript.some((p) => p.id === m.id) &&
        !pending.some((c) => c.id === m.toolCallId)
    ) ||
    calls.some((c) => !ownedCalls.some((p) => p.id === c.id)) ||
    !valid()
  )
    return;
  return Object.freeze({ transcript: rows, result: expected });
}
