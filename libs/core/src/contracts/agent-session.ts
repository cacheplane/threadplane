import type { AgentSnapshot } from './agent-snapshot.js';
import type { CompleteOutcome } from './delivery.js';
import type { ToolContract } from './tool.js';

/** The initial neutral session supports text submission only. */
export type AgentSubmitInput = string;

export interface AgentSubmitOptions {
  readonly signal?: AbortSignal;
}

/** Explicit owner of execution; observing and releasing a subscription are inert.
 * The conditional preserves structural widening of authored tool sessions. */
export type AgentSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = TTools extends unknown
  ? {
      getSnapshot(): AgentSnapshot<TTools>;
      /** Changes only. Read the initial aggregate through getSnapshot. */
      subscribe(notify: () => void): () => void;
      submit(
        input: AgentSubmitInput,
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome>;
      stop(): Promise<void>;
      /** Read-only reconciliation; never retries an uncertain submission. */
      checkStatus?(): Promise<void>;
      dispose(): Promise<void>;
    }
  : never;
