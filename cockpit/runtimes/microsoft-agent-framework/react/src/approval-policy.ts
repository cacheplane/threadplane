import type { Session } from '@threadplane/ag-ui';
export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
type Transcript = NativeSnapshot['transcript'];
export interface Expense {
  readonly vendor: string;
  readonly category: string;
  readonly amount_usd: number;
  readonly memo: string;
}
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: Transcript[number];
  readonly prefix: Transcript;
}
export interface ExpenseApproval {
  readonly threadId: string;
  readonly sourceRunId: string;
  /** Original opaque native occurrence; never reconstruct from observation data. */
  readonly pause: Parameters<Session['resume']>[0];
  readonly interruptId: string;
  readonly toolCallId: string;
  readonly expense: Expense;
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
export function validAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1e9 &&
    Math.round(value * 100) / 100 === value
  );
}
export function expenseValue(value: unknown): Expense | undefined {
  const e = record(value);
  if (
    !e ||
    Object.keys(e).some(
      (k) => !['vendor', 'category', 'amount_usd', 'memo'].includes(k)
    )
  )
    return;
  for (const key of ['vendor', 'category', 'memo'])
    if (
      typeof e[key] !== 'string' ||
      !(e[key] as string).trim() ||
      (e[key] as string).length > (key === 'memo' ? 4000 : 500)
    )
      return;
  if (!validAmount(e['amount_usd'])) return;
  return Object.freeze({
    vendor: e['vendor'] as string,
    category: e['category'] as string,
    amount_usd: e['amount_usd'],
    memo: e['memo'] as string,
  });
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
  const declarations = new Map<string, number>();
  rows.forEach((m, index) => {
    if (m.role === 'assistant')
      for (const call of m.toolCalls ?? []) declarations.set(call.id, index);
  });
  // Native metadata can authorize a pause without a redundant declaration.
  // When a declaration is present, its canonical result must follow it.
  if (
    rows.some(
      (m, index) =>
        m.role === 'tool' && (declarations.get(m.toolCallId) ?? -1) >= index
    )
  )
    return;
  return Object.freeze(rows);
}
function semantic(message: Transcript[number]) {
  return message.role === 'assistant' &&
    (message.content === '' || message.content === undefined)
    ? { ...message, content: '' }
    : message;
}
function history(past: Transcript, current: Transcript) {
  let cursor = 0;
  for (const message of current) {
    if (message.id !== past[cursor]?.id) continue;
    if (!same(semantic(past[cursor]), semantic(message))) return false;
    cursor++;
  }
  return cursor === past.length;
}
function declarationsAfterHuman(
  rows: Transcript,
  humanId: string,
  prefix: Transcript
) {
  const humanIndex = rows.findIndex((m) => m.id === humanId),
    earlier = new Set(submitCalls(prefix).map((c) => c.id));
  return (
    humanIndex >= 0 &&
    rows.every(
      (m, index) =>
        m.role !== 'assistant' ||
        (m.toolCalls ?? []).every(
          (c) => earlier.has(c.id) || index > humanIndex
        )
    )
  );
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
function nativeInterrupt(value: unknown, now: number) {
  const i = record(value);
  if (
    !i ||
    typeof i['id'] !== 'string' ||
    !i['id'] ||
    i['reason'] !== 'tool_call' ||
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
function callExpense(value: unknown, callId: string): Expense | undefined {
  const f = record(value),
    args = record(f?.['arguments']);
  if (
    !f ||
    f['call_id'] !== callId ||
    f['name'] !== 'submit_expense' ||
    !args ||
    Object.keys(args).length !== 1
  )
    return;
  return expenseValue(args['expense']);
}
function submitCalls(rows: Transcript) {
  return rows.flatMap((m) => (m.role === 'assistant' ? m.toolCalls ?? [] : []));
}
function argumentsMatch(value: string, expense: Expense) {
  try {
    return same(JSON.parse(value), { expense });
  } catch {
    return false;
  }
}
export function captureApproval(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid = () => true
): ExpenseApproval | undefined {
  const s = ownSnapshot(snapshot, valid),
    rows = s && rootRows(s);
  if (!s || !rows) return;
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
    !history([...turn.prefix, turn.human], rows) ||
    !declarationsAfterHuman(rows, turn.human.id, turn.prefix)
  )
    return;
  const i = nativeInterrupt(d.interrupts[0], Date.now()),
    end = nativeInterrupt(t.outcome.interrupts[0], Date.now());
  if (!i || !end || !same(i, end)) return;
  const meta = record(record(i['metadata'])?.['agent_framework']),
    expense = callExpense(meta?.['function_call'], i['toolCallId'] as string);
  if (!meta || meta['type'] !== 'function_approval_request' || !expense) return;
  if (meta['value'] !== undefined) {
    const value = record(meta['value']);
    if (
      !value ||
      value['type'] !== meta['type'] ||
      !same(value['function_call'], meta['function_call'])
    )
      return;
  }
  const calls = submitCalls(rows),
    matches = calls.filter((c) => c.id === i['toolCallId']);
  if (
    matches.length > 1 ||
    matches.some(
      (c) =>
        c.function.name !== 'submit_expense' ||
        !argumentsMatch(c.function.arguments, expense)
    ) ||
    calls.some(
      (c) =>
        c.function.name === 'submit_expense' &&
        c.id !== i['toolCallId'] &&
        !turn.prefix.some(
          (m) =>
            m.role === 'assistant' && m.toolCalls?.some((p) => p.id === c.id)
        )
    ) ||
    rows.some((m) => m.role === 'tool' && m.toolCallId === i['toolCallId']) ||
    rows.filter((m) => m.role === 'user').length !==
      turn.prefix.filter((m) => m.role === 'user').length + 1 ||
    !valid()
  )
    return;
  // PauseId is an immutable branded string. Retain the original value separately from the owned observation.
  try {
    const originalDecision = Object.getOwnPropertyDescriptor(
      snapshot,
      'decision'
    )?.value;
    if (!valid()) return;
    const pause =
      originalDecision &&
      (Object.getOwnPropertyDescriptor(originalDecision, 'id')
        ?.value as Parameters<Session['resume']>[0]);
    if (!valid() || pause !== d.id) return;
    return Object.freeze({
      threadId: turn.threadId,
      sourceRunId: turn.runId,
      pause,
      interruptId: i['id'] as string,
      toolCallId: i['toolCallId'] as string,
      expense,
      transcript: rows,
      observation: s,
    });
  } catch {
    return undefined;
  }
}
/** Prediction and unrelated child observations never change root decision authority. */
export function sameApproval(a: ExpenseApproval, b: ExpenseApproval): boolean {
  return (
    a.pause === b.pause &&
    a.threadId === b.threadId &&
    a.sourceRunId === b.sourceRunId &&
    a.interruptId === b.interruptId &&
    a.toolCallId === b.toolCallId &&
    same(a.expense, b.expense) &&
    same(a.transcript, b.transcript) &&
    same(a.observation.decision, b.observation.decision) &&
    same(a.observation.run, b.observation.run)
  );
}
export function confirmResume(
  snapshot: NativeSnapshot,
  approval: ExpenseApproval,
  runId: string,
  approved: boolean,
  valid = () => true
): { readonly transcript: Transcript; readonly result: string } | undefined {
  const s = ownSnapshot(snapshot, valid),
    rows = s && rootRows(s);
  if (
    !s ||
    !rows ||
    !runId ||
    runId === approval.sourceRunId ||
    s.status !== 'idle' ||
    s.decision ||
    s.run?.id !== runId ||
    s.run.outcome !== 'success'
  )
    return;
  const t = s.run.terminal;
  const humanIndex = approval.transcript.map((m) => m.role).lastIndexOf('user');
  if (
    t?.type !== 'RUN_FINISHED' ||
    record(t)?.['subagentRunId'] !== undefined ||
    t.threadId !== approval.threadId ||
    t.runId !== runId ||
    (t.outcome !== undefined && t.outcome.type !== 'success') ||
    (t.outcome?.type === 'success' && !!t.outcome.pendingToolCallIds?.length) ||
    !history(approval.transcript, rows) ||
    humanIndex < 0 ||
    !declarationsAfterHuman(
      rows,
      approval.transcript[humanIndex].id,
      approval.transcript.slice(0, humanIndex)
    )
  )
    return;
  const calls = submitCalls(rows).filter((c) => c.id === approval.toolCallId),
    results = rows.filter(
      (m) => m.role === 'tool' && m.toolCallId === approval.toolCallId
    );
  const e = approval.expense,
    expected = approved
      ? `Expense recorded: $${e.amount_usd.toFixed(2)} to ${e.vendor} (${
          e.category
        }) — queued for reimbursement.`
      : 'Error: Tool call invocation was rejected by user.';
  // A native approval may pause a batch before its read-only lookup resolves.
  // Only declarations already owned at the pause may gain a result on resume.
  const pending = submitCalls(approval.transcript).filter(
    (c) =>
      c.id !== approval.toolCallId &&
      !approval.transcript.some(
        (m) => m.role === 'tool' && m.toolCallId === c.id
      )
  );
  for (const call of pending) {
    try {
      if (
        call.function.name !== 'lookup_expense_policy' ||
        !same(JSON.parse(call.function.arguments), { category: e.category })
      )
        return;
    } catch {
      return;
    }
    const lookup = rows.filter(
      (m) => m.role === 'tool' && m.toolCallId === call.id
    );
    if (
      lookup.length !== 1 ||
      lookup[0].role !== 'tool' ||
      lookup[0].error ||
      typeof lookup[0].content !== 'string' ||
      !lookup[0].content.trim()
    )
      return;
  }
  if (
    calls.length !== 1 ||
    calls[0].function.name !== 'submit_expense' ||
    !argumentsMatch(calls[0].function.arguments, e) ||
    results.length !== 1 ||
    results[0].role !== 'tool' ||
    results[0].content !== expected ||
    results[0].error ||
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
    submitCalls(rows).some(
      (c) =>
        c.id !== approval.toolCallId &&
        !submitCalls(approval.transcript).some((p) => p.id === c.id)
    ) ||
    !valid()
  )
    return;
  return Object.freeze({ transcript: rows, result: results[0].content });
}
