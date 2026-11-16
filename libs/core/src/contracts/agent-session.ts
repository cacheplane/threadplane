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
      /** Read-only reconciliation; never retries an uncertain submission. */
      checkStatus?(): Promise<void>;
      dispose(): Promise<void>;
    }
  : never;
