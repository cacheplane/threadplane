import type { AgentError } from './error.js';
import type { Message } from './message.js';
import type { ToolCall, ToolContract } from './tool.js';

export type AgentStatus = 'idle' | 'running' | 'error';

/** An immutable aggregate, owned by the session, stable between actual changes.
 * The conditional projects concrete shapes so interface-authored tools widen to
 * a generic observer without requiring an index signature on their arguments. */
export type AgentSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = TTools extends unknown
  ? {
      readonly status: AgentStatus;
      readonly messages: readonly Message[];
      readonly toolCalls: readonly ToolCall<TTools>[];
      readonly error?: AgentError;
    }
  : never;
