import type { PlainValue } from '../contracts/tool.js';

/** The owning session cancels this signal on stop, supersession, or disposal. */
export interface ExecutionContext {
  readonly signal: AbortSignal;
}

/** Settled tool outcome containing either a portable result value or a displayable error string. */
export type ToolExecutionResult =
  | { readonly ok: true; readonly value: PlainValue }
  | { readonly ok: false; readonly error: string };

/** Stable execution-store identity combining a thread with its tool call ID. */
export interface ToolExecutionKey {
  readonly threadId: string;
  readonly toolCallId: string;
}

/** Store acquisition outcome: execution authority, an encoded cached result, unavailable ownership, or an invocation conflict. */
export type ToolExecutionAcquisition =
  | { readonly status: 'acquired'; readonly token: string }
  | { readonly status: 'complete'; readonly result: string }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' };

/** Settlement for an acquired invocation, carrying its ownership token and a reusable encoded result or null. */
export interface ToolExecutionSettlement {
  readonly invocation: string;
  readonly token: string;
  /** Exact encoded completion, or null when the result cannot be reused. */
  readonly result: string | null;
}

/** Atomically bind a stable identity to its invocation and one execution owner.
 * Only the acquired token can settle; observers never receive that authority. */
export interface ToolExecutionStore {
  acquire(
    key: ToolExecutionKey,
    invocation: string
  ): Promise<ToolExecutionAcquisition>;
  settle(
    key: ToolExecutionKey,
    settlement: ToolExecutionSettlement
  ): Promise<'accepted' | 'rejected'>;
}

/** Reported when the continuation limit blocks a group of client-tool calls. */
export interface ClientToolContinuationLimitEvent {
  readonly maxTurns: number;
  /** The 1-based number of the group that was blocked. */
  readonly attemptedTurn: number;
  readonly toolCallIds: readonly string[];
  readonly toolNames: readonly string[];
}

/** How many consecutive client-tool groups one submit may run automatically. */
export interface ClientToolContinuationPolicy {
  /** Groups per submit. Default 10; 0 removes the limit. A non-negative integer. */
  readonly maxTurns?: number;
  /** Called once when the limit blocks a group. A throwing callback is ignored. */
  readonly onLimit?: (event: ClientToolContinuationLimitEvent) => void;
}
