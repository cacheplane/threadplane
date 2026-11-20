import type { DebugAgentCheckpoint } from './debug-agent';
import type { DebugCheckpoint } from './debug-checkpoint-card.component';

/**
 * The timeline row for a checkpoint. `index` is the row's position in the
 * timeline, which lists newest first: a checkpoint without a label is named
 * `Step n` by that position.
 */
export function toDebugCheckpoint(cp: DebugAgentCheckpoint, index: number): DebugCheckpoint {
  return {
    node: cp.label ?? `Step ${index + 1}`,
    checkpointId: cp.id,
  };
}

export function extractStateValues(cp: DebugAgentCheckpoint | undefined): Record<string, unknown> {
  return { ...cp?.values };
}
