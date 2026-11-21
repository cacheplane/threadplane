import type {
  AgentInterrupt,
  AgentSnapshot,
  AgentError,
  DeepReadonly,
  PlainValue,
  Message,
  ToolCall,
  ToolContract,
} from '@threadplane/core';
import type { LangGraphSubagent } from './subagent-projection.js';
import type { Interrupt, ThreadState } from '@langchain/langgraph-sdk';

/** Compact metadata from an explicitly loaded page, without repeated state data. */
export type LangGraphHistoryEntry = DeepReadonly<
  Pick<ThreadState, 'checkpoint' | 'parent_checkpoint' | 'created_at' | 'next'>
>;

/** An interrupt as the backend sent it: wire metadata and a plain payload,
 * with an id only when the backend supplied one. DeepReadonly maps the SDK's
 * unknown payload to PlainValue without recursively re-mapping PlainValue. */
export type LangGraphWireInterrupt = DeepReadonly<Interrupt>;

/**
 * A pending root interrupt. `id` is the name a `resume` response uses: the
 * backend's id when it sent one, `breakpoint` for a static breakpoint, and the
 * position (`interrupt-0`) otherwise. The wire metadata is kept alongside.
 */
export type LangGraphInterrupt = AgentInterrupt &
  Omit<LangGraphWireInterrupt, 'id' | 'value'>;

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
  /** The child graph's own tool calls, referenced by `Message.toolCallIds` in `messages`. */
  readonly toolCalls: readonly ToolCall[];
  /** A child graph's state. It is never checked against the session's declaration. */
  readonly state: LangGraphState | undefined;
  readonly interrupts: readonly LangGraphWireInterrupt[];
  readonly error?: AgentError;
}

/** What a publication supplies: the session derives `subagents` from `subgraphs`. */
export type LangGraphPublication = Omit<LangGraphSnapshot, 'subagents'>;

/** Backend-private extension; the core snapshot remains backend-independent. */
export type LangGraphSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = Omit<AgentSnapshot<TTools, TState>, 'interrupts' | 'subagents'> & {
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
  /**
   * The child graphs in `subgraphs` as the core contract's child agents, one
   * for each and in the same order.
   */
  readonly subagents: readonly LangGraphSubagent[];
};
