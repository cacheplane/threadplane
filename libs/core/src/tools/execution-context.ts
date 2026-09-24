import type { PlainValue } from '../contracts/tool.js';

/** The owning session cancels this signal on stop, supersession, or disposal. */
export interface ExecutionContext {
  readonly signal: AbortSignal;
}

export type ToolExecutionResult =
  | { readonly ok: true; readonly value: PlainValue }
  | { readonly ok: false; readonly error: string };

export interface ToolExecutionKey {
  readonly threadId: string;
  readonly toolCallId: string;
}

export type ToolExecutionAcquisition =
  | { readonly status: 'acquired'; readonly token: string }
  | { readonly status: 'complete'; readonly result: string }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' };

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
