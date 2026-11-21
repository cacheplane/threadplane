import type { AgentError } from './error.js';
import type { Message } from './message.js';
import type { DeepReadonly, ToolCall, ToolContract } from './tool.js';
import type { AgentPlanStep } from './plan.js';
import type { AgentInterrupt } from './interrupt.js';
import type { AgentSubagent } from './subagent.js';

/**
 * Token counts for one model in one run, as the runtime reported them. Absent
 * means not reported, which is distinct from zero. Reasoning, cached and
 * cache-write counts are parts of the input and output totals, never additions.
 */
export interface AgentUsageEntry {
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
}

/** Usage for the most recent finished or failed run, one entry per provider and model. */
export interface AgentUsage {
  readonly entries: readonly AgentUsageEntry[];
}

/** Session execution state exposed alongside messages, tool calls, and an optional failure. */
export type AgentStatus = 'idle' | 'running' | 'error';

/** An immutable aggregate, owned by the session, stable between actual changes.
 * The conditional projects concrete shapes so interface-authored tools widen to
 * a generic observer without requiring an index signature on their arguments. */
export type AgentSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = TTools extends unknown
  ? {
      readonly status: AgentStatus;
      readonly messages: readonly Message[];
      readonly toolCalls: readonly ToolCall<TTools>[];
      readonly error?: AgentError;
      /** Steps the agent declared for its work, in order; absent when it declared none. */
      readonly plan?: readonly AgentPlanStep[];
      /** Token usage the runtime reported for the most recent settled run; absent while one runs or when none was reported. */
      readonly usage?: AgentUsage;
      /**
       * Application state the backend last reported, as frozen plain data.
       * Typed by the session's state declaration, and plain data without one.
       * Absent until the backend reports a state, and on sessions that hold none.
       */
      readonly state?: DeepReadonly<TState>;
      /**
       * What a paused run is waiting on. Empty or absent when nothing is
       * pending, and always absent on sessions that cannot pause.
       */
      readonly interrupts?: readonly AgentInterrupt[];
      /**
       * Child agents the root agent started, in start order. Absent on
       * sessions that report none.
       */
      readonly subagents?: readonly AgentSubagent[];
    }
  : never;
