import type { DebugAgentCheckpoint } from './debug-agent';
import type { DebugCheckpoint } from './debug-checkpoint-card.component';

export function toDebugCheckpoint(cp: DebugAgentCheckpoint, index: number): DebugCheckpoint {
  return {
    node: cp.label ?? `Step ${index + 1}`,
    checkpointId: cp.id,
  };
}

export function extractStateValues(cp: DebugAgentCheckpoint | undefined): Record<string, unknown> {
  return { ...cp?.values };
}
