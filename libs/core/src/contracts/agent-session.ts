import type { AgentSnapshot } from './agent-snapshot.js';
import type { CompleteOutcome } from './delivery.js';
import type { PlainValue, ToolContract } from './tool.js';

/** The initial neutral session supports text submission only. */
export type AgentSubmitInput = string;

/** Per-submission cancellation signal supplied by the caller. */
export interface AgentSubmitOptions {
  readonly signal?: AbortSignal;
}

/**
 * One application event a run emitted, such as LangGraph `custom` stream output
 * or an AG-UI `CUSTOM` event. Events are not state: no snapshot holds them, and
 * a listener added later does not receive earlier events. `data` is owned,
 * frozen plain data.
 */
export interface AgentSessionCustomEvent {
  readonly name: string;
  readonly data: PlainValue;
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
      /**
       * Optional: listens for custom events while runs stream. Returns an
       * idempotent release. A listener that throws does not affect the run or
       * other listeners. Nothing is delivered after disposal.
       */
      onCustomEvent?(
        listener: (event: AgentSessionCustomEvent) => void
      ): () => void;
      submit(
        input: AgentSubmitInput,
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome>;
      stop(): Promise<void>;
      /**
       * Optional: answers the prompt behind one assistant message again. Takes
       * that message's `id`; the earlier answer is replaced in the snapshot
       * once the new run starts. A session that cannot do this leaves the
       * command undefined, and callers offer no control for it. Rejects when
       * the message cannot be regenerated, such as during a run.
       */
      regenerate?(
        messageId: string,
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome>;
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
