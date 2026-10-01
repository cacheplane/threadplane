import type { ToolCall } from '../agent/tool-call';

/** Inputs for {@link selectPendingClientToolCalls}. */
export interface SelectPendingClientToolCallsInput {
  /** Whether the agent is currently streaming a run. Pending client tools are hidden while loading. */
  isLoading: boolean;
  /** Tool calls observed from the current agent state. */
  toolCalls: readonly ToolCall[];
  /** Client-declared tool names that should be handled in the browser. */
  catalogNames: ReadonlySet<string>;
  /** Tool-call ids already resolved by the local client instance. */
  resolvedIds: ReadonlySet<string>;
  /**
   * Tool-call ids the runtime itself declared unanswered at the end of the
   * run (AG-UI 1.0 `outcome.pendingToolCallIds`). When present it is the
   * authority: a call outside it is not pending even if it has no result.
   */
  authoritativeIds?: ReadonlySet<string>;
}

/** Select client tool calls that are ready for browser-side resolution. */
export function selectPendingClientToolCalls(
  input: SelectPendingClientToolCallsInput,
): readonly ToolCall[] {
  if (input.isLoading) return [];
  return input.toolCalls.filter(
    (tc) =>
      input.catalogNames.has(tc.name) &&
      tc.result === undefined &&
      !input.resolvedIds.has(tc.id) &&
      (input.authoritativeIds === undefined || input.authoritativeIds.has(tc.id)),
  );
}
