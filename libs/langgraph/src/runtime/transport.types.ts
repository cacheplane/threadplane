import type {
  Checkpoint,
  Command,
  Config,
  Metadata,
  Run,
  StreamMode,
  ThreadState,
} from '@langchain/langgraph-sdk';
import type { OwnedCheckpointPosition } from '../lib/transport/checkpoint-position.d.ts';
export type { OwnedCheckpointPosition } from '../lib/transport/checkpoint-position.d.ts';

/** An event emitted by a LangGraph stream. */
export interface StreamEvent {
  /** Event type identifier (e.g., 'values', 'messages', 'error', 'interrupt'). */
  type:
    | 'values'
    | `values|${string}`
    | 'messages'
    | `messages|${string}`
    | `messages/${string}`
    | `messages/${string}|${string}`
    | 'updates'
    | `updates|${string}`
    | 'tools'
    | `tools|${string}`
    | 'custom'
    | `custom|${string}`
    | 'error'
    | `error|${string}`
    | 'metadata'
    | 'checkpoints'
    | `checkpoints|${string}`
    | 'tasks'
    | `tasks|${string}`
    | 'debug'
    | `debug|${string}`
    | 'events'
    | `events|${string}`
    | 'interrupt'
    | 'interrupts';
  /** @internal Reserved SDK SSE cursor; application payloads cannot supply it. */
  sseId?: string;
  namespace?: string[];
  messages?: unknown[];
  messageMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Strategy for handling concurrent LangGraph runs on the same thread. */
export type LangGraphMultitaskStrategy =
  | 'reject'
  | 'interrupt'
  | 'rollback'
  | 'enqueue';

export type LangGraphDurability = 'exit' | 'async' | 'sync';
export type LangGraphOnCompletion = 'complete' | 'continue';
export type LangGraphOnDisconnect = 'cancel' | 'continue';

/** Options accepted by LangGraph-backed submit calls. */
export interface LangGraphSubmitOptions {
  signal?: AbortSignal;
  config?: Config;
  context?: unknown;
  checkpoint?: Omit<Checkpoint, 'thread_id'> | null;
  checkpointId?: string;
  command?: Command;
  metadata?: Metadata;
  checkpointDuring?: boolean;
  durability?: LangGraphDurability;
  interruptBefore?: '*' | string[];
  interruptAfter?: '*' | string[];
  onCompletion?: LangGraphOnCompletion;
  webhook?: string;
  onDisconnect?: LangGraphOnDisconnect;
  afterSeconds?: number;
  ifNotExists?: 'create' | 'reject';
  onRunCreated?: (params: { run_id: string; thread_id?: string }) => void;
  streamMode?: StreamMode[];
  streamSubgraphs?: boolean;
  streamResumable?: boolean;
  feedbackKeys?: string[];
  /** Convenience alias normalized to `command.resume` before invoking LangGraph. */
  resume?: unknown;
  /** Strategy for handling concurrent runs on the same thread. */
  multitaskStrategy?: LangGraphMultitaskStrategy;
}

/** A queued server-side LangGraph run. */
export interface AgentQueueEntry<T = unknown> {
  /** Server-side run ID. */
  id: string;
  /** Thread that owns the queued run. */
  threadId: string;
  /** Values submitted for the queued run. */
  values: T | null | undefined;
  /** Submit options used when the queued run was created. */
  options?: LangGraphSubmitOptions;
  /** Timestamp when the queued run was registered locally. */
  createdAt: Date;
}

/** Public queue surface for pending server-side LangGraph runs. */
export interface AgentQueue<T = unknown> {
  /** Read-only pending queue entries. */
  readonly entries: ReadonlyArray<AgentQueueEntry<T>>;
  /** Number of pending queue entries. */
  readonly size: number;
  /** Cancel a specific pending run by server run ID. */
  cancel: (id: string) => Promise<boolean>;
  /** Cancel all pending runs and clear the queue. */
  clear: () => Promise<void>;
}

/** Transport interface for connecting to a LangGraph agent. */
export interface AgentTransport {
  /** Open a streaming connection to an agent and yield events. */
  stream(
    assistantId: string,
    threadId: string | null,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions
  ): AsyncIterable<StreamEvent>;

  /** Optional: join an already-started run without creating a new one. */
  joinStream?(
    threadId: string,
    runId: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
    options?: { streamMode?: StreamMode[] }
  ): AsyncIterable<StreamEvent>;

  /** @internal Inspect the exact owned physical run, without thread-history inference. */
  getRunStatus?(
    threadId: string,
    runId: string,
    signal: AbortSignal
  ): Promise<Run['status']>;

  /** Optional: create a server-side queued run without joining it immediately. */
  createQueuedRun?(
    assistantId: string,
    threadId: string,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions
  ): Promise<AgentQueueEntry>;

  /** Optional: cancel a server-side run. */
  cancelRun?(
    threadId: string,
    runId: string,
    signal: AbortSignal
  ): Promise<void>;

  /** Optional: load persisted checkpoint history for a thread. */
  getHistory?(threadId: string, signal: AbortSignal): Promise<ThreadState[]>;

  /** Exact saved root read. Branch effects must not infer authority from latest. */
  getState?(
    threadId: string,
    checkpoint: OwnedCheckpointPosition,
    signal: AbortSignal
  ): Promise<ThreadState>;

  /**
   * Optional: update server-side thread state (e.g. to emit RemoveMessage
   * entries for regenerate rollback). Forwards to the LangGraph
   * `threads.updateState` API.
   *
   * `options.asNode` corresponds to LangGraph's `as_node` parameter — the
   * server treats the update as if that node had just produced the values,
   * which determines what the next pull resumes. `regenerate()` passes
   * `asNode: '__start__'` so the next `submit(null)` resumes at the entry
   * node and re-runs `generate` against the rolled-back state.
   */
  updateState?(
    threadId: string,
    values: Record<string, unknown>,
    signal: AbortSignal,
    options?: { asNode?: string; checkpoint?: OwnedCheckpointPosition }
  ): Promise<void | OwnedCheckpointPosition>;
}

/**
 * Tuning options for the underlying LangGraph SDK `Client` constructed by the
 * default {@link FetchStreamTransport}. Ignored when a custom `transport` is
 * supplied (the transport owns its own client).
 */
export interface LangGraphClientOptions {
  /**
   * Headers attached to every request the SDK client makes, including the run
   * stream. Use this for a per-user session token that your LangGraph
   * deployment's custom `authenticate` handler validates.
   *
   * There is deliberately no `apiKey` option: a deployment credential passed
   * from Angular is bundled into the browser build like any other constant.
   * Keep deployment keys on a same-origin proxy or gateway you own, and point
   * `apiUrl` at it. The client is constructed with `apiKey: null`, so the SDK
   * never attaches a key from the environment either.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * How many times a failed request — including the initial stream connect —
   * is retried with exponential backoff before the error surfaces. Maps to the
   * SDK's `callerOptions.maxRetries`. Omitted → the SDK default (currently 4).
   *
   * Set `0` to fail fast: useful for e2e tests that force a connection failure
   * and assert the error surfaces promptly, rather than after the full
   * multi-second backoff window.
   */
  maxRetries?: number;
}
