import type { StateDeltaEvent, StateSnapshotEvent } from '@ag-ui/client';
import type { PlainValue } from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data';
import { applyPatch, type JsonPatchOp } from '../lib/internal/apply-patch';

/** Captures the literal state graph without schema interpretation. */
export function ownState(value: unknown): PlainValue {
  return copyData(value, true) as PlainValue;
}

/** Each request owns a fresh mutable graph; JSON transport is a separate policy. */
export function requestState(value: PlainValue): unknown {
  return copyData(value, false);
}

/** Previous is already owned. Changed results are captured in full, in O(N). */
export function applyState(
  previous: PlainValue,
  event: StateSnapshotEvent | StateDeltaEvent
): PlainValue {
  if (event.type === 'STATE_SNAPSHOT') return ownState(event.snapshot);
  const operations = copyData(event.delta, false);
  const next = applyPatch(previous, operations as readonly JsonPatchOp[]);
  return Object.is(next, previous) ? previous : ownState(next);
}
