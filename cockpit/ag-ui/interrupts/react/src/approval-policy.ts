import type { Session, TextTranscriptRow } from '@threadplane/ag-ui';
export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: TextTranscriptRow;
  readonly prefix: readonly TextTranscriptRow[];
}
export interface RefundApproval {
  readonly threadId: string;
  readonly sourceRunId: string;
  readonly pause: Parameters<Session['resume']>[0];
  readonly interruptId: string;
  readonly amount: number;
  readonly customerId: string;
  readonly reason: string;
  readonly rows: readonly TextTranscriptRow[];
}
function same(left: TextTranscriptRow, right: TextTranscriptRow) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content
  );
}
function ordinaryRows(
  transcript: NativeSnapshot['transcript'],
  valid: () => boolean
) {
  const rows: TextTranscriptRow[] = [],
    ids = new Set<string>();
  for (const message of transcript) {
    if (!valid()) return;
    const { id, role, content, subagentRunId } = message;
    if (
      typeof id !== 'string' ||
      !id ||
      ids.has(id) ||
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      !content ||
      typeof subagentRunId === 'string' ||
      (role === 'assistant' && !!message.toolCalls?.length) ||
      !valid()
    )
      return;
    ids.add(id);
    rows.push(Object.freeze({ id, role, content }));
  }
  return valid() ? Object.freeze(rows) : undefined;
}
function read(snapshot: NativeSnapshot, valid: () => boolean) {
  if (!valid()) return;
  const status = snapshot.status;
  if (!valid()) return;
  const run = snapshot.run;
  if (!valid()) return;
  const decision = snapshot.decision;
  if (!valid()) return;
  const subagents = snapshot.subagents;
  if (!valid()) return;
  const transcript = snapshot.transcript;
  if (!valid() || run?.legacyInterrupt || subagents.length) return;
  const rows = ordinaryRows(transcript, valid);
  return rows && valid() ? { status, run, decision, rows } : undefined;
}
export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previous: string | undefined,
  prefix: readonly TextTranscriptRow[],
  valid = () => true
): OwnedTurn | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'running' ||
    state.decision ||
    !state.run?.id ||
    state.run.id === previous ||
    state.run.outcome !== undefined ||
    !threadId ||
    state.rows.length !== prefix.length + 1 ||
    !prefix.every((row, index) => same(row, state.rows[index])) ||
    !valid()
  )
    return;
  const human = state.rows.at(-1)!;
  if (human.role !== 'user' || !valid()) return;
  return Object.freeze({
    threadId,
    runId: state.run.id,
    human,
    prefix: Object.freeze([...prefix]),
  });
}
/** Read own data fields only; borrowed protocol objects are never frozen. */
function data(value: unknown, key: string): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    return;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function refund(interrupt: unknown, now: number) {
  const id = data(interrupt, 'id'),
    expiry = data(interrupt, 'expiresAt'),
    child = data(interrupt, 'subagentRunId');
  if (
    child !== undefined ||
    typeof id !== 'string' ||
    !id ||
    (expiry !== undefined &&
      (typeof expiry !== 'string' ||
        !Number.isFinite(Date.parse(expiry)) ||
        Date.parse(expiry) <= now))
  )
    return;
  const raw = data(data(data(interrupt, 'metadata'), 'langgraph'), 'raw');
  const kind = data(raw, 'kind'),
    amount = data(raw, 'amount'),
    customerId = data(raw, 'customer_id'),
    reason = data(raw, 'reason');
  if (
    kind !== 'refund_approval' ||
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof customerId !== 'string' ||
    !customerId.trim() ||
    typeof reason !== 'string' ||
    !reason.trim()
  )
    return;
  return { id, amount, customerId, reason };
}
export function captureApproval(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid = () => true
): RefundApproval | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'idle' ||
    state.run?.id !== turn.runId ||
    state.run.outcome !== 'paused' ||
    !valid()
  )
    return;
  const decision = state.decision,
    terminal = state.run.terminal;
  if (
    decision?.kind !== 'native' ||
    !decision.id ||
    decision.attempt ||
    decision.sourceRunId !== turn.runId ||
    decision.interrupts.length !== 1 ||
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.threadId !== turn.threadId ||
    terminal.runId !== turn.runId ||
    terminal.outcome?.type !== 'interrupt' ||
    terminal.outcome.interrupts.length !== 1 ||
    state.rows.length !== turn.prefix.length + 2 ||
    !turn.prefix.every((row, index) => same(row, state.rows[index])) ||
    !same(state.rows.at(-2)!, turn.human) ||
    state.rows.at(-1)!.role !== 'assistant' ||
    !valid()
  )
    return;
  const now = Date.now();
  const selected = refund(decision.interrupts[0], now),
    finished = refund(terminal.outcome.interrupts[0], now);
  if (
    !selected ||
    !finished ||
    selected.id !== finished.id ||
    selected.amount !== finished.amount ||
    selected.customerId !== finished.customerId ||
    selected.reason !== finished.reason ||
    !valid()
  )
    return;
  return Object.freeze({
    threadId: turn.threadId,
    sourceRunId: turn.runId,
    pause: decision.id,
    interruptId: selected.id,
    amount: selected.amount,
    customerId: selected.customerId,
    reason: selected.reason,
    rows: state.rows,
  });
}
export function confirmResume(
  snapshot: NativeSnapshot,
  approval: RefundApproval,
  runId: string,
  valid = () => true
): readonly TextTranscriptRow[] | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    !runId ||
    runId === approval.sourceRunId ||
    state.status !== 'idle' ||
    state.decision ||
    state.run?.id !== runId ||
    state.run.outcome !== 'success' ||
    !valid()
  )
    return;
  const terminal = state.run.terminal;
  if (
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.threadId !== approval.threadId ||
    terminal.runId !== runId ||
    (terminal.outcome !== undefined && terminal.outcome.type !== 'success') ||
    (terminal.outcome?.type === 'success' &&
      !!terminal.outcome.pendingToolCallIds?.length) ||
    state.rows.length !== approval.rows.length + 1 ||
    !approval.rows.every((row, index) => same(row, state.rows[index])) ||
    state.rows.at(-1)!.role !== 'assistant' ||
    !valid()
  )
    return;
  return state.rows;
}
