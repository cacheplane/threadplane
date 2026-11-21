import type { ClientToolResult } from './client-tools-capability';
import type { AnyFunctionToolDef } from './tool-def';

/** Durable identity for one client-tool execution on one thread. */
export interface ClientToolExecutionKey {
  readonly threadId: string;
  readonly toolCallId: string;
}

/** Prior durable execution state returned by a client-tool execution store. */
export type ClientToolExecutionRecord =
  | { readonly status: 'executing' }
  | { readonly status: 'done'; readonly result: ClientToolResult }
  | { readonly status: 'failed'; readonly result?: ClientToolResult };

/** Structural store contract for guarded browser client-tool execution. */
export interface ClientToolExecutionStore {
  /** Atomically claim a tool-call execution. Returns prior state when present. */
  claim(key: ClientToolExecutionKey): Promise<'claimed' | ClientToolExecutionRecord>;
  /** Record the final client-tool result for a claimed execution. */
  record(key: ClientToolExecutionKey, result: ClientToolResult): Promise<void>;
  /** Lookup prior execution states for pending tool calls on a thread. */
  lookup(
    threadId: string,
    toolCallIds: readonly string[],
  ): Promise<Record<string, ClientToolExecutionRecord>>;
}

/** Opt-in guard configuration for claim-before-execute client tools. */
export interface ClientToolExecutionGuard {
  readonly threadId: string;
  readonly store: ClientToolExecutionStore;
}

/** Return whether this function tool should claim before browser execution. */
export function shouldClaimBeforeExecute(def: AnyFunctionToolDef): boolean {
  return def.idempotent !== true;
}

/** Default fail-closed result for a stale in-progress client-tool execution. */
export function defaultInterruptedClientToolResult(toolCallId: string): ClientToolResult {
  return {
    ok: false,
    error: `client tool execution interrupted before completion: ${toolCallId}`,
  };
}

/** Result recorded when the user stops a run while a client tool is running. */
export function cancelledClientToolResult(toolCallId: string): ClientToolResult {
  return {
    ok: false,
    error: `client tool execution cancelled before completion: ${toolCallId}`,
  };
}

/** Default fail-closed result when the execution guard itself cannot be reached. */
export function clientToolGuardFailureResult(toolCallId: string, error: unknown): ClientToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: `client tool execution guard failed for ${toolCallId}: ${message}`,
  };
}
