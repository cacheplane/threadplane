import type { ConfirmedCheckpoint } from './checkpoint-authority';

/** Position belongs to one session branch owner; physical run evidence remains
 * in the existing attempt. An in-flight checkpoint can authorize no new effect. */
export type CheckpointState =
  | { readonly kind: 'ready'; readonly confirmed: ConfirmedCheckpoint }
  | { readonly kind: 'run-inflight' | 'write-inflight' | 'uncertain' };

export interface CheckpointOwner {
  state: CheckpointState;
  readonly baselineCallIds: readonly string[];
  /** Only executeTool's settled outcomes in this owner establish this proof.
   * Wire history, presentation, and provisional stop cancellation do not. */
  readonly settledToolIds: Set<string>;
}

export function readyCheckpoint(state: CheckpointState): ConfirmedCheckpoint {
  if (state.kind !== 'ready')
    throw new Error('Checkpoint execution authority is unavailable.');
  return state.confirmed;
}

export function beginCheckpointEffect(
  state: CheckpointState,
  effect: 'run' | 'write'
): CheckpointState {
  readyCheckpoint(state);
  return { kind: effect === 'run' ? 'run-inflight' : 'write-inflight' };
}

export function uncertainCheckpoint(state: CheckpointState): CheckpointState {
  return state.kind === 'uncertain' || state.kind === 'ready'
    ? state
    : { kind: 'uncertain' };
}
