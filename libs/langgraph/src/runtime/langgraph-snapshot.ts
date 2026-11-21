import type {
  AgentInterrupt,
  AgentSnapshot,
  AgentError,
  DeepReadonly,
  PlainValue,
  Message,
  StreamingToolCall,
  ToolCall,
  ToolContract,
} from '@threadplane/core';
import type { LangGraphSubagent } from './subagent-projection.js';
import type { Interrupt, ThreadState } from '@langchain/langgraph-sdk';
import type {
  LangGraphBranchTree,
  LangGraphCheckpoint,
} from './checkpoint-tree.js';

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

/**
 * The root tool call that started a child graph. The middleware's binding
 * event states the relation; without one the session infers it from the task
 * text and from which calls are outstanding.
 */
export interface LangGraphDelegation {
  readonly toolCallId: string;
  /** The `subagent_type` the root agent asked for. */
  readonly name: string;
  /** The task the root agent gave the child, from the call's `description`. */
  readonly description?: string;
  /**
   * What the call itself says about the child: `complete` or `error` once the
   * call has a result, and `running` for a child restored from history whose
   * task is outstanding. Absent while only the child graph can tell.
   */
  readonly status?: 'running' | 'complete' | 'error';
}

/** Full-path child observations, with no execution or command authority. */
export interface LangGraphSubgraph {
  readonly namespace: readonly string[];
  readonly messages: readonly Message[];
  /** The child graph's own tool calls, referenced by `Message.toolCallIds` in `messages`. */
  readonly toolCalls: readonly ToolCall[];
  /** The child's tool calls whose arguments are still streaming; absent when none are. */
  readonly streamingToolCalls?: readonly StreamingToolCall[];
  /** A child graph's state. It is never checked against the session's declaration. */
  readonly state: LangGraphState | undefined;
  readonly interrupts: readonly LangGraphWireInterrupt[];
  readonly error?: AgentError;
  /** Present once the child is related to the root tool call that started it. */
  readonly delegation?: LangGraphDelegation;
}

/** A run the session created with `multitaskStrategy: 'enqueue'` and has not joined yet. */
export interface LangGraphQueuedRun {
  /** The backend's run id; `cancelQueued` takes it. */
  readonly id: string;
  /** The message the run was submitted with; absent for a run without one. */
  readonly message?: string;
  /** When the session queued it, in epoch milliseconds on this clock. */
  readonly createdAt: number;
}

/** Progress a running tool reported through the `tools` stream mode. */
export interface LangGraphToolProgress {
  readonly toolCallId?: string;
  readonly name: string;
  readonly state: 'starting' | 'running' | 'completed' | 'error';
  readonly input?: PlainValue;
  readonly data?: PlainValue;
  readonly result?: PlainValue;
  readonly error?: PlainValue;
}

/** A message as LangGraph sent it: the wire record, owned and frozen. */
export type LangGraphWireMessage = Readonly<Record<string, PlainValue>>;

/** What the stream said about one message, keyed by message id. */
export interface LangGraphMessageMetadata {
  readonly messageId: string;
  /** The `messages` stream metadata: `langgraph_node`, tags, the model and so on. */
  readonly streamMetadata: Readonly<Record<string, PlainValue>>;
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
> = Omit<
  AgentSnapshot<TTools, TState>,
  'interrupts' | 'subagents' | 'checkpoints'
> & {
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
  /**
   * The physical run the session lost its stream to and can still join with
   * `reconnect()`. Absent when there is none.
   */
  readonly retainedRun?: { readonly runId: string };
  readonly interrupts: readonly LangGraphInterrupt[];
  readonly subgraphs: readonly LangGraphSubgraph[];
  /**
   * The child graphs in `subgraphs` as the core contract's child agents, one
   * for each and in the same order.
   */
  readonly subagents: readonly LangGraphSubagent[];
  /**
   * The loaded history page with each checkpoint's state, oldest first, as
   * the core contract lists a history. Present only on a session created with
   * `historyState: true`: an empty list until a page has been read.
   */
  readonly checkpoints?: readonly LangGraphCheckpoint[];
  /** Assistant message id to the id of the checkpoint that ends with it. With `checkpoints`. */
  readonly messageCheckpoints?: Readonly<Record<string, string>>;
  /** `checkpoints` arranged by parent, splitting at each fork. With `checkpoints`. */
  readonly branchTree?: LangGraphBranchTree;
  /** The branch `setBranch` last selected; absent for the default branch. */
  readonly branch?: string;
  /** Progress of the tools running in the current run; absent when none reported. */
  readonly toolProgress?: readonly LangGraphToolProgress[];
  /**
   * The transcript's messages as LangGraph sent them, in transcript order.
   * Present only on a session created with `rawMessages: true`.
   */
  readonly langGraphMessages?: readonly LangGraphWireMessage[];
  /** Stream metadata by message id, root and child. With `langGraphMessages`. */
  readonly messageMetadata?: Readonly<Record<string, LangGraphMessageMetadata>>;
  /** True while a history read the session started is in flight; absent otherwise. */
  readonly loading?: true;
  /** Queued runs waiting for the active one, oldest first; absent when none wait. */
  readonly queue?: readonly LangGraphQueuedRun[];
};
