import type { Checkpoint } from '@langchain/langgraph-sdk';

/** SDK/history input shape; complete root routing is checked at capture. */
export type CheckpointReference = Readonly<
  Omit<Checkpoint, 'checkpoint_map'>
> & {
  readonly checkpoint_map?: Readonly<Record<string, unknown>> | null;
};
export type OwnedCheckpointPosition = {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map: Readonly<Record<string, string>>;
};

/** Shared wire routing only. Never copy arbitrary configurable metadata. */
export function captureCheckpoint(
  value: unknown,
  threadId: string
): OwnedCheckpointPosition {
  const invalid = () =>
    new Error('Checkpoint execution authority is unavailable.');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const input = value as Record<string, unknown>;
  const thread = input['thread_id'];
  const namespace = input['checkpoint_ns'];
  const id = input['checkpoint_id'];
  const map = input['checkpoint_map'];
  if (
    thread !== threadId ||
    !threadId.trim() ||
    namespace !== '' ||
    typeof id !== 'string' ||
    !id.trim()
  )
    throw invalid();
  let entries: [string, string][] = [];
  if (map !== undefined) {
    if (
      !map ||
      typeof map !== 'object' ||
      Array.isArray(map) ||
      (Object.getPrototypeOf(map) !== Object.prototype &&
        Object.getPrototypeOf(map) !== null)
    )
      throw invalid();
    entries = Object.entries(map).map(([key, value]) => {
      if (typeof value !== 'string') throw invalid();
      return [key, value];
    });
  }
  return Object.freeze({
    thread_id: threadId,
    checkpoint_ns: '',
    checkpoint_id: id,
    checkpoint_map: Object.freeze(Object.fromEntries(entries)),
  });
}
