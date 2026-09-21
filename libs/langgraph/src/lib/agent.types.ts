import { Signal } from '@angular/core';
import type { ResourceStatus as NgResourceStatus } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type {
  BagTemplate,
  InferBag,
  Interrupt,
  ThreadState,
  ToolProgress,
  ToolCallWithResult,
} from '@langchain/langgraph-sdk';
import type {
  MessageMetadata,
  SubmitOptions,
} from '@langchain/langgraph-sdk/ui';
import type { BaseMessage, AIMessage as CoreAIMessage } from '@langchain/core/messages';
import type {
  AgentInterrupt,
  AgentRuntimeTelemetrySink,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentWithHistory,
  ClientToolsCapability,
} from '@threadplane/chat';
import type { AgentLifecycle } from './lifecycle';
import type {
  AgentTransport,
  LangGraphClientOptions,
  LangGraphSubmitOptions,
  AgentQueue,
} from '../runtime/transport.types';

export type {
  StreamEvent,
  LangGraphMultitaskStrategy,
  LangGraphDurability,
  LangGraphOnCompletion,
  LangGraphOnDisconnect,
  LangGraphSubmitOptions,
  AgentQueueEntry,
  AgentQueue,
  AgentTransport,
  LangGraphClientOptions,
} from '../runtime/transport.types';

// Re-export SDK types so consumers don't need to import from langgraph-sdk directly
export type { BagTemplate, InferBag, Interrupt, ThreadState, SubmitOptions };

/**
 * Runtime constant mirroring Angular's ResourceStatus string-union type.
 * Angular 21 ships ResourceStatus as a pure string-union type (no runtime value),
 * so we provide a const-object shim for code that needs runtime comparisons.
 */
export const ResourceStatus = {
  Idle:       'idle',
  Loading:    'loading',
  Reloading:  'reloading',
  Resolved:   'resolved',
  Error:      'error',
  Local:      'local',
} as const satisfies Record<string, NgResourceStatus>;

export type ResourceStatus = NgResourceStatus;

// ── Transport interface ──────────────────────────────────────────────────────

/** A checkpoint entry in the experimental branch tree. */
export interface AgentBranchTreeNode<T = unknown> {
  type: 'node';
  value: ThreadState<T>;
  path: string[];
}

/** A branch fork where each item is an alternate checkpoint sequence. */
export interface AgentBranchTreeFork<T = unknown> {
  type: 'fork';
  items: AgentBranchTree<T>[];
}

/** Tree representation of LangGraph checkpoint history for time-travel UIs. */
export interface AgentBranchTree<T = unknown> {
  type: 'sequence';
  items: Array<AgentBranchTreeNode<T> | AgentBranchTreeFork<T>>;
}

/** A custom event emitted by the LangGraph backend via adispatch_custom_event(). */
export interface CustomStreamEvent {
  /** Event name set by the backend (e.g., 'state_update'). */
  name: string;
  /** Arbitrary payload from the backend. */
  data: unknown;
}

// ── Options ──────────────────────────────────────────────────────────────────

/** Options for creating a LangGraph-backed agent via {@link agent}. */
// The second generic is retained for source compatibility with existing typed
// AgentOptions references even though the options shape no longer depends on it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface AgentOptions<T, _ResolvedBag extends BagTemplate> {
  /** Base URL of the LangGraph Platform API. Defaults to `provideAgent({ apiUrl })` when omitted. */
  apiUrl?: string;
  /** Agent or graph identifier on the LangGraph platform. */
  assistantId: string;
  /** Thread ID to connect to. Pass a Signal for reactive thread switching. */
  threadId?: Signal<string | null> | string | null;
  /** Called when a new thread is auto-created by the transport. */
  onThreadId?: (id: string) => void;
  /** Initial state values before the first stream response arrives. */
  initialValues?: Partial<T>;
  /** Throttle signal updates in milliseconds. `false` to disable. */
  throttle?: number | false;
  /** Custom message deserializer for non-standard message formats. */
  toMessage?: (msg: unknown) => BaseMessage;
  /**
   * Custom transport. Defaults to FetchStreamTransport.
   *
   * A custom transport owns its own thread creation, so the runtime cannot
   * observe it directly: report every thread id the transport creates through
   * this config's {@link AgentOptions.onThreadId} or through the `threadId`
   * signal, otherwise the runtime keeps sending `null` and a new thread is
   * created on each submit.
   */
  transport?: AgentTransport;
  /** Tuning options for the default transport's LangGraph SDK client (e.g. retry budget). */
  clientOptions?: LangGraphClientOptions;
  /**
   * Omit to enable automatic development-only collection. Set `false` to disable.
   * An app-owned sink replaces the automatic destination and receives the
   * existing runtime lifecycle callbacks.
   */
  telemetry?: AgentRuntimeTelemetrySink | false;
  /** Tool names that indicate a subagent invocation. */
  subagentToolNames?: string[];
  /**
   * A2UI client capabilities (catalog negotiation) to advertise to the graph.
   * When set, every plain-object run payload carries them under the
   * `a2ui_client_capabilities` state key — mirroring how `client_tools`
   * rides the payload. Read server-side via threadplane-middleware's
   * `a2ui_client_capabilities(state)`. Use `@threadplane/chat`'s
   * `a2uiClientCapabilities()` for the renderer's standard value.
   */
  a2uiClientCapabilities?: { supportedCatalogIds: string[]; inlineCatalogs?: unknown[] };
  /**
   * LangGraph node names whose `messages-tuple` LLM chunks should be projected
   * into the main chat transcript. Omit to accept all top-level message chunks.
   * Child-graph (namespaced) chunks never reach the transcript regardless of
   * this option — they belong to their child stream in `subagents()`.
   *
   * Use this when a graph has side-effect LLM nodes, such as title generation,
   * whose streamed model output should not render as assistant chat content.
   */
  transcriptNodeNames?: string[];
}

// ── SubagentStreamRef ────────────────────────────────────────────────────────

/** Reference to a subagent's streaming state. */
export interface SubagentStreamRef {
  /** The tool call ID that spawned this subagent. */
  toolCallId: string;
  /** Optional human-readable subagent type/name. */
  name?: string;
  /** Current execution status of the subagent. */
  status: Signal<'pending' | 'running' | 'complete' | 'error'>;
  /** Current state values from the subagent. */
  values: Signal<Record<string, unknown>>;
  /** Messages from the subagent conversation. */
  messages: Signal<BaseMessage[]>;
}

// ── LangGraphAgent ────────────────────────────────────────────────────────────

/**
 * Unified LangGraph agent surface returned by `injectAgent()`.
 *
 * Extends the runtime-neutral `AgentWithHistory` contract (chat-consumable)
 * with the full LangGraph-specific API. One object drives both `<chat>` and
 * any LangGraph-specific demo. Raw LangGraph signals are prefixed with
 * `langGraph` to avoid collision with the runtime-neutral names.
 */
export interface LangGraphAgent<T = unknown, ResolvedBag extends BagTemplate = BagTemplate>
  extends AgentWithHistory<T> {
  // ── Raw LangGraph signals ────────────────────────────────────────────────

  /**
   * Current human-in-the-loop pause, or `undefined` when the run is not paused.
   *
   * Narrowed from the neutral `Agent` contract, where `interrupt` is optional
   * because a runtime without human-in-the-loop support omits it. The LangGraph
   * adapter always provides it, so `injectAgent().interrupt()` type-checks
   * directly under `strictNullChecks` — no `?.()` needed.
   */
  interrupt: Signal<AgentInterrupt | undefined>;

  /** Raw LangChain BaseMessage list. Use `messages` for chat rendering. */
  langGraphMessages: Signal<BaseMessage[]>;

  /** All interrupts received during the current run (raw LangGraph shape). */
  langGraphInterrupts: Signal<Interrupt<ResolvedBag['InterruptType']>[]>;

  /** Raw LangGraph tool calls (with run-state). Use `toolCalls` for chat rendering. */
  langGraphToolCalls: Signal<ToolCallWithResult[]>;

  /** Raw LangGraph history (ThreadState[]). Use `history` for AgentCheckpoint[]. */
  langGraphHistory: Signal<ThreadState<T>[]>;

  /** Experimental branch tree derived from LangGraph checkpoint history. */
  experimentalBranchTree: Signal<AgentBranchTree<T>>;

  /** Submit input, resume commands, checkpoint forks, or other LangGraph run options. */
  submit: (
    input: AgentSubmitInput | null | undefined,
    opts?: AgentSubmitOptions & LangGraphSubmitOptions,
  ) => Promise<void>;

  /**
   * Client-declared, client-executed tools. Call setCatalog() to register
   * tool specs; the catalog is automatically shipped with every run via
   * `input.client_tools`. Pending tool calls appear in pending() after
   * the run ends; resolve() returns a result and continues the run.
   */
  clientTools: ClientToolsCapability;

  // ── LangGraph-specific fields preserved on the unified surface ───────────

  /** Current agent state values (raw, typed per the type parameter T). */
  value: Signal<T>;

  /** True once at least one value or message has been received. */
  hasValue: Signal<boolean>;

  /** Re-submit the last input to restart the stream. */
  reload: () => void;

  /**
   * Discards the assistant message at the given index AND all messages after
   * it, then re-runs the agent against the trimmed conversation tail. The
   * preceding user message (at index - 1) is preserved and re-submitted as
   * the agent's input. No new user message is added to the history.
   *
   * Throws if the message at `index` is not 'assistant' role, or if the
   * agent is currently loading another response.
   */
  regenerate: (assistantMessageIndex: number) => Promise<void>;

  /** Progress updates for currently executing tools. */
  toolProgress: Signal<ToolProgress[]>;

  /** Pending server-side runs created via `multitaskStrategy: 'enqueue'`. */
  queue: Signal<AgentQueue>;

  /** Filtered list of subagents with status 'running'. */
  activeSubagents: Signal<SubagentStreamRef[]>;

  /** Get a subagent stream by the tool call ID that spawned it. */
  getSubagent: (toolCallId: string) => SubagentStreamRef | undefined;

  /** Get subagent streams by their configured subagent type/name. */
  getSubagentsByType: (type: string) => SubagentStreamRef[];

  /** Get subagent streams spawned by the tool calls on a specific AI message. */
  getSubagentsByMessage: (msg: CoreAIMessage) => SubagentStreamRef[];

  /** Raw custom events stream (signal of array). The runtime-neutral
   *  `events$` Observable is derived from this. */
  customEvents: Signal<CustomStreamEvent[]>;

  /** Current branch identifier for time-travel navigation. */
  branch: Signal<string>;

  /** Set the active branch for time-travel navigation. */
  setBranch: (branch: string) => void;

  /** True while a thread switch is loading state from the server. */
  isThreadLoading: Signal<boolean>;

  /** Switch to a different thread, resetting derived state. */
  switchThread: (threadId: string | null) => void;

  /** Join an already-running stream by run ID. */
  joinStream: (runId: string, lastEventId?: string) => Promise<void>;

  /** Get metadata for a specific message by index. */
  getMessagesMetadata: (msg: BaseMessage, idx?: number) => MessageMetadata<Record<string, unknown>> | undefined;

  /** Get tool call results associated with an AI message (LangGraph types). */
  getToolCalls: (msg: CoreAIMessage) => ToolCallWithResult[];

  /**
   * Lifecycle signals for observability/telemetry. Eight read-only signals
   * capture key transitions (first stream chunk, first interrupt, tool
   * call start/complete, thread create/persist, errors). All reset on
   * `switchThread()`. See {@link AgentLifecycle}.
   */
  lifecycle: AgentLifecycle;
}

// ── Internal: StreamSubjects ─────────────────────────────────────────────────
// Not exported from public-api.ts

export interface StreamSubjects<T, ResolvedBag extends BagTemplate = BagTemplate> {
  status$:          BehaviorSubject<ResourceStatus>;
  values$:          BehaviorSubject<T>;
  messages$:        BehaviorSubject<BaseMessage[]>;
  error$:           BehaviorSubject<unknown>;
  interrupt$:       BehaviorSubject<Interrupt<ResolvedBag['InterruptType']> | undefined>;
  interrupts$:      BehaviorSubject<Interrupt<ResolvedBag['InterruptType']>[]>;
  branch$:          BehaviorSubject<string>;
  history$:         BehaviorSubject<ThreadState<T>[]>;
  isThreadLoading$: BehaviorSubject<boolean>;
  toolProgress$:    BehaviorSubject<ToolProgress[]>;
  toolCalls$:       BehaviorSubject<ToolCallWithResult[]>;
  messageMetadata$: BehaviorSubject<Map<string, MessageMetadata<Record<string, unknown>>>>;
  subagents$:       BehaviorSubject<Map<string, SubagentStreamRef>>;
  queue$:           BehaviorSubject<AgentQueue>;
  custom$:          BehaviorSubject<CustomStreamEvent[]>;
}
