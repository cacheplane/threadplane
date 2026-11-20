import type { Signal } from '@angular/core';

/** One point in the agent's saved history, as the timeline reads it. */
export interface DebugAgentCheckpoint {
  readonly id?: string;
  readonly label?: string;
  readonly values?: Readonly<Record<string, unknown>>;
}

/**
 * The members of the injected `Agent` the debug panel reads. Structural, so
 * the panel takes any agent without importing the chat entry point.
 */
export interface DebugAgent {
  messages: Signal<readonly unknown[]>;
  status: Signal<string>;
  error: Signal<unknown>;
  toolCalls: Signal<readonly unknown[]>;
  /** Application state the backend last reported; undefined until it reports one. */
  state: Signal<unknown>;
  /**
   * The saved history the agent last loaded, oldest first. Undefined until a
   * history is loaded and on backends that keep none.
   */
  checkpoints?: Signal<readonly DebugAgentCheckpoint[] | undefined>;
}

/** A debug agent whose history signal is known to exist. */
export interface DebugAgentWithHistory extends DebugAgent {
  checkpoints: Signal<readonly DebugAgentCheckpoint[] | undefined>;
}
