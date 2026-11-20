import type { PlainValue } from './tool.js';

/**
 * One thing a paused run is waiting on, such as an approval or a missing
 * answer. A run that paused reports its interrupts in the snapshot and settles
 * with the `'paused'` outcome; `resume` answers them.
 */
export interface AgentInterrupt {
  /** Names this interrupt in a response. Unique among the pending interrupts. */
  readonly id: string;
  /**
   * What the backend sent with the pause, as frozen plain data. Its shape
   * belongs to the agent that paused, so a view narrows it before rendering.
   */
  readonly value?: PlainValue;
  /** The kind of pause in the backend's own words, such as `tool_approval`. */
  readonly reason?: string;
  /** Display text the backend supplied for the person answering. */
  readonly message?: string;
  /** The tool call this pause is about, when the backend relates the two. */
  readonly toolCallId?: string;
  /**
   * `false` when the session can show this interrupt and cannot answer it
   * through `resume`. Absent means it is answered through `resume` whenever
   * the session has that command.
   */
  readonly resumable?: boolean;
}

/**
 * The answer to one pending interrupt. `resolved` continues the paused work
 * with `value`; `cancelled` declines it and carries no value.
 */
export type AgentInterruptResponse =
  | {
      readonly interruptId: string;
      readonly status: 'resolved';
      readonly value?: PlainValue;
    }
  | {
      readonly interruptId: string;
      readonly status: 'cancelled';
      readonly value?: never;
    };
