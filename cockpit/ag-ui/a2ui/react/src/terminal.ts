import type { Session } from '@threadplane/ag-ui';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Private same-layout data leaf, copied into installed consumers.
import {
  closedFields,
  copyData,
  equalData,
  plainRecord,
} from '../../../../../libs/cockpit-a2ui-react/src/data.js';

export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
export interface OrdinaryMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}
export interface NativeIdentity {
  readonly owner: object;
  readonly generation: number;
  readonly runId: string;
  readonly human: OrdinaryMessage;
  readonly previous: readonly OrdinaryMessage[];
}
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
function ordinary(input: unknown): input is readonly OrdinaryMessage[] {
  if (!Array.isArray(input)) return false;
  const ids = new Set<string>();
  return input.every((row) => {
    if (
      !closedFields(row, [
        'id',
        'role',
        'content',
        'name',
        'toolCalls',
        'subagentRunId',
      ]) ||
      !plainRecord(row) ||
      !nonempty(row.id) ||
      ids.has(row.id) ||
      !['user', 'assistant'].includes(String(row.role)) ||
      typeof row.content !== 'string' ||
      (row.name !== undefined && typeof row.name !== 'string') ||
      (row.subagentRunId !== undefined && row.subagentRunId !== null) ||
      (row.toolCalls !== undefined &&
        (!Array.isArray(row.toolCalls) || row.toolCalls.length !== 0))
    )
      return false;
    ids.add(row.id);
    return true;
  });
}

/** Binds only the initial native publication; terminal success cannot invent identity. */
export function createNativeObservation(input: {
  readonly owner: object;
  readonly generation: number;
  readonly threadId: string;
  readonly message: string;
  readonly previous: unknown;
  readonly usedRunIds: readonly string[];
  readonly valid?: () => boolean;
}) {
  const { owner, generation, threadId, message } = input;
  const valid = input.valid ?? (() => true);
  let identity: NativeIdentity | undefined,
    invalid = false;
  let previous: readonly OrdinaryMessage[] = [],
    usedRunIds: readonly string[] = [];
  try {
    const captured = copyData(input.previous),
      ids = copyData(input.usedRunIds);
    if (
      !valid() ||
      !ordinary(captured) ||
      !Array.isArray(ids) ||
      !ids.every(nonempty) ||
      !nonempty(threadId) ||
      typeof message !== 'string' ||
      !Number.isSafeInteger(generation) ||
      generation < 1
    )
      invalid = true;
    else {
      previous = captured;
      usedRunIds = ids as readonly string[];
    }
  } catch {
    invalid = true;
  }
  function read(value: unknown) {
    if (invalid || !valid()) return;
    const state = copyData(value);
    if (
      !valid() ||
      !plainRecord(state) ||
      !Array.isArray(state.transcript) ||
      !Array.isArray(state.subagents) ||
      state.subagents.length ||
      state.decision ||
      state.error ||
      !['running', 'idle'].includes(String(state.status)) ||
      !plainRecord(state.run) ||
      !nonempty(state.run.id) ||
      state.run.legacyInterrupt ||
      (state.run.outcome !== undefined && state.run.outcome !== 'success')
    )
      return;
    return { state, run: state.run, transcript: state.transcript };
  }
  function matches(rows: readonly unknown[], captured: NativeIdentity) {
    return (
      rows.length >= previous.length + 1 &&
      equalData(rows.slice(0, previous.length), previous) &&
      equalData(rows[previous.length], captured.human) &&
      valid()
    );
  }
  return Object.freeze({
    observe(snapshot: unknown) {
      if (invalid || !valid()) return;
      try {
        const readout = read(snapshot);
        if (!readout) {
          invalid = true;
          return;
        }
        const { state, run, transcript } = readout;
        if (identity) {
          if (run.id !== identity.runId || !matches(transcript, identity))
            invalid = true;
          return;
        }
        const user = transcript[previous.length];
        if (
          state.status !== 'running' ||
          run.outcome !== undefined ||
          run.terminal !== undefined ||
          usedRunIds.includes(run.id as string) ||
          transcript.length !== previous.length + 1 ||
          !ordinary(transcript) ||
          !equalData(transcript.slice(0, previous.length), previous) ||
          !plainRecord(user) ||
          user.role !== 'user' ||
          user.content !== message ||
          !valid()
        ) {
          invalid = true;
          return;
        }
        identity = Object.freeze({
          owner,
          generation,
          runId: run.id as string,
          human: user as unknown as OrdinaryMessage,
          previous,
        });
      } catch {
        invalid = true;
      }
    },
    identity: () => (!invalid && valid() ? identity : undefined),
    confirm(
      outcome: unknown,
      snapshot: unknown
    ): readonly OrdinaryMessage[] | undefined {
      try {
        if (outcome !== 'success' || !identity) return;
        const readout = read(snapshot);
        if (!readout) return;
        const { state, run, transcript } = readout,
          terminal = run.terminal;
        if (
          state.status !== 'idle' ||
          run.id !== identity.runId ||
          run.outcome !== 'success' ||
          !plainRecord(terminal) ||
          terminal.type !== 'RUN_FINISHED' ||
          terminal.threadId !== threadId ||
          terminal.runId !== identity.runId ||
          !ordinary(transcript) ||
          transcript.length !== previous.length + 2 ||
          !matches(transcript, identity)
        )
          return;
        if (
          terminal.outcome !== undefined &&
          (!closedFields(terminal.outcome, ['type', 'pendingToolCallIds']) ||
            !plainRecord(terminal.outcome) ||
            terminal.outcome.type !== 'success' ||
            (terminal.outcome.pendingToolCallIds !== undefined &&
              (!Array.isArray(terminal.outcome.pendingToolCallIds) ||
                terminal.outcome.pendingToolCallIds.length)))
        )
          return;
        const last = transcript.at(-1);
        return last?.role === 'assistant' && last.content.trim() && valid()
          ? transcript
          : undefined;
      } catch {
        return;
      }
    },
  });
}
export type NativeObservation = ReturnType<typeof createNativeObservation>;
