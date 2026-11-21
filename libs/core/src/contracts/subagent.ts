import type { Message } from './message.js';
import type { ToolCall } from './tool.js';

/**
 * Where a child agent stands. `unknown` means the session saw it start and saw
 * no ending, and no run is active that could still report one.
 */
export type AgentSubagentStatus = 'running' | 'complete' | 'error' | 'unknown';

/**
 * A child agent the root agent started, with the transcript it produced. Its
 * messages and tool calls are held here and are not repeated in the root
 * snapshot's `messages` and `toolCalls`.
 */
export interface AgentSubagent {
  /** Stable for the life of the session. */
  readonly id: string;
  readonly name?: string;
  /** The task the child was given, in the root agent's words. */
  readonly description?: string;
  /** The root tool call that started this child, when the backend relates the two. */
  readonly toolCallId?: string;
  /** The `id` of the child that started this one; absent for a child of the root agent. */
  readonly parentId?: string;
  readonly status: AgentSubagentStatus;
  readonly messages: readonly Message[];
  /** The child's own tool calls, referenced by `Message.toolCallIds` in `messages`. */
  readonly toolCalls: readonly ToolCall[];
  /** Display text for the failure when `status` is `'error'` and the backend gave one. */
  readonly error?: string;
}
