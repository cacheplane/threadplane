import type { AgentError, AgentErrorDiagnostic } from './error.js';
import type { Message } from './message.js';
import type {
  DeepReadonly,
  StreamingToolCall,
  ToolCall,
  ToolContract,
} from './tool.js';
import type { AgentCheckpoint } from './checkpoint.js';
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

/**
 * Why a session refuses an ordinary submission for now, such as a pause that
 * must be answered or a recovery that must finish first. Commands that resolve
 * the block, such as `resume`, stay available.
 */
export interface AgentInputBlock {
  /** The cause in the backend's own words, such as `interrupt` or `reconciling`. */
  readonly reason: string;
  /** Display text for the person waiting, when the session supplies one. */
  readonly message?: string;
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
      /**
       * A plain-data description of what `error` was classified from, when the
       * session kept one. Present only with `error`. For logs and debug views:
       * a view shows the error's `message` and `detail`, never this.
       */
      readonly errorDiagnostic?: AgentErrorDiagnostic;
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
      /**
       * Tool calls the model is still writing, in the order they began. A call
       * leaves this list when its arguments are final and it enters
       * `toolCalls` under the same id. Absent on sessions that keep argument
       * fragments to themselves.
       */
      readonly streamingToolCalls?: readonly StreamingToolCall[];
      /**
       * Calls to client tools that wait for a result from the caller, answered
       * through `session.clientTools`. Each is also listed in `toolCalls`.
       * Absent on sessions without that capability.
       */
      readonly pendingClientTools?: readonly ToolCall<TTools>[];
      /**
       * The saved history the session last loaded, oldest first, each entry
       * with the state at that point. Absent until a history is loaded and on
       * sessions whose backend keeps none.
       */
      readonly checkpoints?: readonly AgentCheckpoint[];
      /**
       * For each assistant message `id`, the `id` of the checkpoint that first
       * held it. Absent when the session does not relate the two.
       */
      readonly messageCheckpoints?: Readonly<Record<string, string>>;
      /**
       * Present while the session refuses ordinary submissions; a view
       * disables its composer and may show why. Absent when `submit` is
       * accepted and on sessions that never refuse one for this reason.
       */
      readonly inputBlocked?: AgentInputBlock;
    }
  : never;
