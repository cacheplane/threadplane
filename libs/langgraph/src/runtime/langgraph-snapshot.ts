import type {
  AgentSnapshot,
  AgentError,
  DeepReadonly,
  PlainValue,
  Message,
  ToolContract,
} from '@threadplane/core';
import type { Interrupt, ThreadState } from '@langchain/langgraph-sdk';

/** Compact metadata from an explicitly loaded page, without repeated state data. */
export type LangGraphHistoryEntry = DeepReadonly<
  Pick<ThreadState, 'checkpoint' | 'parent_checkpoint' | 'created_at' | 'next'>
>;

/** Backend wire metadata and a plain payload. DeepReadonly maps the SDK's
 * unknown payload to PlainValue without recursively re-mapping PlainValue. */
export type LangGraphInterrupt = DeepReadonly<Interrupt>;

/** Graph state as the backend reported it, for a session that declares no state type. */
export type LangGraphState = Readonly<Record<string, PlainValue>>;

/** The snapshot's state: the declared type, or a plain record when none is declared. */
export type LangGraphSnapshotState<TState = unknown> = unknown extends TState
  ? LangGraphState
  : DeepReadonly<TState>;

/** Full-path child observations, with no execution or command authority. */
export interface LangGraphSubgraph {
  readonly namespace: readonly string[];
  readonly messages: readonly Message[];
  /** A child graph's state. It is never checked against the session's declaration. */
  readonly state: LangGraphState | undefined;
  readonly interrupts: readonly LangGraphInterrupt[];
  readonly error?: AgentError;
}

/** Backend-private extension; the core snapshot remains backend-independent. */
export type LangGraphSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = AgentSnapshot<TTools, TState> & {
  /** Last explicit history page; undefined until loaded. Not a live branch tree. */
  readonly history: readonly LangGraphHistoryEntry[] | undefined;
  /**
   * The graph state the backend last reported; undefined until one arrives.
   * With a schema declared, this is the last state that passed it.
   */
  readonly state: LangGraphSnapshotState<TState> | undefined;
  /**
   * What the declared schema rejected in the latest reported state. Present
   * only while `state` is being withheld at its last valid value.
   */
  readonly stateIssues?: readonly string[];
  readonly reconnect?: { readonly runId: string };
  readonly interrupts: readonly LangGraphInterrupt[];
  readonly subgraphs: readonly LangGraphSubgraph[];
};
