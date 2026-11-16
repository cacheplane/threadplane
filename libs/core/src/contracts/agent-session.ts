import type { AgentSnapshot } from './agent-snapshot.js';
import type { CompleteOutcome } from './delivery.js';
import type { ToolContract } from './tool.js';

/** The initial neutral session supports text submission only. */
export type AgentSubmitInput = string;

/** Per-submission cancellation signal supplied by the caller. */
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
      /**
       * Optional: sends the last failed submission again, including a resume
       * that carried no message, and resolves with the re-run's outcome.
       * Appends no second user message. Resolves `'aborted'` without sending
       * while a request runs or when nothing failed. Only an error whose
       * `recovery` is `'retry'` can be retried; for any other, such as one
       * whose backend outcome is uncertain, it rejects without sending.
       */
      retry?(): Promise<CompleteOutcome>;
    }
  : never;
