import type { Session } from '@threadplane/ag-ui';
export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
type Transcript = NativeSnapshot['transcript'];
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: Transcript[number];
  readonly prefix: Transcript;
}
export interface ReservationApproval {
  readonly threadId: string;
  readonly sourceRunId: string;
  readonly pause: Parameters<Session['resume']>[0];
  readonly interruptId: string;
  readonly toolCallId: string;
  readonly site: string;
  readonly nights: number;
  readonly total: number;
  readonly transcript: Transcript;
}
/** Copy plain own data, reject accessors/cycles, bound traversal, and check revocation after proxy traps. */
export function ownSnapshot(
  snapshot: NativeSnapshot,
  valid = () => true
): NativeSnapshot | undefined {
  let budget = 100000;
  const seen = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (!valid() || --budget < 0 || depth > 32)
      throw new Error('Revoked or oversized data');
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value))
      throw new Error('Not plain data');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      !valid() ||
      (!array && prototype !== Object.prototype && prototype !== null)
    )
      throw new Error('Not plain data');
    seen.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (!valid() || typeof key !== 'string') throw new Error('Revoked data');
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!valid() || !descriptor || !('value' in descriptor))
        throw new Error('Accessor data');
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    seen.delete(value);
    if (!valid()) throw new Error('Revoked data');
    return Object.freeze(result);
  }
  try {
    const owned = copy(snapshot, 0) as NativeSnapshot;
    return valid() ? owned : undefined;
  } catch {
    return undefined;
  }
}
function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function root(s: NativeSnapshot) {
  if (
    !Array.isArray(s.transcript) ||
    !Array.isArray(s.subagents) ||
    s.subagents.length
  )
    return false;
  const ids = new Set<string>(),
    calls = new Set<string>();
  for (const message of s.transcript) {
    const m = record(message);
    if (
      !m ||
      typeof m['id'] !== 'string' ||
      !m['id'] ||
      ids.has(m['id']) ||
      typeof m['subagentRunId'] === 'string' ||
      !['user', 'assistant', 'tool'].includes(m['role'] as string)
    )
      return false;
    ids.add(m['id']);
    if (m['toolCalls'] !== undefined) {
      if (m['role'] !== 'assistant' || !Array.isArray(m['toolCalls']))
        return false;
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
          return false;
        calls.add(c['id']);
      }
    }
  }
  return true;
}
export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previous: string | undefined,
  prefix: Transcript,
  valid = () => true
): OwnedTurn | undefined {
  const s = ownSnapshot(snapshot, valid);
  if (
    !s ||
    !root(s) ||
    s.status !== 'running' ||
    s.decision ||
    !threadId ||
    typeof s.run?.id !== 'string' ||
    !s.run.id ||
    s.run.id === previous ||
    s.run.outcome !== undefined ||
    s.transcript.length !== prefix.length + 1 ||
    !prefix.every((m, i) => same(m, s.transcript[i]))
  )
    return;
  const human = s.transcript.at(-1);
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
    prefix: Object.freeze([...s.transcript.slice(0, -1)]),
  });
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function interrupt(value: unknown, now: number) {
  const i = record(value);
  if (
    !i ||
    typeof i['id'] !== 'string' ||
    !i['id'] ||
    i['reason'] !== 'mastra:tool_suspend' ||
    typeof i['toolCallId'] !== 'string' ||
    !i['toolCallId'] ||
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
function duplicates(value: unknown, notice: Record<string, unknown>) {
  const r = record(value);
  if (!r) return false;
  for (const field of [
    'type',
    'toolName',
    'runId',
    'toolCallId',
    'suspendPayload',
    'args',
    'resumeSchema',
  ])
    if (r[field] !== undefined && !same(r[field], notice[field])) return false;
  return true;
}
export function captureApproval(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid = () => true
): ReservationApproval | undefined {
  const s = ownSnapshot(snapshot, valid);
  if (!s || !root(s)) return;
  const d = s.decision,
    r = s.run,
    t = r?.terminal;
  if (
    s.status !== 'idle' ||
    r?.id !== turn.runId ||
    r.outcome !== 'paused' ||
    d?.kind !== 'native' ||
    typeof d.id !== 'string' ||
    !d.id ||
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
    !same(s.transcript.slice(0, turn.prefix.length), turn.prefix) ||
    !same(s.transcript[turn.prefix.length], turn.human)
  )
    return;
  const i = interrupt(d.interrupts[0], Date.now()),
    end = interrupt(t.outcome.interrupts[0], Date.now());
  if (!i || !end || !same(i, end)) return;
  const custom = r.legacyInterrupt;
  if (
    custom?.type !== 'CUSTOM' ||
    record(custom)?.['subagentRunId'] !== undefined ||
    custom.name !== 'on_interrupt' ||
    typeof custom.value !== 'string' ||
    custom.value.length > 16384
  )
    return;
  let n: Record<string, unknown> | undefined;
  try {
    n = record(JSON.parse(custom.value));
  } catch {
    return;
  }
  if (
    !n ||
    n['type'] !== 'mastra_suspend' ||
    n['toolName'] !== 'reserve_campsite' ||
    n['runId'] !== turn.runId ||
    n['toolCallId'] !== i['toolCallId'] ||
    n['subagentRunId'] !== undefined
  )
    return;
  const payload = record(n['suspendPayload']);
  if (!payload) return;
  const site = payload['site'],
    nights = payload['nights'],
    total = payload['total_usd'];
  if (
    typeof site !== 'string' ||
    !site.trim() ||
    site.length > 500 ||
    typeof nights !== 'number' ||
    !Number.isSafeInteger(nights) ||
    nights < 1 ||
    nights > 365 ||
    typeof total !== 'number' ||
    !Number.isFinite(total) ||
    total < 0 ||
    total > 1e6 ||
    total !== nights * 45
  )
    return;
  const args = n['args'] === undefined ? undefined : record(n['args']);
  if (
    n['args'] !== undefined &&
    (!args ||
      (args['site'] !== undefined && args['site'] !== site) ||
      (args['nights'] !== undefined && args['nights'] !== nights) ||
      (args['total_usd'] !== undefined && args['total_usd'] !== total))
  )
    return;
  const metadata = record(i['metadata']);
  if (metadata?.['mastra'] !== undefined && !duplicates(metadata['mastra'], n))
    return;
  const extra = s.transcript.slice(turn.prefix.length + 1);
  if (
    extra.some(
      (m) =>
        m.role !== 'assistant' ||
        m.toolCalls?.some(
          (c) =>
            c.id !== i['toolCallId'] || c.function.name !== 'reserve_campsite'
        )
    )
  )
    return;
  if (!valid()) return;
  return Object.freeze({
    threadId: turn.threadId,
    sourceRunId: turn.runId,
    pause: d.id,
    interruptId: i['id'] as string,
    toolCallId: i['toolCallId'] as string,
    site,
    nights,
    total,
    transcript: s.transcript,
  });
}
export function confirmResume(
  snapshot: NativeSnapshot,
  approval: ReservationApproval,
  runId: string,
  approved: boolean,
  valid = () => true
): { readonly transcript: Transcript; readonly result: string } | undefined {
  const s = ownSnapshot(snapshot, valid);
  if (
    !s ||
    !root(s) ||
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
    (t.outcome !== undefined && t.outcome?.type !== 'success') ||
    (t.outcome?.type === 'success' && !!t.outcome.pendingToolCallIds?.length) ||
    !approval.transcript.every((m, i) => same(m, s.transcript[i]))
  )
    return;
  const extra = s.transcript.slice(approval.transcript.length),
    results = extra.filter((m) => m.role === 'tool');
  const expected = JSON.stringify(
    approved
      ? `Reserved ${approval.site} for ${approval.nights} night(s) — total $${
          approval.total
        }. Confirmation TP-${String(approval.nights).padStart(2, '0')}88.`
      : `Reservation for ${approval.site} was declined by the user. Nothing was booked.`
  );
  if (
    results.length !== 1 ||
    results[0].role !== 'tool' ||
    results[0].toolCallId !== approval.toolCallId ||
    results[0].content !== expected ||
    results[0].error ||
    extra.some(
      (m) =>
        m.role === 'user' ||
        (m.role === 'assistant' &&
          m.toolCalls?.some(
            (c) =>
              c.id !== approval.toolCallId ||
              c.function.name !== 'reserve_campsite'
          ))
    ) ||
    !valid()
  )
    return;
  return Object.freeze({ transcript: s.transcript, result: expected });
}
