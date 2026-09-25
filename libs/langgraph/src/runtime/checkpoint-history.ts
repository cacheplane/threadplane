import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import type { LangGraphHistoryEntry } from './langgraph-snapshot.js';
import { ownValueWithSharing } from './ownership.js';

/** Preserve the received page, including order and missing/duplicate ids. Select
 * metadata before ownership so older values/tasks are neither read nor retained. */
export function projectCheckpointHistory(
  previous: readonly LangGraphHistoryEntry[] | undefined,
  history: readonly ThreadState[]
): readonly LangGraphHistoryEntry[] {
  return ownValueWithSharing(
    history.map(({ checkpoint, parent_checkpoint, created_at, next }) => ({
      checkpoint,
      parent_checkpoint,
      created_at,
      next,
    })) as PlainValue,
    previous as PlainValue
  ) as readonly LangGraphHistoryEntry[];
}
