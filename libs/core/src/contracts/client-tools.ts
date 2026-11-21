import type { PlainValue } from './tool.js';

/** One client tool as the model sees it: a name, a description and a JSON Schema for its arguments. */
export interface ClientToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments, as plain data. */
  readonly parameters: Readonly<Record<string, PlainValue>>;
}

/** What running a client tool produced: a value, or display text for a failure. */
export type ClientToolResult =
  | { readonly ok: true; readonly value: PlainValue }
  | { readonly ok: false; readonly error: string };

/**
 * Optional session capability for tools the caller declares and runs itself,
 * after the session exists. The calls waiting for a result are listed in the
 * snapshot's `pendingClientTools`; this object carries only the commands.
 *
 * A session created with a fixed handler map runs its tools itself and may
 * leave this capability undefined.
 */
export interface AgentClientTools {
  /**
   * Replaces the catalog sent to the model with each later run. May be called
   * any number of times; an empty list declares no tools.
   */
  setCatalog(specs: readonly ClientToolSpec[]): void;
  /**
   * Optional: records one call's result without continuing the run. The call
   * leaves `pendingClientTools`. Throws when no pending call has that id.
   */
  settle?(toolCallId: string, result: ClientToolResult): void;
  /**
   * Optional: makes every result recorded through `settle` durable on the
   * backend without continuing the run. Does nothing on a session whose
   * `settle` is already durable. A session that buffers results clears the
   * buffer only after a successful write, so a failure leaves them for a later
   * flush or submission.
   */
  flush?(): void | Promise<void>;
  /**
   * Records one call's result and continues the run. Throws when no pending
   * call has that id.
   */
  resolve(toolCallId: string, result: ClientToolResult): void;
}
