import type { ChildCard, NativeSnapshot } from './children';
import { taskArguments } from './children';

export interface OwnedTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly human: Readonly<{ id: string; content: string }>;
  readonly prefix: NativeSnapshot['transcript'];
}
function same(
  left: unknown,
  right: unknown,
  valid: () => boolean,
  depth = 0
): boolean {
  if (!valid() || depth > 100) return false;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((item, index) => same(item, right[index], valid, depth + 1))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        same(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          valid,
          depth + 1
        )
    )
  );
}

/** Captures the native admission once; the confirmed prefix stays borrowed. */
export function captureTurn(
  snapshot: NativeSnapshot,
  threadId: string,
  previousRunId: string | undefined,
  prefix: NativeSnapshot['transcript'],
  text: string,
  valid: () => boolean
): OwnedTurn | undefined {
  if (
    !valid() ||
    snapshot.status !== 'running' ||
    !snapshot.run?.id ||
    snapshot.run.id === previousRunId ||
    snapshot.run.outcome !== undefined ||
    snapshot.transcript.length !== prefix.length + 1 ||
    !prefix.every((row, index) => same(row, snapshot.transcript[index], valid))
  )
    return;
  const human = snapshot.transcript.at(-1)!;
  if (
    !valid() ||
    human.role !== 'user' ||
    !human.id ||
    human.content !== text ||
    !threadId
  )
    return;
  return Object.freeze({
    threadId,
    runId: snapshot.run.id,
    human: Object.freeze({ id: human.id, content: text }),
    prefix,
  });
}

/** Confirms a borrowed canonical parent history; never prepares requests. */
export function confirmParent(
  snapshot: NativeSnapshot,
  turn: OwnedTurn,
  cards: readonly ChildCard[],
  valid: () => boolean = () => true
): NativeSnapshot['transcript'] | undefined {
  try {
    if (!valid()) return;
    const run = snapshot.run,
      transcript = snapshot.transcript,
      children = snapshot.subagents;
    if (
      !valid() ||
      snapshot.status !== 'idle' ||
      snapshot.decision ||
      run?.id !== turn.runId ||
      run.outcome !== 'success' ||
      run.legacyInterrupt ||
      run.terminal?.type !== 'RUN_FINISHED' ||
      run.terminal.threadId !== turn.threadId ||
      run.terminal.runId !== turn.runId ||
      (run.terminal.outcome && run.terminal.outcome.type !== 'success') ||
      (run.terminal.outcome?.type === 'success' &&
        run.terminal.outcome.pendingToolCallIds?.length) ||
      transcript.length > 500 ||
      transcript.length < turn.prefix.length + 2 ||
      !turn.prefix.every((message, index) =>
        same(message, transcript[index], valid)
      )
    )
      return;
    const human = transcript[turn.prefix.length];
    if (
      !valid() ||
      human.role !== 'user' ||
      human.id !== turn.human.id ||
      human.content !== turn.human.content
    )
      return;
    const ids = new Set<string>(),
      results = new Set<string>();
    const calls = new Map<
      string,
      Readonly<{ ownerId: string; role: string; current: boolean }>
    >();
    for (let index = 0; index < transcript.length; index++) {
      if (!valid()) return;
      const message = transcript[index];
      if (
        !message.id ||
        ids.has(message.id) ||
        typeof message.subagentRunId === 'string'
      )
        return;
      ids.add(message.id);
      if (message.role === 'user') {
        if (index > turn.prefix.length || typeof message.content !== 'string')
          return;
      } else if (message.role === 'assistant') {
        if (
          message.content !== undefined &&
          typeof message.content !== 'string'
        )
          return;
        for (const call of message.toolCalls ?? []) {
          const args = taskArguments(call.function.arguments);
          if (
            !call.id ||
            calls.has(call.id) ||
            call.function.name !== 'task' ||
            !args
          )
            return;
          calls.set(
            call.id,
            Object.freeze({
              ownerId: message.id,
              role: args.role,
              current: index > turn.prefix.length,
            })
          );
        }
      } else if (message.role === 'tool') {
        const call = calls.get(message.toolCallId);
        if (
          !call ||
          results.has(message.toolCallId) ||
          message.id !== message.toolCallId ||
          typeof message.content !== 'string' ||
          !message.content ||
          message.content.length > 65_536
        )
          return;
        results.add(message.toolCallId);
        if (call.current) {
          const matching = cards.filter(
            (card) =>
              card.callId === message.toolCallId && card.runId === turn.runId
          );
          if (matching.length !== 1) return;
          const card = matching[0];
          if (
            card.ownerId !== call.ownerId ||
            card.role !== call.role ||
            card.phase !== 'complete' ||
            card.answer !== message.content
          )
            return;
        }
      } else return;
    }
    if (calls.size !== results.size) return;
    const current = [...calls.entries()].filter(([, call]) => call.current);
    const currentCards = cards.filter((card) => card.runId === turn.runId);
    if (
      current.length !== currentCards.length ||
      current.length !== children.length
    )
      return;
    const seen = new Set<string>();
    for (const child of children) {
      if (!valid()) return;
      const start = child.started,
        terminal = child.terminal;
      const id = start.subagentRunId,
        callId = start.parentToolCallId;
      if (
        !callId ||
        id !== callId + '-sub' ||
        seen.has(id) ||
        start.parentSubagentRunId !== undefined
      )
        return;
      seen.add(id);
      const call = calls.get(callId);
      if (
        !call?.current ||
        call.role !== start.name ||
        (start.parentMessageId !== undefined &&
          start.parentMessageId !== call.ownerId) ||
        terminal?.type !== 'SUBAGENT_FINISHED' ||
        terminal.subagentRunId !== id ||
        terminal.outcome?.type !== 'success'
      )
        return;
      if (
        !currentCards.some(
          (card) =>
            card.id === id &&
            card.ownerId === call.ownerId &&
            card.callId === callId
        )
      )
        return;
    }
    const last = transcript.at(-1);
    if (
      !valid() ||
      last?.role !== 'assistant' ||
      last.toolCalls?.length ||
      typeof last.content !== 'string' ||
      !last.content.trim()
    )
      return;
    return transcript;
  } catch {
    return undefined;
  }
}
