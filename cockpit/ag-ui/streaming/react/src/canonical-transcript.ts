import type { Session, TextTranscriptRow } from '@threadplane/ag-ui';

export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: TextTranscriptRow;
  readonly prefix: readonly TextTranscriptRow[];
}

function ordinaryRows(
  transcript: NativeSnapshot['transcript'],
  valid: () => boolean
): readonly TextTranscriptRow[] | undefined {
  const rows: TextTranscriptRow[] = [];
  const identities = new Set<string>();
  for (const message of transcript) {
    if (!valid()) return;
    const { id, role, content, subagentRunId } = message;
    if (
      typeof id !== 'string' ||
      !id ||
      identities.has(id) ||
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      !content ||
      typeof subagentRunId === 'string' ||
      (role === 'assistant' && !!message.toolCalls?.length) ||
      !valid()
    )
      return;
    identities.add(id);
    rows.push(Object.freeze({ id, role, content }));
  }
  return valid() ? Object.freeze(rows) : undefined;
}

function same(left: TextTranscriptRow, right: TextTranscriptRow) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content
  );
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
  if (!valid() || decision || run?.legacyInterrupt || subagents.length) return;
  const rows = ordinaryRows(transcript, valid);
  return rows && valid() ? { status, run, rows } : undefined;
}

export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previousRunId: string | undefined,
  prefix: readonly TextTranscriptRow[],
  valid: () => boolean = () => true
): OwnedTurn | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'running' ||
    !state.run?.id ||
    state.run.id === previousRunId ||
    state.run.outcome !== undefined ||
    state.rows.length !== prefix.length + 1 ||
    !prefix.every((message, index) => same(message, state.rows[index])) ||
    !valid()
  )
    return;
  const human = state.rows.at(-1)!;
  if (human.role !== 'user' || !threadId || !valid()) return;
  return Object.freeze({
    threadId,
    runId: state.run.id,
    human,
    prefix: Object.freeze([...prefix]),
  });
}

export function confirmTranscript(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  valid: () => boolean = () => true
): readonly TextTranscriptRow[] | undefined {
  const state = read(snapshot, valid);
  if (
    !state ||
    state.status !== 'idle' ||
    state.run?.id !== turn.runId ||
    state.run.outcome !== 'success' ||
    !valid()
  )
    return;
  const terminal = state.run.terminal;
  if (
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.threadId !== turn.threadId ||
    terminal.runId !== turn.runId ||
    (terminal.outcome !== undefined && terminal.outcome.type !== 'success') ||
    (terminal.outcome?.type === 'success' &&
      !!terminal.outcome.pendingToolCallIds?.length) ||
    state.rows.length !== turn.prefix.length + 2 ||
    !turn.prefix.every((message, index) => same(message, state.rows[index])) ||
    !same(state.rows.at(-2)!, turn.human) ||
    state.rows.at(-1)!.role !== 'assistant' ||
    !valid()
  )
    return;
  return state.rows;
}
