import type { AgentSnapshot } from './agent-snapshot.js';
import type { AgentClientTools } from './client-tools.js';
import type { ContentBlock } from './content-block.js';
import type { CompleteOutcome } from './delivery.js';
import type { AgentInterruptResponse } from './interrupt.js';
import type { AgentStateUpdate } from './state.js';
import type { PlainValue, ToolContract } from './tool.js';

/**
 * What a caller submits: the message text, or the text with structured
 * content, a partial state the backend merges before the run, or both.
 *
 * `blocks` sends the message as structured content, such as an image with a
 * caption; `message` is then the text shown where blocks are not rendered
 * (see `contentBlocksText`). A session that holds no state ignores `state`,
 * and a session that cannot send blocks rejects them without sending. A
 * submission always carries a message; `run` starts one without.
 */
export type AgentSubmitInput<TState = unknown> =
  | string
  | {
      readonly message: string;
      readonly blocks?: readonly ContentBlock[];
      readonly state?: AgentStateUpdate<TState>;
    };

/** Per-submission cancellation signal supplied by the caller. */
export interface AgentSubmitOptions {
  readonly signal?: AbortSignal;
}

/**
 * Options for `resume`: the cancellation signal, and what a caller may send in
 * the same request as the answers. `state` is merged before the paused work
 * continues, and `message` or `blocks` appends a user message, as in `submit`.
 * A session that cannot combine them with a resume rejects without sending.
 */
export type AgentResumeOptions<TState = unknown> = AgentSubmitOptions & {
  readonly message?: string;
  readonly blocks?: readonly ContentBlock[];
  readonly state?: AgentStateUpdate<TState>;
};

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
  >,
  TState = unknown
> = TTools extends unknown
  ? {
      getSnapshot(): AgentSnapshot<TTools, TState>;
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
        input: AgentSubmitInput<TState>,
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome>;
      /**
       * Optional: runs the agent on the conversation as it stands, appending
       * no user message, after merging `input.state` when given. Used to
       * apply a state change or to continue after tool results. A session
       * that needs a message for every run leaves the command undefined.
       */
      run?(
        input?: { readonly state?: AgentStateUpdate<TState> },
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
      /**
       * Optional: answers interrupts the snapshot lists and continues the
       * paused work, resolving with the continued run's outcome. Each response
       * names one pending interrupt by `id`. Rejects without sending when a
       * response names an interrupt that is not pending, names one twice, or
       * uses a status the backend cannot express; whether every pending
       * interrupt must be answered at once is the backend's rule. A session
       * that cannot pause leaves the command undefined.
       */
      resume?(
        responses: readonly AgentInterruptResponse[],
        options?: AgentResumeOptions<TState>
      ): Promise<CompleteOutcome>;
      /**
       * Optional: tools the caller declares and runs itself after the session
       * exists. The calls waiting for a result are in the snapshot's
       * `pendingClientTools`.
       */
      readonly clientTools?: AgentClientTools;
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

/** The custom event name a backend uses to publish values for a generated-UI render store. */
const STATE_UPDATE_EVENT = 'state_update';

/**
 * Reads a render-store update from a custom event: the data of an event named
 * `state_update` when that data is an object, and undefined for anything else.
 * Each key is a path in the render store and each value replaces what is there.
 */
export function agentStateUpdateFromEvent(
  event: AgentSessionCustomEvent
): Readonly<Record<string, PlainValue>> | undefined {
  const { data } = event;
  return event.name === STATE_UPDATE_EVENT &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data)
    ? (data as Readonly<Record<string, PlainValue>>)
    : undefined;
}

/**
 * Follows the render-store updates a session's runs emit, for a generated-UI
 * render store. Built on `onCustomEvent`: the listener receives the data of
 * each `state_update` event. Returns an idempotent release, and an inert one
 * for a session without `onCustomEvent`. Like every custom event, an update is
 * not state: nothing replays the ones sent before the listener was added.
 */
export function onAgentStateUpdate(
  session: {
    onCustomEvent?(
      listener: (event: AgentSessionCustomEvent) => void
    ): () => void;
  },
  listener: (update: Readonly<Record<string, PlainValue>>) => void
): () => void {
  if (!session.onCustomEvent) return () => undefined;
  return session.onCustomEvent((event) => {
    const update = agentStateUpdateFromEvent(event);
    if (update) listener(update);
  });
}
