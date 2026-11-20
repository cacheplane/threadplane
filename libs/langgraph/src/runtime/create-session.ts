import {
  agentPlanFromState,
  completeDelivery,
  readState,
  type InferState,
  type StateDeclaration,
  type AgentError,
  type AgentInterruptResponse,
  type AgentSession,
  type AgentSessionCustomEvent,
  type CompleteOutcome,
  type PlainValue,
  type ToolCall,
  type ToolContract,
} from '@threadplane/core';
import type {
  CheckedTools,
  FunctionToolDefinition,
  ToolContracts,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import type { ThreadState } from '@langchain/langgraph-sdk';
import {
  FetchStreamTransport,
  normalizeSdkEvent,
} from '../lib/transport/fetch-stream.transport.js';
import {
  changedSignals,
  convertEventMessages,
  convertSavedMessages,
  errorClass,
  safely,
  throttleListener,
  type A2uiClientCapabilities,
  type LangGraphDevelopmentRuntime,
  type LangGraphDevtoolsSink,
  type LangGraphScriptedRuns,
  type LangGraphTelemetryEvent,
  type LangGraphTelemetrySink,
} from './session-hooks.js';
export type {
  A2uiClientCapabilities,
  LangGraphDevelopmentRuntime,
  LangGraphDevtoolsSignal,
  LangGraphDevtoolsSink,
  LangGraphScriptedRun,
  LangGraphScriptedRuns,
  LangGraphTelemetryEvent,
  LangGraphTelemetryPayload,
  LangGraphTelemetrySink,
} from './session-hooks.js';
import {
  initialMessageState,
  reduceMessages,
  type MessageState,
} from './message-reducer.js';
import { createReasoningTimer } from './reasoning-timing.js';
import {
  createLifecycleRecorder,
  type LangGraphLifecycleSource,
} from './lifecycle.js';
import { createPublication } from './publication.js';
import {
  observeHistoryInvocations,
  projectHistory,
} from './history-projection.js';
import { projectCheckpointHistory } from './checkpoint-history.js';
import {
  projectBranchTree,
  projectCheckpoints,
  projectMessageCheckpoints,
  type LangGraphBranchTree,
  type LangGraphCheckpoint,
} from './checkpoint-tree.js';
export {
  selectBranch,
  type LangGraphBranchFork,
  type LangGraphBranchNode,
  type LangGraphBranchTree,
  type LangGraphCheckpoint,
} from './checkpoint-tree.js';
import type {
  LangGraphWireInterrupt,
  LangGraphSnapshot,
  LangGraphState,
  LangGraphSubgraph,
} from './langgraph-snapshot.js';
import { projectHistoryValues, projectValues } from './values-projection.js';
import {
  identifyInterrupts,
  projectHistoryInterrupts,
  projectInterrupts,
  resumeValue,
} from './interrupt-projection.js';
import { ownMessage, ownValue } from './ownership.js';
import {
  captureDelegationBinding,
  DEFAULT_SUBAGENT_TOOL_NAMES,
  relateSubgraphs,
} from './delegation-projection.js';
import {
  captureStreamEvent,
  initialSubgraphs,
  projectSubgraphs,
  rebaseSubgraphs,
  settleSubgraphs,
  type SubgraphObservation,
} from './subgraph-projection.js';
import {
  captureSubmitInput,
  createSubmitPayload,
  type LangGraphInputState,
  type LangGraphSubmitInput,
} from './submit-input.js';
export type {
  LangGraphInputState,
  LangGraphSubmitInput,
  LangGraphSubmitState,
} from './submit-input.js';
import {
  captureRunOptions,
  type CapturedRunOptions,
  type LangGraphRunOptions,
} from './run-options.js';
export type {
  LangGraphRunOptions,
  LangGraphRunSettings,
} from './run-options.js';
export {
  createLangGraphThreadDirectory,
  type LangGraphThreadDirectoryOptions,
  type LangGraphThreadsClient,
} from './thread-directory.js';
export { createLangGraphProjectStore } from './project-store.js';
export type { ProjectStore } from './project-store.js';
export type {
  LangGraphLifecycle,
  LangGraphLifecycleSource,
} from './lifecycle.js';
import {
  advanceCursor,
  captureRun,
  rebaseRun,
  type RunEvidence,
} from './run-recovery.js';
import type { LangGraphSubmitOptions } from './transport.types.js';
import { createSafeRequestError } from './operation-errors.js';
import { createToolPersistence } from './tool-persistence.js';
import { hasInvocationConflict } from './tool-invocations.js';
import { observeInvocation } from './tool-invocations.js';
import {
  assertResumeCheckpoint,
  captureCheckpoint,
  captureCheckpointEvent,
  captureCheckpointState,
  captureCompletedCheckpoint,
  confirmCheckpoint,
  type CheckpointCandidate,
  type CheckpointReference,
  type OwnedCheckpointPosition,
} from './checkpoint-authority.js';
import {
  beginCheckpointEffect,
  readyCheckpoint,
  uncertainCheckpoint,
  type CheckpointOwner,
} from './checkpoint-state.js';
import { assertCheckpointToolEvidence } from './checkpoint-tool-evidence.js';
import {
  failureProjection,
  finalizeProjection,
  interruptionError,
  isTranscriptEvent,
  projectStream,
  record,
  type StreamProjection,
} from './stream-projection.js';
import type {
  AgentTransport,
  LangGraphClientOptions,
  StreamEvent,
} from './transport.types.js';
import {
  cancelledResult,
  captureTools,
  createToolBuffer,
  executeTool,
  resultCall,
} from './function-tools.js';

export interface SessionOptions {
  readonly assistantId: string;
  /** The thread this session belongs to. Omit it, or pass null, to start an
   * empty session that creates its thread on the first submit. That requires
   * `transport.createThread`, which the owned SDK transport provides. */
  readonly threadId?: string | null;
  /** Called once with the id of the thread this session created. Never called
   * when `threadId` is given. A throwing callback does not affect the run. */
  readonly onThreadId?: (threadId: string) => void;
  readonly transport?: AgentTransport;
  readonly apiUrl?: string;
  /** The owned SDK transport defaults maxRetries to 0: an ambiguous failed
   * run-creation POST must not silently create another run. A supplied numeric
   * maxRetries explicitly opts into SDK request retries. Custom transports own
   * their retry policy; joining a known run is separate from replaying submit. */
  readonly clientOptions?: LangGraphClientOptions;
  readonly executionStore?: ToolExecutionStore;
  /**
   * The graph state's type: `type<T>()` to declare it, or a Standard Schema,
   * such as a Zod object, to also check each state the backend reports. A state
   * the schema rejects is withheld and described in `snapshot.stateIssues`.
   */
  readonly stateType?: StateDeclaration;
  /**
   * Node names whose streamed message chunks enter the transcript. Omit it to
   * accept every root node. Use it when a graph has side-effect model nodes,
   * such as title generation, whose output is not chat content. Messages a
   * node writes to the graph state still arrive with that state, and child
   * graphs are never affected: their messages belong to `subgraphs`.
   */
  readonly transcriptNodeNames?: readonly string[];
  /**
   * Names of the root tools that start a child agent; `['task']` when omitted.
   * A child graph started by such a call, whose arguments carry a
   * `subagent_type`, is related to it: see `LangGraphSubgraph.delegation`.
   * Pass an empty list to relate nothing.
   */
  readonly subagentToolNames?: readonly string[];
  /**
   * Keep each loaded checkpoint's state. `snapshot.checkpoints`,
   * `snapshot.messageCheckpoints` and `snapshot.branchTree` are then published
   * from every history page, and the page is read again after each run that
   * ends in success or a pause. Off by default: a page's states can be large,
   * and a session otherwise keeps only checkpoint metadata in
   * `snapshot.history`.
   */
  readonly historyState?: boolean;
  /**
   * The state `snapshot.state` holds until the backend reports one. It is
   * published as given, without the `stateType` check, and never sent.
   */
  readonly initialValues?: Readonly<Record<string, PlainValue>>;
  /**
   * Converts each wire message, from a stream event or a saved checkpoint, of
   * the root graph or a child, before the session reads it. Return the plain
   * wire shape the session projects (`type` or `role`, `id`, `content`,
   * `tool_calls`, `tool_call_id`). A message the function throws on is read
   * as it was sent.
   */
  readonly toMessage?: (message: unknown) => unknown;
  /**
   * The least time, in milliseconds, between two calls to a `subscribe`
   * listener while a run streams. The snapshot is never delayed, the last
   * change is always delivered, and a change that ends the run is delivered
   * at once. Off when omitted, `false` or `0`.
   */
  readonly throttle?: number | false;
  /**
   * Generated UI capabilities to advertise to the graph. They are sent with
   * every run that has input, under the `a2ui_client_capabilities` state key.
   */
  readonly a2uiClientCapabilities?: A2uiClientCapabilities;
  /** Receives the session's runtime telemetry events. `false` is the same as omitting it. */
  readonly telemetry?: LangGraphTelemetrySink | false;
  /**
   * Told when a request of the owned SDK transport was refused as
   * unauthorized or blocked by the network. Supplying it also makes the owned
   * transport report generic errors only. A supplied transport ignores it.
   */
  readonly onOperationFailure?: (
    code: 'unauthorized' | 'network_blocked'
  ) => void;
  /** A development-install collector to keep informed. The host creates it. */
  readonly developmentRuntime?: LangGraphDevelopmentRuntime;
  /** A development tool told which published fields each event changed. */
  readonly devtools?: LangGraphDevtoolsSink;
  /** Development only: a source of scripted runs that stand in for the network. */
  readonly scriptedRuns?: LangGraphScriptedRuns;
}

/** Backend-private capability; core sessions and borrowed observers stay minimal. */
export type LangGraphSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = Omit<AgentSession<TTools, TState>, 'getSnapshot' | 'submit' | 'resume'> & {
  getSnapshot(): LangGraphSnapshot<TTools, TState>;
  /** The session's thread: the given `threadId`, or the thread it created on
   * the first submit. Undefined until that thread exists. */
  readonly threadId: string | undefined;
  /**
   * Starts a run. With `null` or `undefined` the run has no input: the graph
   * continues from the thread's saved state, and no user message is added.
   * With `run.multitaskStrategy: 'enqueue'` during a run, the run is queued
   * instead and the promise resolves with its outcome once it has been joined.
   */
  submit(
    input: LangGraphSubmitInput<TState> | null | undefined,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  /**
   * Removes one queued run and asks the backend to cancel it. Resolves `true`
   * when the backend confirmed; `false` when the run is not queued, the
   * transport cannot cancel, or the request failed.
   */
  cancelQueued(runId: string): Promise<boolean>;
  /** Removes every queued run and asks the backend to cancel each. */
  clearQueue(): Promise<void>;
  fork(
    checkpoint: CheckpointReference,
    input: LangGraphSubmitInput<TState>,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  reconnect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CompleteOutcome>;
  /**
   * Joins a run of this thread by id and projects its stream: one started
   * elsewhere, or before a reload. `lastEventId` continues after that event;
   * without it the run is joined from its first event, which the backend
   * serves only for a resumable stream. It replaces an active run the way a
   * submit does, adds no user message, and resolves with the joined run's
   * outcome, or `'aborted'` when the session has no thread yet. `reconnect`
   * remains the way to continue the session's own retained run.
   */
  joinStream(
    runId: string,
    lastEventId?: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  /**
   * Answers pending interrupts and continues the paused graph. One pending
   * interrupt receives its response's value as the resume value. Several are
   * answered by backend id, each with a value. LangGraph has no cancelled
   * response: a refusal is a value the graph reads.
   */
  resume(
    responses: readonly AgentInterruptResponse[],
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  load?(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /**
   * Selects the branch a view shows and publishes it as `snapshot.branch`. The
   * value is the fork choices joined with `>`, as `selectBranch` reads it; an
   * empty string selects the default branch. It is a view selection only: no
   * request is made and the transcript does not change.
   */
  setBranch(branch: string): Promise<void>;
  /** Always present here: `custom` stream frames as application events. */
  onCustomEvent(listener: (event: AgentSessionCustomEvent) => void): () => void;
  /** When this session first saw each milestone; see `LangGraphLifecycle`. */
  readonly lifecycle: LangGraphLifecycleSource;
};

interface HistoryRead {
  readonly controller: AbortController;
  readonly result: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  unlink?: () => void;
}

interface Preparation extends Omit<HistoryRead, 'result' | 'resolve'> {
  readonly result: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  readonly checkpoint: OwnedCheckpointPosition;
  readonly adopt: (saved: ThreadState) => () => Attempt;
}

type AttemptInput =
  | {
      readonly kind: 'submit';
      readonly messages: { type: 'human'; id: string; content: string }[];
      readonly state?: LangGraphInputState;
    }
  | {
      readonly kind: 'resume';
      readonly value: PlainValue | undefined;
      /** The pending interrupts this decision answers, for history reconciliation. */
      readonly interrupts: readonly LangGraphWireInterrupt[];
      /** A run with no input at all, from `submit(null)`: nothing is answered. */
      readonly bare?: boolean;
    };

interface QueuedRun {
  readonly id: string;
  readonly message?: string;
  readonly createdAt: number;
  readonly input: AttemptInput;
  readonly runOptions: CapturedRunOptions | undefined;
  readonly result: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
}

interface PhysicalRun {
  readonly batch: ReturnType<ReturnType<typeof createToolBuffer>['snapshot']>;
  evidence: RunEvidence;
  captureOpen: boolean;
  received: boolean;
  confirmed: boolean;
  checkpoint?: CheckpointCandidate;
  positionConfirmed?: boolean;
}

interface Attempt {
  readonly controller: AbortController;
  readonly generation: string;
  readonly result: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  readonly input: AttemptInput;
  /** The transcript and values before this command added anything; retry restores them. */
  readonly baseline: {
    readonly state: MessageState;
    readonly values: LangGraphState | undefined;
  };
  readonly runOptions: CapturedRunOptions | undefined;
  readonly branch?: CheckpointOwner;
  projection: StreamProjection;
  subgraphs: SubgraphObservation;
  readonly calls: Map<string, ToolCall>;
  groups: number;
  physical?: PhysicalRun;
  joinCursor?: string;
  /** Join the known run from its first event, with no cursor. */
  joinStart?: boolean;
  /** The run started from a checkpoint the session could not rewind to. */
  travel?: boolean;
  /** A development tool scripted this run; the backend never saw it. */
  scripted?: boolean;
  /** For telemetry: when the command began. */
  startedAt?: number;
  handoffIds: readonly string[];
  iterator?: AsyncIterator<StreamEvent>;
  unlink?: () => void;
  closed?: boolean;
}

/** Two pending batches describe the same pause when every interrupt matches
 * by id and payload. Ids alone are not enough: a node that pauses again can
 * reuse its deterministic id with a different question. */
function sameInterrupts(
  current: readonly LangGraphWireInterrupt[],
  answered: readonly LangGraphWireInterrupt[]
): boolean {
  if (current.length !== answered.length) return false;
  const key = (interrupt: LangGraphWireInterrupt) =>
    JSON.stringify([interrupt.id ?? null, interrupt.value ?? null]);
  const keys = answered.map(key);
  return current.every((interrupt) => keys.includes(key(interrupt)));
}

/** A `custom` stream frame from any namespace as an application event, read the
 * way the Angular adapter reads it: `{ name, data }` payloads unwrap, any other
 * payload is the data with an empty name. The middleware's subagent binding is
 * protocol, not application data. Payloads that are not plain data are dropped. */
function captureCustomEvent(
  event: StreamEvent
): AgentSessionCustomEvent | undefined {
  if (event.type.split('|')[0] !== 'custom' || !Object.hasOwn(event, 'data'))
    return undefined;
  try {
    const payload = ownValue(event['data'] as PlainValue);
    const record =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { readonly [key: string]: PlainValue })
        : undefined;
    if (record?.['type'] === 'threadplane.subagent_binding') return undefined;
    return Object.freeze({
      name: typeof record?.['name'] === 'string' ? record['name'] : '',
      data: record?.['data'] ?? payload,
    });
  } catch {
    return undefined;
  }
}

/** Private development composition. Construction/observation perform no I/O.
 * stop settles local ownership, not remote side effects. dispose is permanent:
 * submits resolve aborted, subscriptions are inert, reads retain the final
 * snapshot, stop/dispose are idempotent. checkStatus rejects after disposal or
 * during a run; it only reads history and never creates another logical run. */
export function createSession<
  T extends Record<string, FunctionToolDefinition>,
  D extends StateDeclaration | undefined = undefined
>(
  options: Omit<SessionOptions, 'stateType'> & {
    readonly tools: T & CheckedTools<T>;
    readonly stateType?: D;
  }
): LangGraphSession<ToolContracts<T>, InferState<D>>;
export function createSession<
  D extends StateDeclaration | undefined = undefined
>(
  options: Omit<SessionOptions, 'stateType'> & {
    readonly tools?: undefined;
    readonly stateType?: D;
  }
): LangGraphSession<Record<string, ToolContract>, InferState<D>>;
export function createSession(
  options: SessionOptions & {
    readonly tools?: Record<string, FunctionToolDefinition>;
  }
): LangGraphSession {
  const { assistantId, onThreadId } = options;
  let threadId: string | undefined = options.threadId ?? undefined;
  if (onThreadId !== undefined && typeof onThreadId !== 'function')
    throw new TypeError('onThreadId must be a function.');
  const { definitions, catalog } = captureTools(options.tools);
  const typedTools = options.tools !== undefined;
  const suppliedStore = options.executionStore;
  const acquire = suppliedStore?.acquire;
  const settleExecution = suppliedStore?.settle;
  if (
    suppliedStore &&
    (typeof acquire !== 'function' || typeof settleExecution !== 'function')
  ) {
    throw new TypeError('executionStore requires acquire and settle methods.');
  }
  const store =
    suppliedStore && acquire && settleExecution
      ? {
          acquire: acquire.bind(suppliedStore),
          settle: settleExecution.bind(suppliedStore),
        }
      : undefined;
  const buffer = createToolBuffer();
  const resolvedTools = new Set<string>();
  // Provisional guarded claims and unavailable results survive command stop.
  // Only conclusive execution or explicit graph evidence releases admission.
  const unsettledTools = new Set<string>();
  // Execution dedupe survives transcript replacement. Authored result provenance
  // belongs only to the current transcript; a wire string cannot restore it.
  const authoredTools = new Set<string>();
  const suppliedTransport = options.transport;
  const ownedClientOptions = suppliedTransport
    ? undefined
    : { ...options.clientOptions };
  const ownedRetries = ownedClientOptions?.maxRetries ?? 0;
  const transport =
    suppliedTransport ??
    new FetchStreamTransport(
      options.apiUrl ?? '',
      undefined,
      {
        ...ownedClientOptions,
        maxRetries: ownedRetries,
      },
      typeof options.onOperationFailure === 'function'
        ? options.onOperationFailure
        : undefined
    );
  const toMessage =
    typeof options.toMessage === 'function' ? options.toMessage : undefined;
  const telemetry =
    typeof options.telemetry === 'function' ? options.telemetry : undefined;
  const developmentRuntime = options.developmentRuntime;
  const devtools = options.devtools;
  const scriptedRuns = options.scriptedRuns;
  const a2uiClientCapabilities = options.a2uiClientCapabilities
    ? ownValue({
        supportedCatalogIds: options.a2uiClientCapabilities.supportedCatalogIds,
        ...(options.a2uiClientCapabilities.inlineCatalogs !== undefined
          ? { inlineCatalogs: options.a2uiClientCapabilities.inlineCatalogs }
          : {}),
      })
    : undefined;
  const throttleMs =
    typeof options.throttle === 'number' && options.throttle > 0
      ? options.throttle
      : 0;
  function report(
    event: LangGraphTelemetryEvent,
    properties: { requestType?: string; durationMs?: number; errorClass?: string } = {}
  ) {
    if (!telemetry) return;
    safely(() =>
      telemetry({
        event,
        properties: { transport: 'langgraph', surface: 'agent', ...properties },
      })
    );
  }
  /** Reports one command to telemetry and the development collector. */
  function reportRequest(attempt: Attempt, requestType: string) {
    attempt.startedAt = Date.now();
    if (developmentRuntime) safely(() => developmentRuntime.touch());
    report('tplane:runtime_request_created', { requestType });
    report('tplane:stream_started');
  }
  /** The run payload for a submission: its messages, state and what the
   * session itself advertises. */
  function runPayload(
    messages: readonly unknown[],
    state?: LangGraphInputState
  ): Record<string, unknown> {
    const payload = createSubmitPayload(messages, catalog, state);
    if (a2uiClientCapabilities)
      payload['a2ui_client_capabilities'] = a2uiClientCapabilities;
    return payload;
  }
  function takeScript() {
    if (!scriptedRuns) return null;
    try {
      const script = scriptedRuns.take();
      return script && Array.isArray(script.frames) ? script : null;
    } catch {
      return null;
    }
  }
  /** A scripted run's frames, normalized as the owned transport normalizes
   * the SDK's and delivered one per turn, as a stream would. */
  async function* streamScript(
    frames: readonly { readonly event: string; readonly data: unknown }[],
    signal: AbortSignal
  ): AsyncIterable<StreamEvent> {
    for (const frame of frames) {
      await Promise.resolve();
      if (signal.aborted) {
        const error = new Error('Scripted run aborted.');
        error.name = 'AbortError';
        throw error;
      }
      yield normalizeSdkEvent(frame.event as StreamEvent['type'], frame.data);
    }
  }
  const protectedTransport =
    transport instanceof FetchStreamTransport &&
    transport.protectsOperationErrors;
  const createThread = transport.createThread?.bind(transport);
  if (threadId === undefined && !createThread)
    throw new TypeError(
      'A session without a threadId requires transport.createThread().'
    );
  /** The one pending thread creation every waiting command shares. */
  let creation:
    | { readonly controller: AbortController; readonly id: Promise<string> }
    | undefined;
  /** The session thread. Commands that reach here only run once it exists. */
  function thread(): string {
    if (threadId === undefined)
      throw new Error('The session thread does not exist yet.');
    return threadId;
  }
  /** Creates the session thread once. Stop leaves the request running, so a
   * thread that is created is never lost; dispose aborts it. A failure clears
   * the creation so the next command makes a new request. */
  function ensureThread(): Promise<string> {
    if (threadId !== undefined) return Promise.resolve(threadId);
    if (creation) return creation.id;
    const create = createThread;
    if (!create) return Promise.reject(createSafeRequestError());
    const current = { controller: new AbortController() } as {
      readonly controller: AbortController;
      id: Promise<string>;
    };
    creation = current;
    current.id = (async () => {
      try {
        const id = await create(current.controller.signal);
        if (typeof id !== 'string' || !id) throw new Error('Invalid thread id.');
        if (creation !== current || disposed) throw createSafeRequestError();
        creation = undefined;
        threadId = id;
        try {
          onThreadId?.(id);
        } catch {
          /* Application callbacks cannot affect the run. */
        }
        return id;
      } catch (error) {
        if (creation === current) creation = undefined;
        throw error;
      }
    })();
    return current.id;
  }
  const persistence = createToolPersistence<CheckpointOwner>(
    buffer,
    async (messages, signal, branch) => {
      // A queued flush can start after history/stream observation found a conflict.
      // Durable claim/record ownership may finish, but its results stay quarantined.
      assertInvocationIdentity();
      if (!transport.updateState)
        throw new Error(
          'Persisting terminal tool results requires transport.updateState().'
        );
      const confirmed = branch && readyCheckpoint(branch.state);
      if (branch) branch.state = beginCheckpointEffect(branch.state, 'write');
      try {
        const result = await transport.updateState(
          thread(),
          { messages },
          signal,
          confirmed ? { checkpoint: confirmed.position } : undefined
        );
        if (branch && confirmed) {
          const position = captureCheckpoint(result, thread());
          branch.state = {
            kind: 'ready',
            confirmed: { ...confirmed, position },
          };
        }
      } catch (error) {
        if (branch) branch.state = uncertainCheckpoint(branch.state);
        throw error;
      }
    }
  );
  const readHistoryPage =
    typeof transport.getHistory === 'function'
      ? transport.getHistory.bind(transport)
      : undefined;
  const getHistory: typeof readHistoryPage =
    readHistoryPage && toMessage
      ? async (id, signal) =>
          (await readHistoryPage(id, signal)).map((saved) =>
            convertSavedMessages(saved, toMessage)
          )
      : readHistoryPage;
  const canCheck = !!getHistory;
  const joinStream = transport.joinStream?.bind(transport);
  const createQueuedRun = transport.createQueuedRun?.bind(transport);
  const cancelRun = transport.cancelRun?.bind(transport);
  const queue: QueuedRun[] = [];
  const getRunStatus = transport.getRunStatus?.bind(transport);
  type RunStatus = Awaited<ReturnType<NonNullable<typeof getRunStatus>>>;
  const readSavedState = transport.getState?.bind(transport);
  const getState: typeof readSavedState =
    readSavedState && toMessage
      ? async (id, checkpoint, signal) =>
          convertSavedMessages(
            await readSavedState(id, checkpoint, signal),
            toMessage
          )
      : readSavedState;
  const canReconnect = !!joinStream && !!getRunStatus;
  const initialValues = options.initialValues
    ? (record(ownValue(options.initialValues)) as LangGraphState | undefined)
    : undefined;
  const publication = createPublication({
    status: 'idle',
    messages: [],
    toolCalls: [],
    state: initialValues,
    interrupts: [],
    subgraphs: [],
    history: undefined,
  });
  let historyPage: LangGraphSnapshot['history'];
  const historyState = options.historyState === true;
  let checkpointPage:
    | {
        readonly checkpoints: readonly LangGraphCheckpoint[];
        readonly messageCheckpoints: Readonly<Record<string, string>>;
        readonly branchTree: LangGraphBranchTree;
      }
    | undefined;
  /** Derives the published checkpoint views once for each distinct page. */
  function checkpointViews(
    history: readonly ThreadState[]
  ): typeof checkpointPage {
    const checkpoints = projectCheckpoints(checkpointPage?.checkpoints, history);
    return checkpoints === checkpointPage?.checkpoints
      ? checkpointPage
      : {
          checkpoints,
          messageCheckpoints: projectMessageCheckpoints(checkpoints),
          branchTree: projectBranchTree(checkpoints),
        };
  }
  let branchName = '';
  let pageRefresh: AbortController | undefined;
  let subgraphs = initialSubgraphs(publication.getSnapshot().subgraphs);
  let state = initialMessageState();
  const reasoningTimer = createReasoningTimer();
  // One clock per child graph: namespaces repeat message identifiers.
  const subgraphTimers = new Map<
    string,
    ReturnType<typeof createReasoningTimer>
  >();
  function timedSubgraphs(
    observed: readonly LangGraphSubgraph[]
  ): readonly LangGraphSubgraph[] {
    const present = new Set<string>();
    let changed = false;
    const timed = observed.map((subgraph) => {
      const key = JSON.stringify(subgraph.namespace);
      present.add(key);
      let timer = subgraphTimers.get(key);
      if (!timer) subgraphTimers.set(key, (timer = createReasoningTimer()));
      const messages = timer.observe(subgraph.messages);
      if (messages === subgraph.messages) return subgraph;
      changed = true;
      return { ...subgraph, messages };
    });
    // A new turn starts with no child graphs; their timings go with them.
    for (const key of subgraphTimers.keys())
      if (!present.has(key)) subgraphTimers.delete(key);
    return changed ? timed : observed;
  }
  const subagentToolNames: ReadonlySet<string> = new Set(
    (options.subagentToolNames ?? DEFAULT_SUBAGENT_TOOL_NAMES).filter(
      (name) => typeof name === 'string'
    )
  );
  /** `tools:<task id>` namespace segment to the tool call that started it. */
  const delegationBindings = new Map<string, string>();
  const lifecycle = createLifecycleRecorder();
  let values: LangGraphState | undefined = initialValues;
  let interrupts: readonly LangGraphWireInterrupt[] =
    publication.getSnapshot().interrupts;
  let owner: Attempt | undefined;
  let recoveryAttempt: Attempt | undefined;
  /** A command whose exact run the backend reported failed, valid only while
   * the transcript it left is still the current one. */
  let replayable: { attempt: Attempt; state: MessageState } | undefined;
  let retained: { attempt: Attempt; run: PhysicalRun } | undefined;
  let disposed = false;
  let revision = 0;
  let checkController: AbortController | undefined;
  let loading: HistoryRead | undefined;
  let pendingToolSettlements = 0;
  let branch: CheckpointOwner | undefined;
  let preparing: Preparation | undefined;
  // Owned streams need saved root values after auxiliary model callbacks.
  const checkpointStreamModes = [
    'values',
    'messages-tuple',
    'updates',
    'custom',
    'checkpoints',
  ] as const;

  function invocationConflictError(): AgentError {
    return {
      kind: 'interrupted',
      message:
        'A tool invocation identity conflict prevents further execution in this session.',
      retryable: false,
      recovery: 'none',
    };
  }
  function assertInvocationIdentity() {
    if (hasInvocationConflict(state.invocations))
      throw new Error(invocationConflictError().message);
  }

  /** The exact run ended without success: nothing is pending and nothing can
   * be checked again. A run the backend reports as `error` or `timeout` has a
   * settled outcome, so a plain command whose only run that was can be sent
   * again; an `interrupted` run may have lost a pause, so it offers nothing. */
  function runFailureError(
    status: 'error' | 'timeout' | 'interrupted',
    attempt: Attempt
  ): AgentError {
    const retry =
      status !== 'interrupted' && !attempt.branch && attempt.groups === 0;
    return {
      kind: status === 'interrupted' ? 'interrupted' : 'server',
      message: 'The LangGraph run did not complete successfully.',
      retryable: retry,
      recovery: retry ? 'retry' : 'none',
    };
  }

  /** Thread creation failed before any run started, so the command can be
   * sent again. Only the status of an unprotected SDK error is read, never its
   * message or body. */
  function threadCreationError(raw: unknown): AgentError {
    let status: number | undefined;
    if (!protectedTransport) {
      try {
        const value = record(raw)?.['status'];
        if (typeof value === 'number') status = value;
      } catch {
        /* An unreadable failure is reported without a status. */
      }
    }
    if (status === 401 || status === 403)
      return {
        kind: 'auth',
        message: 'Authentication failed. Check your credentials.',
        status,
        retryable: false,
        recovery: 'none',
      };
    const retry = !!getRunStatus;
    return {
      kind: 'server',
      message: 'The LangGraph request failed.',
      ...(status !== undefined ? { status } : {}),
      retryable: retry,
      recovery: retry ? 'retry' : 'none',
    };
  }

  function unsettledToolError(): AgentError {
    return {
      kind: 'interrupted',
      message:
        'Tool execution is unresolved. Reconcile the result externally, then load history before submitting again.' +
        (buffer.snapshot().messages.length
          ? ' Completed tool results remain staged.'
          : ''),
      retryable: false,
      recovery: 'none',
    };
  }
  function admitSubmission() {
    assertInvocationIdentity();
    if (branch || preparing) admitBranchCommand();
    if (unsettledTools.size)
      throw new Error('Submission cannot replace unsettled tool execution.');
    if (persistence.pending)
      throw new Error('Submission cannot replace pending tool persistence.');
  }

  function admitBranchCommand() {
    assertInvocationIdentity();
    if (
      owner ||
      loading ||
      checkController ||
      preparing ||
      recoveryAttempt ||
      retained ||
      pendingToolSettlements ||
      persistence.pending ||
      unsettledTools.size ||
      buffer.snapshot().messages.length
    )
      throw new Error(
        'Checkpoint commands cannot replace active or unsettled work.'
      );
    if (branch) readyCheckpoint(branch.state);
  }

  const owns = (attempt: Attempt) => owner === attempt && !disposed;
  const transcriptNodeNames = options.transcriptNodeNames
    ? Object.freeze(
        [...options.transcriptNodeNames].filter(
          (name) => typeof name === 'string'
        )
      )
    : undefined;
  const stateType = options.stateType;
  let published: {
    readonly source: LangGraphState | undefined;
    readonly state: LangGraphState | undefined;
    readonly issues?: readonly string[];
  } = { source: initialValues, state: initialValues };
  /** The state to publish for the current values, checked once per reported state. */
  function readPublishedState(): typeof published {
    if (values === published.source) return published;
    if (values === undefined || stateType === undefined)
      return (published = { source: values, state: values });
    const reading = readState(stateType, values);
    if (!reading.valid)
      return (published = {
        source: values,
        state: published.state,
        issues: reading.issues,
      });
    // A schema may hand back the reported record itself or a new value.
    let state: LangGraphState | undefined;
    try {
      state = record(ownValue(reading.value as PlainValue)) as
        | LangGraphState
        | undefined;
    } catch {
      state = undefined;
    }
    return (published = state
      ? { source: values, state }
      : {
          source: values,
          state: published.state,
          issues: ['The state schema must produce a plain data record.'],
        });
  }
  function publish(status: 'idle' | 'running' | 'error', error?: AgentError) {
    if (hasInvocationConflict(state.invocations)) {
      status = 'error';
      error = invocationConflictError();
    }
    const plan = agentPlanFromState(values);
    lifecycle.observe({
      error,
      interrupts,
      toolCalls: state.toolCalls,
    });
    const reading = readPublishedState();
    const before = devtools && publication.getSnapshot();
    publication.publish({
      status,
      history: historyPage,
      ...checkpointPage,
      ...(branchName ? { branch: branchName } : {}),
      ...(queue.length
        ? {
            queue: queue.map(({ id, message, createdAt }) => ({
              id,
              ...(message !== undefined ? { message } : {}),
              createdAt,
            })),
          }
        : {}),
      state: reading.state,
      ...(reading.issues ? { stateIssues: reading.issues } : {}),
      ...(plan ? { plan } : {}),
      interrupts: identifyInterrupts(interrupts),
      subgraphs: relateSubgraphs(
        timedSubgraphs(subgraphs.subgraphs),
        state.toolCalls,
        subagentToolNames,
        delegationBindings
      ),
      ...(retained?.run.evidence.runId
        ? { reconnect: { runId: retained.run.evidence.runId } }
        : {}),
      messages: reasoningTimer.observe(state.messages),
      toolCalls: typedTools
        ? state.toolCalls.filter(
            (call) =>
              definitions.has(call.name) &&
              (authoredTools.has(call.id) ||
                !state.messages.some(
                  (message) =>
                    message.role === 'tool' && message.toolCallId === call.id
                ))
          )
        : state.toolCalls,
      ...(error ? { error } : {}),
    });
    if (devtools && before) reportWrites(before);
    // Last, so a lifecycle listener runs where a snapshot listener would.
    lifecycle.flush();
  }
  /** What the next publication is attributed to in a development tool. */
  let writeLabel: { readonly event?: string; readonly label?: string } = {};
  let customWrite = false;
  function reportWrites(before: LangGraphSnapshot) {
    const sink = devtools;
    if (!sink) return;
    const { event, label = 'run:end' } = writeLabel;
    writeLabel = {};
    const names = [
      ...changedSignals(before, publication.getSnapshot()),
      ...(customWrite ? (['custom'] as const) : []),
    ];
    customWrite = false;
    const write = () => {
      for (const name of names) sink.wrote(name);
    };
    safely(() => {
      if (event === undefined) return sink.outside(label, write);
      sink.begin(event);
      try {
        write();
      } finally {
        sink.end();
      }
    });
  }
  function invalidateCheck() {
    revision += 1;
    const previous = checkController;
    checkController = undefined;
    return previous;
  }
  const ownsLoad = (read: HistoryRead) => loading === read && !disposed;
  function detachLoad() {
    const previous = loading;
    loading = undefined;
    previous?.resolve();
    return previous;
  }
  function closeLoad(read: HistoryRead | undefined, abort = true) {
    if (!read) return;
    const unlink = read.unlink;
    read.unlink = undefined;
    // Ownership must already be committed: abort/remove-listener hooks may
    // synchronously start another command. Cleanup never owns its replacement.
    if (abort) read.controller.abort();
    unlink?.();
  }
  function detachPreparation() {
    const previous = preparing;
    preparing = undefined;
    previous?.resolve('aborted');
    return previous;
  }
  function closePreparation(preparation: Preparation | undefined) {
    if (!preparation) return;
    preparation.controller.abort();
    preparation.unlink?.();
  }
  function close(attempt: Attempt, abort = false, final = true) {
    const unlink = final ? attempt.unlink : undefined;
    if (final) attempt.unlink = undefined;
    const iterator = attempt.closed ? undefined : attempt.iterator;
    if (iterator) attempt.closed = true;
    // Cleanup can synchronously call session commands. Callers must commit all
    // ownership/state changes before invoking it, and never overwrite afterward.
    if (abort) attempt.controller.abort();
    unlink?.();
    if (!iterator) return;
    // return() may wait for a noncooperative next(); local settlement never does.
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      /* Cleanup cannot revive a settled attempt. */
    }
  }
  function settle(
    attempt: Attempt,
    outcome: CompleteOutcome,
    error?: AgentError,
    retainRun = false
  ) {
    if (!owns(attempt)) return;
    retainRun ||= !!attempt.branch;
    if (hasInvocationConflict(state.invocations)) {
      outcome = 'interrupted';
      error = invocationConflictError();
      retainRun = false;
    }
    const run = attempt.physical;
    const candidate =
      retainRun &&
      canReconnect &&
      run &&
      !(attempt.branch ? run.positionConfirmed : run.confirmed) &&
      !run.evidence.unsafe &&
      run.evidence.runId &&
      run.evidence.cursor
        ? { attempt, run }
        : undefined;
    detach(outcome);
    retained = candidate;
    if (attempt.branch)
      attempt.branch.state = uncertainCheckpoint(attempt.branch.state);
    recoveryAttempt = error?.recovery === 'check' ? attempt : undefined;
    replayable = error?.recovery === 'retry' ? { attempt, state } : undefined;
    publish(error ? 'error' : 'idle', error);
    if (outcome !== 'aborted') {
      const durationMs = Date.now() - (attempt.startedAt ?? Date.now());
      if (error)
        report('tplane:stream_errored', {
          durationMs,
          errorClass: errorClass(error),
        });
      else report('tplane:stream_ended', { durationMs });
    }
    if (historyState && !error && (outcome === 'success' || outcome === 'paused'))
      void refreshHistoryPage();
    // A run from a checkpoint the session could not rewind to leaves the saved
    // branch as the only account of the transcript.
    if (attempt.travel && !error && getHistory)
      void load().catch(() => undefined);
    else if (queue.length && (!error || (error.recovery ?? 'none') === 'none'))
      drainQueue();
    // An error can end local consumption before the HTTP body closes. SDK
    // iterator return releases its reader; abort also cancels our request.
    close(
      attempt,
      outcome === 'error' || hasInvocationConflict(state.invocations)
    );
  }
  /** Reads the history page again after a run, for the checkpoint views only.
   * The transcript is the stream's; a failed or superseded read changes nothing. */
  async function refreshHistoryPage() {
    if (!getHistory || threadId === undefined || branch || disposed) return;
    pageRefresh?.abort();
    const controller = new AbortController();
    pageRefresh = controller;
    const current = () =>
      pageRefresh === controller &&
      !disposed &&
      !owner &&
      !loading &&
      !preparing &&
      !branch;
    try {
      const history = await getHistory(thread(), controller.signal);
      await publication.command(() => {
        if (!current()) return;
        const page = projectCheckpointHistory(historyPage, history);
        const views = checkpointViews(history);
        if (!current()) return;
        pageRefresh = undefined;
        historyPage = page;
        checkpointPage = views;
        writeLabel = { label: 'history' };
        republish();
      });
    } catch {
      /* The page stays as it was last read. */
    } finally {
      if (pageRefresh === controller) pageRefresh = undefined;
    }
  }
  function cancelPageRefresh() {
    const previous = pageRefresh;
    pageRefresh = undefined;
    previous?.abort();
  }
  /** Publishes changed backend fields under the status already published. */
  function republish() {
    const { status, error } = publication.getSnapshot();
    publish(status, error);
  }
  function detach(outcome: CompleteOutcome): Attempt | undefined {
    const attempt = owner;
    if (!attempt) return;
    owner = undefined;
    recoveryAttempt = undefined;
    replayable = undefined;
    retained = undefined;
    for (const call of attempt.calls.values()) {
      const current = state.toolCalls.find((entry) => entry.id === call.id);
      if (current?.status !== 'running') continue;
      if (unsettledTools.has(call.id)) {
        state = reduceMessages(state, { type: 'tool-unsettled', id: call.id });
        continue;
      }
      resolvedTools.add(call.id);
      authoredTools.add(call.id);
      state = reduceMessages(state, {
        type: 'tool',
        toolCall: resultCall(call, cancelledResult(call.id)),
      });
    }
    state = reduceMessages(state, {
      type: 'complete',
      generation: attempt.generation,
      outcome,
    });
    subgraphs = settleSubgraphs(subgraphs, outcome);
    attempt.subgraphs = subgraphs;
    attempt.resolve(outcome);
    return attempt;
  }

  async function executeTools(attempt: Attempt, groups: number) {
    assertInvocationIdentity();
    const calls = state.toolCalls.filter(
      (call) =>
        call.status === 'pending' &&
        definitions.has(call.name) &&
        attempt.projection.toolCallIds?.includes(call.id) &&
        !resolvedTools.has(call.id)
    );
    if (!calls.length) return 'complete';
    // Capture all calls before publication: observers may synchronously stop.
    for (const call of calls) {
      state = reduceMessages(state, { type: 'tool-admitted', toolCall: call });
      attempt.calls.set(call.id, call);
      if (store && !definitions.get(call.name)?.idempotent)
        unsettledTools.add(call.id);
      state = reduceMessages(state, {
        type: 'tool',
        toolCall: { ...call, status: 'running' },
      });
    }
    pendingToolSettlements += calls.length;
    publish('running');
    await Promise.all(
      calls.map(async (call) => {
        try {
          const definition = definitions.get(call.name);
          if (!definition) return;
          const outcome = await executeTool(
            definition,
            call,
            attempt.controller.signal,
            { threadId: threadId ?? '', toolCallId: call.id },
            store,
            groups >= 10
          );
          if (outcome.type === 'conflict') {
            // This durable fact belongs to the admitted invocation, even after
            // command handoff. Commit it before abort hooks or publication.
            state = reduceMessages(state, {
              type: 'tool-conflict',
              id: call.id,
            });
            if (!disposed) {
              if (owner)
                settle(owner, 'interrupted', invocationConflictError());
              else publish('error', invocationConflictError());
            }
            return;
          }
          if (outcome.type !== 'settled') {
            if (outcome.type === 'not-started') unsettledTools.delete(call.id);
            if (owns(attempt)) {
              state = reduceMessages(state, {
                type: 'tool-unsettled',
                id: call.id,
              });
              publish('running');
            }
            return;
          }
          const result = outcome.result;
          attempt.branch?.settledToolIds.add(call.id);
          resolvedTools.add(call.id);
          authoredTools.add(call.id);
          buffer.stage(call.id, result);
          unsettledTools.delete(call.id);
          if (owns(attempt)) {
            state = reduceMessages(state, {
              type: 'tool',
              toolCall: resultCall(call, result),
            });
            publish('running');
          }
          if (!owns(attempt)) {
            // Required durable cleanup may finish after stop/dispose. It can only
            // persist results; it has no route back to publication or run creation.
            try {
              await persistence.flush(
                new AbortController().signal,
                attempt.branch
              );
            } catch {
              /* The staged result remains available for explicit handoff. */
            }
          }
        } finally {
          pendingToolSettlements -= 1;
        }
      })
    );
    if (unsettledTools.size) return 'blocked';
    return groups < 10 &&
      calls.some((call) => definitions.get(call.name)?.followUp)
      ? 'follow-up'
      : 'complete';
  }
  function stopExecution() {
    cancelPageRefresh();
    const dropped = queue.splice(0);
    const preparation = detachPreparation();
    const hadRetained = !!retained;
    const previousRetained = retained;
    const previousOwner = owner;
    const run = previousOwner?.physical;
    const retainBranch =
      previousOwner?.branch &&
      run &&
      !run.positionConfirmed &&
      !run.evidence.unsafe &&
      run.evidence.runId &&
      run.evidence.cursor &&
      canReconnect
        ? { attempt: previousOwner, run }
        : undefined;
    retained = undefined;
    const reading = detachLoad();
    const checking = invalidateCheck();
    const attempt = detach('aborted');
    if (attempt?.branch)
      attempt.branch.state = uncertainCheckpoint(attempt.branch.state);
    retained = retainBranch ?? (branch ? previousRetained : undefined);
    if (attempt || hadRetained) publish('idle');
    else if (dropped.length) republish();
    for (const entry of dropped) entry.resolve('aborted');
    if (dropped.length) void cancelRuns(dropped);
    checking?.abort();
    if (attempt) close(attempt, true);
    closeLoad(reading);
    closePreparation(preparation);
  }

  /** Asks the backend to cancel runs the session no longer waits for. */
  async function cancelRuns(entries: readonly QueuedRun[]): Promise<boolean> {
    if (!cancelRun || threadId === undefined) return false;
    const id = threadId;
    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          await cancelRun(id, entry.id, new AbortController().signal);
          return true;
        } catch {
          return false;
        }
      })
    );
    return results.every(Boolean);
  }

  /** The run-creation settings for one physical run of an attempt. The
   * session's own needs come first; a caller's settings add to them. */
  function requestOptions(
    attempt: Pick<Attempt, 'runOptions' | 'input'>,
    choices: {
      readonly from?: OwnedCheckpointPosition;
      readonly capture?: (run: { run_id: string; thread_id?: string }) => void;
      readonly resuming?: boolean;
      readonly first: boolean;
      readonly notify?: () => boolean;
    }
  ): LangGraphSubmitOptions | undefined {
    const { from, capture, first } = choices;
    const answer =
      choices.resuming &&
      attempt.input.kind === 'resume' &&
      attempt.input.value !== undefined
        ? { resume: attempt.input.value }
        : undefined;
    if (suppliedTransport && !attempt.runOptions && !capture && !answer)
      return undefined;
    const { run: settings, ...base } = attempt.runOptions ?? {};
    const {
      command,
      checkpoint,
      checkpointId,
      streamMode,
      onRunCreated,
      ...passed
    } = settings ?? {};
    const required = !suppliedTransport || from;
    const modes =
      required || streamMode
        ? [
            ...new Set([
              ...(required ? checkpointStreamModes : []),
              ...(streamMode ?? []),
            ]),
          ]
        : undefined;
    const sent =
      first && (command || answer) ? { ...command, ...answer } : undefined;
    const created =
      capture || onRunCreated
        ? (run: { run_id: string; thread_id?: string }) => {
            capture?.(run);
            if (!onRunCreated || choices.notify?.() === false) return;
            try {
              onRunCreated(run);
            } catch {
              /* Application callbacks cannot affect the run. */
            }
          }
        : undefined;
    return {
      ...base,
      ...(capture
        ? { streamResumable: true, onDisconnect: 'continue' as const }
        : {}),
      ...passed,
      ...(from
        ? { checkpoint: from }
        : first && checkpoint !== undefined
        ? { checkpoint }
        : first && checkpointId !== undefined
        ? { checkpointId }
        : {}),
      ...(modes ? { streamMode: modes } : {}),
      ...(created ? { onRunCreated: created } : {}),
      ...(sent ? { command: sent } : {}),
    };
  }

  function reconcile(attempt: Attempt, history: ThreadState[]) {
    const previousState = state;
    const previousValues = values;
    const previousInterrupts = interrupts;
    const previousProjection = attempt.projection;
    const latest = history[0];
    if (!latest) return undefined;
    const checkpointValues = record(latest.values);
    const messages = Array.isArray(checkpointValues?.['messages'])
      ? checkpointValues['messages']
      : [];
    const invocations = observeHistoryInvocations(
      previousState.invocations,
      messages
    );
    if (hasInvocationConflict(invocations)) {
      // Keep the attempt transcript while committing the independently observed
      // identity facts only after the caller's ownership/revision check.
      return {
        state: Object.freeze({ ...previousState, invocations }),
        projection: previousProjection,
        values: projectHistoryValues(previousValues, history),
        interrupts: projectHistoryInterrupts(previousInterrupts, history),
        outcome: 'interrupted' as const,
      };
    }
    // Inert construction gives us no server baseline. Only our unique submitted
    // user ID can correlate this checkpoint to this request, including when the
    // persisted assistant retains the ID of its earlier streamed partial. A
    // resume anchors on the turn's existing user message instead.
    const anchor = messages.findIndex(
      (value) => record(value)?.['id'] === previousProjection.userId
    );
    if (anchor < 0) return undefined;
    const after = messages.slice(anchor + 1);
    const nextUser = after.findIndex((value) => {
      const message = record(value);
      return message?.['type'] === 'human' || message?.['role'] === 'user';
    });
    const turn = nextUser < 0 ? after : after.slice(0, nextUser);
    // A continuation cannot be recovered from the earlier tool-producing step.
    // Its exact handoff must be present, with conclusive activity after it.
    const handoffs = attempt.handoffIds.map((id) =>
      turn.findIndex((value) => record(value)?.['id'] === id)
    );
    if (handoffs.some((index) => index < 0)) return undefined;
    const evidence = handoffs.length
      ? turn.slice(Math.max(...handoffs) + 1)
      : turn;
    const projectedInterrupts = projectHistoryInterrupts(
      previousInterrupts,
      history
    );
    let paused: boolean;
    let committed: boolean;
    if (attempt.input.kind === 'resume') {
      // A decision leaves no new user message. Its evidence is activity the
      // turn did not have when the decision was sent, or a pause the thread
      // did not have. The same pause with nothing new is inconclusive: the
      // decision may never have landed, or may still be executing before its
      // first checkpoint, and either way it must not be replayed from here.
      const known = previousProjection.resume?.turnIds ?? [];
      const activity = turn.some((value) => {
        const message = record(value);
        return (
          !!message &&
          typeof message['id'] === 'string' &&
          !known.includes(message['id']) &&
          (message['type'] === 'ai' ||
            message['type'] === 'tool' ||
            message['role'] === 'assistant')
        );
      });
      paused =
        nextUser < 0 &&
        projectedInterrupts.length > 0 &&
        (activity ||
          !sameInterrupts(projectedInterrupts, attempt.input.interrupts));
      committed =
        nextUser >= 0 ||
        (projectedInterrupts.length === 0 &&
          activity &&
          latest.next.length === 0);
    } else {
      paused = nextUser < 0 && projectedInterrupts.length > 0;
      committed =
        (nextUser >= 0 || latest.next.length === 0) &&
        evidence.some((value) => {
          const message = record(value);
          return (
            message &&
            (message['type'] === 'ai' ||
              (attempt.handoffIds.length === 0 && message['type'] === 'tool') ||
              message['role'] === 'assistant') &&
            typeof message['id'] === 'string'
          );
        });
    }
    if (!paused && !committed) return undefined;
    const projected = projectStream(previousState, previousProjection, {
      type: 'values',
      data: { messages: [messages[anchor], ...turn] },
    });
    const projectedValues = projectHistoryValues(previousValues, history);
    // Stream projection owns its own read of history data. A getter may have
    // changed since the identity scan, so final completion follows its facts.
    const conflicted = hasInvocationConflict(projected.state.invocations);
    return {
      state: conflicted
        ? projected.state
        : finalizeProjection(projected.state, projected.projection),
      projection: { ...projected.projection, paused: !conflicted && paused },
      values: projectedValues,
      interrupts: projectedInterrupts,
      outcome: conflicted
        ? ('interrupted' as const)
        : paused
        ? ('paused' as const)
        : ('success' as const),
    };
  }

  async function execute(attempt: Attempt): Promise<void> {
    if (!owns(attempt)) return;
    // A captured run id does not bar the read-only history check: the check
    // correlates by this turn's own user message, not by run identity, and it
    // is the only portable recovery the core contract can surface. Exact-run
    // status, when available, decides whether history is conclusive yet.
    const attemptCanCheck = () =>
      !attempt.branch &&
      (attempt.input.kind === 'submit' ||
        (attempt.input.kind === 'resume' && attempt.groups === 0)) &&
      canCheck &&
      !attempt.scripted &&
      !attempt.physical?.evidence.unsafe;
    // Development only: an armed scripted run stands in for the network, so
    // it creates no thread either.
    let script =
      attempt.joinStart || attempt.joinCursor !== undefined
        ? null
        : takeScript();
    if (script) attempt.scripted = true;
    if (threadId === undefined && !script) {
      // The first submit of a session without a thread creates it before the
      // run. A replacing submit waits for the same request.
      try {
        await ensureThread();
      } catch (raw) {
        if (owns(attempt)) settle(attempt, 'error', threadCreationError(raw));
        return;
      }
      if (!owns(attempt)) return;
    }
    try {
      let groups = attempt.groups;
      let input = attempt.input.kind === 'submit' ? attempt.input.messages : [];
      while (owns(attempt)) {
        assertInvocationIdentity();
        const joinCursor = attempt.joinCursor;
        const joining = joinCursor !== undefined || attempt.joinStart === true;
        const run: PhysicalRun =
          joining && attempt.physical
            ? attempt.physical
            : {
                batch: buffer.snapshot(),
                evidence: {},
                captureOpen: true,
                received: false,
                confirmed: false,
              };
        attempt.physical = run;
        const batch = run.batch;
        attempt.handoffIds =
          groups > 0 ? batch.messages.map((message) => message.id) : [];
        const resuming = groups === 0 && attempt.input.kind === 'resume';
        const payload = resuming
          ? null
          : runPayload(
              [...batch.messages, ...input],
              !joining && groups === 0 && attempt.input.kind === 'submit'
                ? attempt.input.state
                : undefined
            );
        const scripted = joining ? null : script ?? (groups > 0 ? takeScript() : null);
        script = null;
        if (scripted) attempt.scripted = true;
        const from =
          attempt.branch && !joining
            ? readyCheckpoint(attempt.branch.state).position
            : undefined;
        if (attempt.branch && !joining)
          attempt.branch.state = beginCheckpointEffect(
            attempt.branch.state,
            'run'
          );
        // Ownership is captured before the first effect. The signal always belongs
        // to us, even when the caller also supplied an external AbortSignal.
        const capture = (metadata: { run_id: string; thread_id?: string }) => {
          if (!owns(attempt) || attempt.physical !== run || !run.captureOpen)
            return;
          const previous = run.evidence;
          let evidence: RunEvidence;
          try {
            evidence = run.received
              ? { unsafe: true }
              : captureRun(previous, metadata, thread());
          } catch {
            evidence = { unsafe: true };
          }
          if (owns(attempt) && attempt.physical === run && run.captureOpen)
            run.evidence =
              run.evidence === previous ? evidence : { unsafe: true };
        };
        const events =
          joining && joinStream && run.evidence.runId
            ? joinStream(
                thread(),
                run.evidence.runId,
                joinCursor,
                attempt.controller.signal,
                ...(!suppliedTransport || attempt.branch
                  ? [{ streamMode: [...checkpointStreamModes] }]
                  : [])
              )
            : scripted
            ? streamScript(scripted.frames, attempt.controller.signal)
            : transport.stream(
                assistantId,
                thread(),
                payload,
                attempt.controller.signal,
                requestOptions(attempt, {
                  from,
                  ...(canReconnect ? { capture } : {}),
                  resuming,
                  first: groups === 0,
                  notify: () => owns(attempt),
                })
              );
        attempt.iterator = events[Symbol.asyncIterator]();
        if (!owns(attempt)) {
          close(attempt);
          return;
        }
        while (owns(attempt)) {
          const next = await attempt.iterator.next();
          if (!owns(attempt)) return;
          if (next.done) break;
          // Run creation precedes stream frames. A later callback cannot safely
          // attach an identity to already consumed data, including reentrant getters.
          const firstEvent = !run.received;
          run.received = true;
          const event = convertEventMessages(
            captureStreamEvent(next.value),
            toMessage
          );
          if (!owns(attempt)) return;
          if (developmentRuntime && firstEvent)
            safely(() => developmentRuntime.milestone('transport.connected'));
          const custom = captureCustomEvent(event);
          const binding = captureDelegationBinding(event);
          const previousState = state;
          const previousValues = values;
          const previousInterrupts = interrupts;
          const previousProjection = attempt.projection;
          if (event.type === 'error' && !event.namespace?.length) {
            const error = failureProjection(
              event['data'] ?? event,
              protectedTransport,
              true,
              attemptCanCheck()
            );
            settle(attempt, 'error', error);
            return;
          }
          const previousEvidence = run.evidence;
          const checkpoint = attempt.branch
            ? captureCheckpointEvent(event, thread())
            : undefined;
          const cursor = advanceCursor(previousEvidence, event, joinCursor);
          if (!owns(attempt)) return;
          if (cursor.replay) {
            run.evidence = cursor.evidence;
            throw new Error('The joined stream repeated its requested cursor.');
          }
          const projected = isTranscriptEvent(event, transcriptNodeNames)
            ? projectStream(previousState, previousProjection, event)
            : { state: previousState, projection: previousProjection };
          const projectedValues = projectValues(previousValues, event);
          const projectedInterrupts = projectInterrupts(
            previousInterrupts,
            event
          );
          const projectedSubgraphs = projectSubgraphs(
            subgraphs,
            event,
            groups === 0
              ? attempt.generation
              : `${attempt.generation}-step-${groups}`,
            attempt.projection.messageIdPrefix
          );
          // All projections may invoke transport-owned getters. Commit no
          // candidate if projection failed or a getter changed the owner.
          if (!owns(attempt)) return;
          run.evidence =
            run.evidence === previousEvidence
              ? cursor.evidence
              : { unsafe: true };
          if (checkpoint) run.checkpoint = checkpoint;
          // The backend's statement outranks inference but never rewrites it.
          if (binding && !delegationBindings.has(binding.segment))
            delegationBindings.set(binding.segment, binding.toolCallId);
          state = projected.state;
          values = projectedValues;
          interrupts = projectedInterrupts;
          subgraphs = projectedSubgraphs;
          attempt.subgraphs = subgraphs;
          attempt.projection = {
            ...projected.projection,
            paused: projectedInterrupts.length > 0,
          };
          if (hasInvocationConflict(state.invocations)) {
            settle(attempt, 'interrupted', invocationConflictError());
            return;
          }
          lifecycle.mark('streamStartedAt');
          writeLabel = { event: event.type };
          customWrite = !!custom;
          publish('running');
          // publish drains observer commands before returning. Never dispatch or
          // read on behalf of an attempt a listener just stopped/superseded.
          if (!owns(attempt)) return;
          if (custom) {
            publication.emitCustomEvent(custom);
            if (!owns(attempt)) return;
          }
        }
        if (!owns(attempt)) return;
        run.captureOpen = false;
        let outcome: CompleteOutcome = attempt.projection.paused
          ? 'paused'
          : attempt.projection.terminal
          ? 'success'
          : 'interrupted';
        let status: RunStatus | undefined;
        let historyChecked = false;
        if (run.evidence.runId && !run.evidence.unsafe && getRunStatus) {
          try {
            status = await getRunStatus(
              thread(),
              run.evidence.runId,
              attempt.controller.signal
            );
          } catch {
            /* Exact-run inspection failed; history cannot replace it. */
          }
          if (!owns(attempt)) return;
          if (attempt.branch) {
            if (status !== 'success' || !run.checkpoint || !getState) {
              outcome = 'interrupted';
            } else {
              run.confirmed = true;
              const saved = await getState(
                thread(),
                run.checkpoint.position,
                attempt.controller.signal
              );
              if (!owns(attempt)) return;
              const confirmed = confirmCheckpoint(
                run.checkpoint,
                saved,
                run.evidence.runId
              );
              assertCheckpointToolEvidence(
                confirmed.state,
                state,
                attempt.projection,
                resolvedTools,
                attempt.branch.settledToolIds
              );
              const projectedInterrupts = projectHistoryInterrupts(interrupts, [
                confirmed.state,
              ]);
              if (!owns(attempt)) return;
              attempt.branch.state = { kind: 'ready', confirmed };
              run.positionConfirmed = true;
              interrupts = projectedInterrupts;
              attempt.projection = {
                ...attempt.projection,
                paused: confirmed.paused,
              };
              outcome = confirmed.paused ? 'paused' : 'success';
            }
          } else if (
            (status === 'success' || status === 'interrupted') &&
            attempt.projection.paused
          ) {
            outcome = 'paused';
            run.confirmed = true;
          } else if (status === 'success' && attempt.projection.terminal) {
            outcome = 'success';
            run.confirmed = true;
          } else if (
            status === 'error' ||
            status === 'timeout' ||
            status === 'interrupted'
          ) {
            run.confirmed = true;
            // 'interrupted' is ambiguous: the pause event may have been lost
            // when the stream dropped, or a newer run cancelled this one.
            // Only this turn's saved checkpoint tells the two apart.
            let recovered: ReturnType<typeof reconcile>;
            if (status === 'interrupted' && attemptCanCheck() && getHistory) {
              historyChecked = true;
              try {
                const history = await getHistory(
                  thread(),
                  attempt.controller.signal
                );
                if (!owns(attempt)) return;
                recovered = reconcile(attempt, history);
                if (!owns(attempt)) return;
              } catch {
                if (!owns(attempt)) return;
              }
            }
            if (!recovered) {
              settle(
                attempt,
                status === 'interrupted' ? 'interrupted' : 'error',
                runFailureError(status, attempt)
              );
              return;
            }
            state = recovered.state;
            values = recovered.values;
            interrupts = recovered.interrupts;
            attempt.projection = recovered.projection;
            outcome = recovered.outcome;
          } else outcome = 'interrupted';
        } else if (run.evidence.unsafe || attempt.branch)
          outcome = 'interrupted';
        // While the exact run is known to be in flight, its saved state is
        // not conclusive yet; the check stays available for later instead.
        if (
          outcome === 'interrupted' &&
          !historyChecked &&
          status !== 'pending' &&
          status !== 'running' &&
          attemptCanCheck() &&
          getHistory
        ) {
          try {
            const history = await getHistory(
              thread(),
              attempt.controller.signal
            );
            if (!owns(attempt)) return;
            const recovered = reconcile(attempt, history);
            if (!owns(attempt)) return;
            if (recovered) {
              state = recovered.state;
              values = recovered.values;
              interrupts = recovered.interrupts;
              attempt.projection = recovered.projection;
              outcome = recovered.outcome;
            }
          } catch {
            if (!owns(attempt)) return;
          }
        }
        if (!owns(attempt)) return;
        if (hasInvocationConflict(state.invocations)) {
          settle(attempt, 'interrupted', invocationConflictError());
          return;
        }
        if (outcome === 'success' || outcome === 'paused') {
          state = finalizeProjection(state, attempt.projection);
          subgraphs = settleSubgraphs(subgraphs, outcome, true);
          attempt.subgraphs = subgraphs;
          // The exact saved pause confirms the submitted handoff just as a
          // completed run does. Keeping that batch would block its own resume.
          if (outcome === 'paused' && attempt.branch && run.positionConfirmed)
            persistence.acknowledge(batch);
        }
        if (outcome === 'success') {
          state = reduceMessages(state, {
            type: 'complete',
            generation: attempt.generation,
            outcome: 'success',
          });
          persistence.acknowledge(batch);
          const followUp = await executeTools(attempt, groups);
          if (!owns(attempt)) return;
          if (followUp === 'blocked') {
            // Persist legitimate mixed-group results without continuing past
            // an unavailable call. Failed writes keep the exact staged buffer.
            try {
              await persistence.flush(
                attempt.controller.signal,
                attempt.branch
              );
            } catch {
              /* retained */
            }
            if (owns(attempt))
              settle(attempt, 'interrupted', unsettledToolError());
            return;
          }
          if (followUp === 'follow-up') {
            groups += 1;
            attempt.groups = groups;
            attempt.joinCursor = undefined;
            attempt.joinStart = false;
            attempt.physical = undefined;
            subgraphs = initialSubgraphs(subgraphs.subgraphs);
            attempt.subgraphs = subgraphs;
            close(attempt, false, false);
            if (!owns(attempt)) return;
            attempt.closed = false;
            attempt.iterator = undefined;
            attempt.projection = {
              generation: attempt.generation,
              messageIdPrefix: `${attempt.generation}-step-${groups}`,
              userId: attempt.projection.userId,
              baselineIds: state.messages.map((message) => message.id),
              sawAssistant: false,
              terminal: false,
              paused: false,
              canonical: [],
              ...(attempt.branch
                ? { baselineCallIds: attempt.branch.baselineCallIds }
                : {}),
              ...(attempt.input.kind === 'resume'
                ? {
                    resume: {
                      ...attempt.projection.resume,
                      turnIds: turnIds(attempt.projection.userId),
                    },
                  }
                : {}),
            };
            input = [];
            continue;
          }
          try {
            await persistence.flush(attempt.controller.signal, attempt.branch);
          } catch {
            if (owns(attempt))
              settle(attempt, 'error', {
                kind: 'server',
                message:
                  'Tool results could not be persisted. They remain staged for the next submission.',
                retryable: false,
                recovery: 'none',
              });
            return;
          }
          if (!owns(attempt)) return;
        }
        settle(
          attempt,
          outcome,
          outcome === 'interrupted'
            ? interruptionError(attemptCanCheck())
            : undefined,
          outcome === 'interrupted'
        );
        return;
      }
    } catch (raw) {
      if (!owns(attempt)) return;
      if (attempt.physical) attempt.physical.captureOpen = false;
      const error = failureProjection(
        raw,
        protectedTransport,
        false,
        attemptCanCheck()
      );
      // A thrown stream gets the same single read-only reconciliation a closed
      // one gets, unless the exact run is known to be still in flight. A
      // conclusive answer settles the attempt itself; nothing is retried.
      if (
        error.kind === 'interrupted' &&
        error.recovery === 'check' &&
        getHistory
      ) {
        const run = attempt.physical;
        let status: RunStatus | undefined;
        if (run?.evidence.runId && !run.evidence.unsafe && getRunStatus) {
          try {
            status = await getRunStatus(
              thread(),
              run.evidence.runId,
              attempt.controller.signal
            );
          } catch {
            /* Unknown exact status; history may still be conclusive. */
          }
          if (!owns(attempt)) return;
        }
        if (status !== 'pending' && status !== 'running') {
          try {
            const history = await getHistory(
              thread(),
              attempt.controller.signal
            );
            if (!owns(attempt)) return;
            const recovered = reconcile(attempt, history);
            if (!owns(attempt)) return;
            if (recovered) {
              // Settlement stamps deliveries and subgraphs with this outcome.
              state = recovered.state;
              values = recovered.values;
              interrupts = recovered.interrupts;
              settle(attempt, recovered.outcome);
              return;
            }
          } catch {
            if (!owns(attempt)) return;
          }
        }
      }
      settle(
        attempt,
        error.kind === 'interrupted' ? 'interrupted' : 'error',
        error,
        true
      );
    }
  }

  function turnIds(userId: string | undefined) {
    const anchor = state.messages.findIndex((message) => message.id === userId);
    const after = state.messages.slice(anchor + 1);
    const nextUser = after.findIndex((message) => message.role === 'user');
    return (nextUser < 0 ? after : after.slice(0, nextUser)).map(
      (message) => message.id
    );
  }

  function beginAttempt(
    input: AttemptInput,
    external?: AbortSignal,
    runOptions?: CapturedRunOptions,
    requestType = input.kind === 'submit'
      ? 'submit'
      : input.bare
      ? 'continue'
      : 'resume'
  ): Attempt {
    cancelPageRefresh();
    const reading = detachLoad();
    const checking = invalidateCheck();
    const previous = detach('interrupted');
    subgraphs = initialSubgraphs(
      input.kind === 'submit' ? undefined : subgraphs.subgraphs
    );
    const generation = crypto.randomUUID();
    const userId =
      input.kind === 'submit'
        ? input.messages[0].id
        : state.messages.filter((message) => message.role === 'user').at(-1)
            ?.id;
    let resolve!: Attempt['resolve'];
    const result = new Promise<CompleteOutcome>((done) => {
      resolve = done;
    });
    const created: Attempt = {
      controller: new AbortController(),
      generation,
      result,
      resolve,
      calls: new Map(),
      groups: 0,
      handoffIds: [],
      input,
      baseline: { state, values },
      runOptions,
      branch,
      subgraphs,
      projection: {
        generation,
        userId,
        baselineIds: state.messages.map((m) => m.id),
        sawAssistant: false,
        terminal: false,
        paused: false,
        canonical: [],
        ...(branch ? { baselineCallIds: branch.baselineCallIds } : {}),
        ...(input.kind === 'resume'
          ? { resume: { turnIds: turnIds(userId) } }
          : {}),
      },
    };
    owner = created;
    recoveryAttempt = undefined;
    replayable = undefined;
    retained = undefined;

    if (input.kind === 'submit')
      state = reduceMessages(state, {
        type: 'message',
        mode: 'snapshot',
        message: {
          id: input.messages[0].id,
          role: 'user',
          content: input.messages[0].content,
          delivery: completeDelivery(generation, 'success'),
        },
      });
    interrupts = projectHistoryInterrupts(interrupts, []);
    if (external) {
      const abort = () => {
        void publication.command(() => {
          if (owns(created)) {
            stopExecution();
          }
        });
      };
      created.unlink = () => external.removeEventListener('abort', abort);
      external.addEventListener('abort', abort, { once: true });
      if (external.aborted) abort();
    }
    if (owns(created)) {
      if (input.kind === 'resume' && !input.bare)
        lifecycle.mark('interruptResolvedAt');
      reportRequest(created, requestType);
      writeLabel = { label: 'run:start' };
      publish('running');
    }
    checking?.abort();
    if (previous) close(previous, true);
    closeLoad(reading);
    return created;
  }

  function dispatch(
    beginning: Promise<void>,
    readAttempt: () => Attempt | undefined
  ): Promise<CompleteOutcome> {
    // Observer commands finish draining before this continuation can issue I/O.
    return beginning.then(() => {
      const attempt = readAttempt();
      if (!attempt) return 'aborted';
      void execute(attempt);
      return attempt.result;
    });
  }

  function prepare(
    checkpoint: OwnedCheckpointPosition,
    external: AbortSignal | undefined,
    adopt: Preparation['adopt']
  ) {
    let resolve!: Preparation['resolve'];
    let reject!: Preparation['reject'];
    const result = new Promise<CompleteOutcome>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    const created: Preparation = {
      controller: new AbortController(),
      result,
      resolve,
      reject,
      checkpoint,
      adopt,
    };
    preparing = created;
    if (external) {
      const abort = () => {
        void publication.command(() => {
          if (preparing === created) stopExecution();
        });
      };
      created.unlink = () => external.removeEventListener('abort', abort);
      external.addEventListener('abort', abort, { once: true });
      if (external.aborted) abort();
    }
    return created;
  }

  async function runPreparation(preparation: Preparation) {
    if (preparing !== preparation || disposed || !getState) return;
    try {
      const saved = await getState(
        thread(),
        preparation.checkpoint,
        preparation.controller.signal
      );
      let attempt: Attempt | undefined;
      await publication.command(() => {
        if (preparing !== preparation || disposed) return;
        const commit = preparation.adopt(saved);
        if (preparing !== preparation || disposed) return;
        preparing = undefined;
        attempt = commit();
        preparation.unlink?.();
        void attempt.result.then(preparation.resolve);
      });
      if (attempt) void execute(attempt);
    } catch {
      await publication.command(() => {
        if (preparing !== preparation || disposed) return;
        preparing = undefined;
        preparation.reject(createSafeRequestError());
        closePreparation(preparation);
      });
    }
  }

  function fork(
    checkpoint: CheckpointReference,
    input: LangGraphSubmitInput,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    let preparation: Preparation | undefined;
    const beginning = publication.command(() => {
      if (disposed) return;
      admitBranchCommand();
      if (!getState || !getRunStatus || !joinStream)
        throw new Error(
          'Fork requires exact checkpoint and physical-run transport capabilities.'
        );
      if (!suppliedTransport && ownedRetries > 0)
        throw new Error(
          'Fork requires an SDK transport with maxRetries set to zero.'
        );
      if (threadId === undefined)
        throw new Error('Fork requires the session thread to exist.');
      const capturedRevision = revision;
      const external = options?.signal;
      const current = () =>
        !disposed && !external?.aborted && capturedRevision === revision;
      if (!current()) return;
      const position = captureCheckpoint(checkpoint, thread());
      if (!current()) return;
      const captured = captureSubmitInput(input);
      if (!current()) return;
      const runOptions = captureRunOptions(options);
      if (!current()) return;
      admitBranchCommand();
      preparation = prepare(position, external, (raw) => {
        const source = captureCompletedCheckpoint(raw, position);
        let projected = projectHistory(state, [source.state], {
          interrupts: [],
          ...(typedTools
            ? { registeredTools: new Set(definitions.keys()) }
            : {}),
        });
        let invocations = projected.invocations;
        for (const call of source.calls)
          invocations = observeInvocation(invocations, call, true);
        projected = Object.freeze({ ...projected, invocations });
        if (hasInvocationConflict(invocations))
          throw new Error(invocationConflictError().message);
        const projectedValues = projectHistoryValues(values, [source.state]);
        return () => {
          state = projected;
          values = projectedValues;
          authoredTools.clear();
          for (const call of source.calls) resolvedTools.add(call.id);
          branch = {
            state: {
              kind: 'ready',
              confirmed: { position, state: source.state, paused: false },
            },
            baselineCallIds: source.calls.map((call) => call.id),
            settledToolIds: new Set(),
          };
          return beginAttempt(
            {
              kind: 'submit',
              state: captured.state,
              messages: [
                {
                  type: 'human',
                  id: crypto.randomUUID(),
                  content: captured.message,
                },
              ],
            },
            external,
            runOptions
          );
        };
      });
    });
    return beginning.then(() => {
      if (!preparation) return 'aborted';
      void runPreparation(preparation);
      return preparation.result;
    });
  }

  function submit(
    input: LangGraphSubmitInput | null | undefined,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    let queued: Parameters<typeof enqueueRun>[0] | undefined;
    const beginning = publication.command(() => {
      if (disposed) return;
      admitSubmission();
      const capturedRevision = revision;
      const capturedLoad = loading;
      const external = options?.signal;
      // Even the signal getter can synchronously stop or replace this command.
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const captured =
        input === null || input === undefined
          ? undefined
          : captureSubmitInput(input);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const runOptions = captureRunOptions(options);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      admitSubmission();
      const settings = runOptions?.run;
      const from = settings?.checkpointId ?? settings?.checkpoint?.checkpoint_id;
      if (from !== undefined && branch)
        throw new Error(
          'A checkpoint branch starts its runs from its own checkpoint.'
        );
      const attemptInput: AttemptInput = captured
        ? {
            kind: 'submit',
            state: captured.state,
            messages: [
              {
                type: 'human',
                id: crypto.randomUUID(),
                content: captured.message,
              },
            ],
          }
        : { kind: 'resume', value: undefined, interrupts, bare: true };
      if (settings?.multitaskStrategy === 'enqueue' && owner) {
        if (threadId === undefined)
          throw new Error('A run cannot be queued before its thread exists.');
        if (!createQueuedRun || !joinStream)
          throw new Error(
            'Queueing requires transport.createQueuedRun() and transport.joinStream().'
          );
        queued = { input: attemptInput, runOptions, external };
        return;
      }
      // The local transcript goes back to the checkpoint when its state is
      // known, so the run's stream continues from what the checkpoint held.
      const source =
        from === undefined
          ? undefined
          : checkpointPage?.checkpoints.find(
              (checkpoint) => checkpoint.id === from
            );
      if (source) {
        const saved = [source.saved as unknown as ThreadState];
        const projected = projectHistory(state, saved, {
          interrupts: [],
          ...(typedTools
            ? { registeredTools: new Set(definitions.keys()) }
            : {}),
        });
        if (hasInvocationConflict(projected.invocations))
          throw new Error(invocationConflictError().message);
        state = projected;
        values = projectHistoryValues(values, saved);
        authoredTools.clear();
      }
      attempt = beginAttempt(attemptInput, external, runOptions);
      if (from !== undefined && !source) attempt.travel = true;
    });
    return beginning.then(() => {
      if (queued) return enqueueRun(queued);
      if (!attempt) return 'aborted';
      void execute(attempt);
      return attempt.result;
    });
  }

  /** Creates a queued run on the backend and waits for its turn. */
  async function enqueueRun(request: {
    readonly input: AttemptInput;
    readonly runOptions: CapturedRunOptions | undefined;
    readonly external: AbortSignal | undefined;
  }): Promise<CompleteOutcome> {
    const create = createQueuedRun;
    if (!create || threadId === undefined) throw createSafeRequestError();
    if (developmentRuntime) safely(() => developmentRuntime.touch());
    report('tplane:runtime_request_created', { requestType: 'enqueue' });
    const { input } = request;
    let run: RunEvidence;
    let created: { run_id: string; thread_id?: string };
    try {
      const entry = await create(
        assistantId,
        threadId,
        input.kind === 'submit'
          ? runPayload(input.messages, input.state)
          : null,
        request.external ?? new AbortController().signal,
        {
          ...requestOptions(request, {
            first: true,
            // The queue calls back once the run is recorded.
            notify: () => false,
          }),
          ...(canReconnect
            ? { streamResumable: true, onDisconnect: 'continue' as const }
            : {}),
          multitaskStrategy: 'enqueue',
          onRunCreated: undefined,
        }
      );
      created = { run_id: entry.id, thread_id: entry.threadId };
      run = captureRun({}, created, threadId);
    } catch {
      throw createSafeRequestError();
    }
    if (run.unsafe || !run.runId) throw createSafeRequestError();
    const id = run.runId;
    return publication.command(() => {
      // The backend still runs it, but a disposed session observes nothing.
      if (disposed) return 'aborted' as const;
      let resolve!: QueuedRun['resolve'];
      const result = new Promise<CompleteOutcome>((done) => {
        resolve = done;
      });
      queue.push({
        id,
        ...(input.kind === 'submit'
          ? { message: input.messages[0].content }
          : {}),
        createdAt: Date.now(),
        input,
        runOptions: request.runOptions,
        result,
        resolve,
      });
      try {
        request.runOptions?.run?.onRunCreated?.(created);
      } catch {
        /* Application callbacks cannot affect the run. */
      }
      writeLabel = { label: 'queue' };
      if (owner) republish();
      // The active run can end while the queued one is being created.
      else drainQueue();
      return result;
    });
  }

  /** Joins the oldest queued run once nothing else owns the session. */
  function drainQueue() {
    let attempt: Attempt | undefined;
    void publication
      .command(() => {
        if (
          disposed ||
          owner ||
          loading ||
          preparing ||
          branch ||
          !joinStream ||
          !queue.length
        )
          return;
        const entry = queue.shift() as QueuedRun;
        attempt = beginAttempt(
          entry.input,
          undefined,
          entry.runOptions,
          'join_queued'
        );
        attempt.physical = {
          batch: buffer.snapshot(),
          evidence: { runId: entry.id },
          captureOpen: false,
          received: false,
          confirmed: false,
        };
        attempt.joinStart = true;
        void attempt.result.then(entry.resolve);
      })
      .then(() => {
        if (attempt) void execute(attempt);
      });
  }

  function joinRun(
    runId: string,
    lastEventId?: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      if (disposed) return;
      if (!joinStream)
        throw new Error('Joining a run requires transport.joinStream().');
      if (lastEventId !== undefined && typeof lastEventId !== 'string')
        throw new TypeError('lastEventId must be a string.');
      admitSubmission();
      const capturedRevision = revision;
      const external = options?.signal;
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        threadId === undefined
      )
        return;
      const evidence = captureRun({}, { run_id: runId }, threadId);
      if (evidence.unsafe || !evidence.runId)
        throw new TypeError('joinStream requires a valid run id.');
      attempt = beginAttempt(
        { kind: 'resume', value: undefined, interrupts, bare: true },
        external,
        undefined,
        'join'
      );
      attempt.physical = {
        batch: buffer.snapshot(),
        evidence,
        captureOpen: false,
        received: false,
        confirmed: false,
      };
      if (lastEventId) attempt.joinCursor = lastEventId;
      else attempt.joinStart = true;
    });
    return dispatch(beginning, () => attempt);
  }

  function cancelQueued(runId: string): Promise<boolean> {
    return publication
      .command(() => {
        const index = queue.findIndex((entry) => entry.id === runId);
        if (disposed || index < 0) return undefined;
        const [entry] = queue.splice(index, 1);
        republish();
        entry.resolve('aborted');
        return entry;
      })
      .then((entry) => (entry ? cancelRuns([entry]) : false));
  }

  function clearQueue(): Promise<void> {
    return publication
      .command(() => {
        if (disposed || !queue.length) return [];
        const entries = queue.splice(0);
        republish();
        for (const entry of entries) entry.resolve('aborted');
        return entries;
      })
      .then(async (entries) => {
        if (entries.length) await cancelRuns(entries);
      });
  }

  function resume(
    responses: readonly AgentInterruptResponse[],
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    let preparation: Preparation | undefined;
    const beginning = publication.command(() => {
      const capturedRevision = revision;
      const capturedLoad = loading;
      const external = options?.signal;
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const admit = () => {
        assertInvocationIdentity();
        if (branch || preparing) admitBranchCommand();
        // A check owned by an earlier resume is withdrawn by re-sending the
        // decision; one owned by an uncertain submit still blocks it.
        if (
          owner ||
          loading ||
          (recoveryAttempt && recoveryAttempt.input.kind !== 'resume') ||
          retained ||
          pendingToolSettlements ||
          persistence.pending ||
          unsettledTools.size ||
          buffer.snapshot().messages.length
        )
          throw new Error(
            'Resume cannot replace an active request, history load, recovery, or unsettled tool results.'
          );
        if (!interrupts.length)
          throw new Error('Resume requires an observed interrupt.');
      };
      admit();
      const value = resumeValue(responses, interrupts);
      if (branch && value === undefined)
        throw new Error('Branch resume requires a defined response value.');
      const captured = ownValue(value);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const runOptions = captureRunOptions(options);
      // Response getters are caller effects, not a lock-protected projection.
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      admit();
      if (branch) {
        if (!getState)
          throw new Error('Branch resume requires an exact checkpoint read.');
        const confirmed = readyCheckpoint(branch.state);
        preparation = prepare(confirmed.position, external, (saved) => {
          assertResumeCheckpoint(confirmed, saved);
          return () =>
            beginAttempt(
              { kind: 'resume', value: captured, interrupts },
              external,
              runOptions
            );
        });
        return;
      }
      attempt = beginAttempt(
        { kind: 'resume', value: captured, interrupts },
        external,
        runOptions
      );
    });
    return beginning.then(() => {
      if (preparation) {
        void runPreparation(preparation);
        return preparation.result;
      }
      if (!attempt) return 'aborted';
      void execute(attempt);
      return attempt.result;
    });
  }

  function reconnect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      const capturedRevision = revision;
      const external = options?.signal;
      if (disposed || external?.aborted) return;
      assertInvocationIdentity();
      const candidate = retained;
      if (
        owner ||
        loading ||
        preparing ||
        checkController ||
        pendingToolSettlements ||
        persistence.pending ||
        unsettledTools.size ||
        !candidate ||
        !canReconnect
      )
        throw new Error(
          'Reconnect requires an idle retained run with no unsettled work.'
        );
      if (
        buffer
          .snapshot()
          .messages.some(
            (message) => !candidate.run.batch.messages.includes(message)
          )
      )
        throw new Error('Reconnect cannot hand off unrelated staged results.');
      const generation = crypto.randomUUID();
      const projected = rebaseRun(
        state,
        candidate.attempt.projection,
        generation
      );
      const projectedSubgraphs = rebaseSubgraphs(
        candidate.attempt.subgraphs,
        generation
      );
      if (
        disposed ||
        external?.aborted ||
        revision !== capturedRevision ||
        retained !== candidate
      )
        return;
      const checking = invalidateCheck();
      let resolve!: Attempt['resolve'];
      const result = new Promise<CompleteOutcome>((done) => {
        resolve = done;
      });
      const created: Attempt = {
        controller: new AbortController(),
        generation,
        result,
        resolve,
        input: candidate.attempt.input,
        baseline: candidate.attempt.baseline,
        runOptions: candidate.attempt.runOptions,
        branch: candidate.attempt.branch,
        calls: new Map(),
        groups: candidate.attempt.groups,
        handoffIds: candidate.attempt.handoffIds,
        projection: projected.projection,
        subgraphs: projectedSubgraphs,
        physical: { ...candidate.run, captureOpen: false },
        joinCursor: candidate.run.evidence.cursor,
      };
      attempt = created;
      retained = undefined;
      recoveryAttempt = undefined;
      state = projected.state;
      subgraphs = projectedSubgraphs;
      owner = created;
      if (external) {
        const abort = () => {
          void publication.command(() => {
            if (owns(created)) stopExecution();
          });
        };
        created.unlink = () => external.removeEventListener('abort', abort);
        external.addEventListener('abort', abort, { once: true });
        if (external.aborted) abort();
      }
      if (owns(created)) {
        reportRequest(created, 'reconnect');
        writeLabel = { label: 'run:start' };
        publish('running');
      }
      checking?.abort();
    });
    return dispatch(beginning, () => attempt);
  }

  async function readHistory(read: HistoryRead) {
    if (!ownsLoad(read)) return;
    try {
      const capturedBranch = branch;
      const confirmed = capturedBranch && readyCheckpoint(capturedBranch.state);
      const history =
        confirmed && getState
          ? [
              captureCheckpointState(
                await getState(
                  thread(),
                  confirmed.position,
                  read.controller.signal
                ),
                confirmed.position
              ),
            ]
          : await getHistory!(thread(), read.controller.signal);
      await publication.command(() => {
        if (!ownsLoad(read)) return;
        const previousState = state;
        const previousValues = values;
        const previousInterrupts = interrupts;
        const projectedInterrupts = projectHistoryInterrupts(
          previousInterrupts,
          history
        );
        const projected = projectHistory(previousState, history, {
          interrupts: projectedInterrupts,
          ...(typedTools
            ? { registeredTools: new Set(definitions.keys()) }
            : {}),
        });
        const projectedValues = projectHistoryValues(previousValues, history);
        const projectedHistory = projectCheckpointHistory(historyPage, history);
        const projectedCheckpoints =
          historyState && !capturedBranch ? checkpointViews(history) : undefined;
        // Even a plain projection can invoke getters supplied by a transport.
        // Such a getter can submit/stop/dispose; never commit its stale result.
        if (!ownsLoad(read)) return;
        // Use the owned latest transcript only. An empty read or an older
        // checkpoint cannot clear authority; wire text is not a typed result.
        for (const message of projected.messages) {
          if (
            message.role === 'tool' &&
            message.toolCallId &&
            unsettledTools.delete(message.toolCallId)
          )
            resolvedTools.add(message.toolCallId);
        }
        state = projected;
        values = projectedValues;
        interrupts = projectedInterrupts;
        if (!capturedBranch) historyPage = projectedHistory;
        if (projectedCheckpoints) checkpointPage = projectedCheckpoints;
        subgraphs = initialSubgraphs();
        authoredTools.clear();
        loading = undefined;
        read.resolve();
        if (history.length > 0) lifecycle.mark('threadPersistedAt');
        if (developmentRuntime && projected.messages.length > 0)
          safely(() => developmentRuntime.milestone('thread.persisted'));
        writeLabel = { label: 'history' };
        publish(
          unsettledTools.size ? 'error' : 'idle',
          unsettledTools.size ? unsettledToolError() : undefined
        );
        closeLoad(read, false);
      });
    } catch {
      await publication.command(() => {
        if (!ownsLoad(read)) return;
        loading = undefined;
        read.reject(createSafeRequestError());
        closeLoad(read);
      });
    }
  }

  function load(options?: { readonly signal?: AbortSignal }): Promise<void> {
    let read: HistoryRead | undefined;
    const beginning = publication.command(() => {
      if (disposed || options?.signal?.aborted) return;
      if (!branch && !getHistory)
        throw new Error(
          'Loading before checkpoint activation requires transport.getHistory().'
        );
      if (branch || preparing) admitBranchCommand();
      if (
        owner ||
        (recoveryAttempt && recoveryAttempt.input.kind !== 'resume') ||
        retained ||
        pendingToolSettlements ||
        persistence.pending ||
        (buffer.snapshot().messages.length &&
          !unsettledTools.size &&
          !hasInvocationConflict(state.invocations))
      )
        throw new Error(
          'History cannot replace an active request, recovery, or unsettled tool results.'
        );
      // Before the first submit creates the thread there is no history.
      if (threadId === undefined) return;
      // A check owned by an earlier resume yields to a fresh read: the pause it
      // answered is restored from history, so the decision can be sent again.
      let withdrawn: AbortController | undefined;
      if (recoveryAttempt?.input.kind === 'resume') {
        recoveryAttempt = undefined;
        withdrawn = invalidateCheck();
      }
      cancelPageRefresh();
      const previous = detachLoad();
      let resolve!: HistoryRead['resolve'];
      let reject!: HistoryRead['reject'];
      const result = new Promise<void>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      const created: HistoryRead = {
        controller: new AbortController(),
        result,
        resolve,
        reject,
      };
      read = created;
      loading = created;
      const external = options?.signal;
      if (external) {
        const abort = () => {
          void publication.command(() => {
            if (ownsLoad(created)) closeLoad(detachLoad());
          });
        };
        created.unlink = () => external.removeEventListener('abort', abort);
        external.addEventListener('abort', abort, { once: true });
        if (external.aborted) abort();
      }
      closeLoad(previous);
      withdrawn?.abort();
    });
    return beginning.then(() => {
      if (!read) return;
      void readHistory(read);
      return read.result;
    });
  }

  /** Sends the command whose exact run the backend reported failed again, from
   * the transcript and values it started with. The submission keeps its user
   * message id, so the snapshot gains no second copy and an `add_messages`
   * thread replaces rather than appends it; a resume sends the same response.
   * Resolves with the re-run's outcome, or `aborted` when nothing ran. It
   * never replays an uncertain outcome. */
  function retry(): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      if (disposed || owner || preparing || loading) return;
      const failed = replayable;
      if (!failed || failed.state !== state) {
        if (publication.getSnapshot().status === 'error')
          throw new Error(
            'This failure cannot be retried: the backend has not reported that the run failed.'
          );
        return;
      }
      admitSubmission();
      const previous = failed.attempt;
      state = previous.baseline.state;
      values = previous.baseline.values;
      attempt = beginAttempt(
        previous.input,
        undefined,
        previous.runOptions,
        'retry'
      );
    });
    // No attempt means nothing ran: `aborted`, as for an ignored submit.
    return dispatch(beginning, () => attempt);
  }

  async function checkStatus() {
    let checking:
      | { revision: number; attempt: Attempt; controller: AbortController }
      | undefined;
    await publication.command(() => {
      if (disposed) throw new Error('Agent has been disposed');
      if (branch || preparing) {
        if (
          owner ||
          loading ||
          checkController ||
          preparing ||
          pendingToolSettlements ||
          persistence.pending
        )
          throw new Error(
            'Checkpoint status cannot be checked during an active operation.'
          );
        if (!branch) throw new Error('Checkpoint preparation is active.');
        readyCheckpoint(branch.state);
        return;
      }
      if (owner)
        throw new Error('Stop the active request before checking status');
      if (!recoveryAttempt) return;
      const previous = invalidateCheck();
      checkController = new AbortController();
      checking = {
        revision,
        attempt: recoveryAttempt,
        controller: checkController,
      };
      previous?.abort();
    });
    if (!checking || disposed || checking.revision !== revision) return;
    const captured = checking;
    try {
      // The exact run answers first. In flight means history is not
      // conclusive yet; a failed run is reported as such and needs no read.
      const run = captured.attempt.physical;
      let status: RunStatus | undefined;
      if (run?.evidence.runId && !run.evidence.unsafe && getRunStatus) {
        try {
          status = await getRunStatus(
            thread(),
            run.evidence.runId,
            captured.controller.signal
          );
        } catch {
          /* Unknown exact status; history may still be conclusive. */
        }
        if (status === 'pending' || status === 'running') return;
        if (status === 'error' || status === 'timeout') {
          const failed = status;
          await publication.command(() => {
            if (disposed || captured.revision !== revision) return;
            run.confirmed = true;
            recoveryAttempt = undefined;
            checkController = undefined;
            retained = undefined;
            const error = runFailureError(failed, captured.attempt);
            replayable =
              error.recovery === 'retry'
                ? { attempt: captured.attempt, state }
                : undefined;
            publish('error', error);
          });
          return;
        }
      }
      const history = await transport.getHistory?.(
        thread(),
        captured.controller.signal
      );
      await publication.command(() => {
        if (disposed || captured.revision !== revision || !history) return;
        const recovered = reconcile(captured.attempt, history);
        if (!recovered) return;
        // Interrupted deliveries are already complete: recovered canonical
        // history carries the conclusive success stamp in this aggregate.
        const recoveredState = {
          ...recovered.state,
          messages: recovered.state.messages.map((message) =>
            message.delivery.generation === captured.attempt.generation
              ? ownMessage({
                  ...message,
                  delivery: completeDelivery(
                    captured.attempt.generation,
                    recovered.outcome
                  ),
                })
              : message
          ),
        };
        const recoveredSubgraphs = settleSubgraphs(
          captured.attempt.subgraphs,
          recovered.outcome,
          true,
          true
        );
        // Projection and delivery ownership must finish before clearing this
        // check: a raw getter can synchronously start a replacement operation.
        if (disposed || captured.revision !== revision) return;
        recoveryAttempt = undefined;
        checkController = undefined;
        retained = undefined;
        state = recoveredState;
        values = recovered.values;
        interrupts = recovered.interrupts;
        subgraphs = recoveredSubgraphs;
        captured.attempt.subgraphs = subgraphs;
        captured.attempt.projection = recovered.projection;
        publish('idle');
      });
    } finally {
      if (checkController === captured.controller) checkController = undefined;
    }
  }

  /**
   * Answers the prompt behind one assistant message again: forks from the
   * newest saved checkpoint that does not yet hold that prompt, and submits the
   * prompt's text there. The thread keeps the earlier answer on its old branch.
   * Only the history page the transport returns is searched, so a prompt older
   * than that page cannot be regenerated. Only the prompt's text is resent.
   */
  async function regenerate(
    messageId: string,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    const select = () => {
      const { status, messages } = publication.getSnapshot();
      if (disposed) throw new Error('The session is disposed.');
      if (status === 'running')
        throw new Error('Cannot regenerate while a response is running.');
      const at = messages.findIndex((message) => message.id === messageId);
      if (at < 0 || messages[at].role !== 'assistant')
        throw new Error('Regenerate needs the id of an assistant message.');
      for (let index = at - 1; index >= 0; index--)
        if (messages[index].role === 'user') return messages[index];
      throw new Error('No prompt precedes that message.');
    };
    const prompt = select();
    if (threadId === undefined)
      throw new Error('Regenerate requires the session thread to exist.');
    const history = await getHistory!(
      thread(),
      options?.signal ?? new AbortController().signal
    );
    // The transcript may have moved on while history was read.
    if (select().id !== prompt.id)
      throw new Error(
        'The conversation changed before it could be regenerated.'
      );
    const holds = (saved: ThreadState) => {
      const values = saved.values as { messages?: unknown } | null | undefined;
      return (
        Array.isArray(values?.messages) &&
        values.messages.some(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            (message as { id?: unknown }).id === prompt.id
        )
      );
    };
    const source = history.find(
      (saved) => !!saved.checkpoint?.checkpoint_id && !holds(saved)
    );
    if (!source)
      throw new Error(
        'The checkpoint before that prompt is not in the loaded history.'
      );
    return fork(
      source.checkpoint as CheckpointReference,
      prompt.content,
      options
    );
  }
  const throttles = new Set<{ cancel(): void }>();
  if (developmentRuntime) safely(() => developmentRuntime.touch());
  report('tplane:runtime_instance_created');
  const canRegenerate =
    !!getHistory &&
    !!getState &&
    !!getRunStatus &&
    !!joinStream &&
    (!!suppliedTransport || ownedRetries === 0);

  return {
    getSnapshot: publication.getSnapshot,
    get threadId() {
      return threadId;
    },
    subscribe: (notify) => {
      if (disposed) return () => undefined;
      if (!throttleMs) return publication.subscribe(notify);
      const throttled = throttleListener(
        notify,
        throttleMs,
        () => publication.getSnapshot().status !== 'running'
      );
      throttles.add(throttled);
      const release = publication.subscribe(throttled);
      return () => {
        throttles.delete(throttled);
        throttled.cancel();
        release();
      };
    },
    onCustomEvent: (listener) =>
      disposed ? () => undefined : publication.onCustomEvent(listener),
    lifecycle: {
      getSnapshot: lifecycle.source.getSnapshot,
      subscribe: (notify) =>
        disposed ? () => undefined : lifecycle.source.subscribe(notify),
    },
    submit,
    cancelQueued,
    clearQueue,
    fork,
    setBranch: (selected) =>
      publication.command(() => {
        if (typeof selected !== 'string')
          throw new TypeError('A branch is a string.');
        if (disposed || selected === branchName) return;
        branchName = selected;
        writeLabel = { label: 'branch' };
        republish();
      }),
    ...(canRegenerate ? { regenerate } : {}),
    resume,
    reconnect,
    joinStream: joinRun,
    stop: () =>
      publication.command(() => {
        if (disposed) return;
        stopExecution();
      }),
    ...(canCheck || getState ? { checkStatus, load } : {}),
    // Only the exact run's status can settle a failure, so without it nothing
    // could ever be retried and the command is left out.
    ...(getRunStatus ? { retry } : {}),
    dispose: () =>
      publication.command(() => {
        if (disposed) return;
        disposed = true;
        cancelPageRefresh();
        const pendingThread = creation;
        creation = undefined;
        const preparation = detachPreparation();
        retained = undefined;
        const reading = detachLoad();
        const checking = invalidateCheck();
        const attempt = detach('aborted');
        recoveryAttempt = undefined;
        const dropped = queue.splice(0);
        publish('idle');
        for (const entry of dropped) entry.resolve('aborted');
        for (const throttled of throttles) throttled.cancel();
        throttles.clear();
        if (developmentRuntime) safely(() => developmentRuntime.dispose());
        publication.clearListeners();
        lifecycle.clearListeners();
        checking?.abort();
        if (attempt) close(attempt, true);
        closeLoad(reading);
        closePreparation(preparation);
        pendingThread?.controller.abort();
      }),
  };
}
