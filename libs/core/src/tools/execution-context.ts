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

export type ToolExecutionRecord =
  | { readonly status: 'executing' }
  | { readonly status: 'done'; readonly result: ToolExecutionResult }
  | { readonly status: 'failed'; readonly result?: ToolExecutionResult };

/** Optional structural durability guard. The session supplies its fixed thread.
 * claim must be atomic. Existing executing records fail closed; only a newly
 * claimed call may invoke a side effect. record precedes local settlement. */
export interface ToolExecutionStore {
  claim(key: ToolExecutionKey): Promise<'claimed' | ToolExecutionRecord>;
  record(key: ToolExecutionKey, result: ToolExecutionResult): Promise<void>;
}
