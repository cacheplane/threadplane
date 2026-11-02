import type { Signal } from '@angular/core';
import type { Message } from './message';
import type { ToolCall } from './tool-call';

/** The execution state of a subagent spawned by a tool call. */
export type SubagentStatus = 'pending' | 'running' | 'complete' | 'error';

/** Reactive messages, state, and execution status for a subagent spawned by a tool call. */
export interface Subagent {
  /** Tool call ID that spawned this subagent. */
  toolCallId: string;
  /** Optional human-readable name. */
  name?: string;
  status: Signal<SubagentStatus>;
  messages: Signal<Message[]>;
  /**
   * The subagent's own tool calls (name/args/result), referenced by
   * `Message.toolCallIds` in `messages`. Optional: adapters that don't surface
   * subagent tool calls omit it; consumers default to `[]`.
   */
  toolCalls?: Signal<ToolCall[]>;
  state: Signal<Record<string, unknown>>;
}
