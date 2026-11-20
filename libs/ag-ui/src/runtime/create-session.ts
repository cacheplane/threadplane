import {
  PROTOCOL_VERSION,
  type AGUIEvent,
  type HttpAgentConfig,
  type Message,
  type RunAgentInput,
  type ResumeEntry,
} from '@ag-ui/client';
import { EventType, type ToolCallResultEvent, type Tool } from '@ag-ui/client';
import {
  projectErrorDiagnostic,
  type AgentClientTools,
  type AgentErrorDiagnostic,
  type AgentSessionCustomEvent,
  type ClientToolResult,
  type ClientToolSpec,
  type CompleteOutcome,
  type ContentBlock,
  type InferState,
  type PlainValue,
  type StateDeclaration,
  type ToolContract,
} from '@threadplane/core';
import type {
  CheckedTools,
  FunctionToolDefinition,
  ToolContracts,
} from '@threadplane/core/tools';
import {
  captureClientTools,
  requestClientTools,
  type ClientToolBlocker,
  type ClientToolSessionSnapshot,
} from './client-tools.js';
import { createClientToolLedger } from './client-tool-ledger.js';
import {
  ownTranscript,
  requestMessages,
  type Transcript,
} from './transcript.js';
import { requestState } from './state.js';
import {
  applyObservation,
  failedWithRunError,
  initialObservation,
  type Observation,
} from './session-observation.js';
import { nextInvocation, type Subagents } from './subagents.js';
import {
  createRun,
  httpFailure,
  type RunHandle,
  type RunResult,
} from './create-run.js';
import type { RequestSource, SessionAgent } from './create-http-request.js';
import { createPublication } from './session-publication.js';
import {
  createPresenter,
  noteFailure,
  UNSAFE_RETRY,
  type SessionSnapshot,
} from './agent-session.js';
import { applyToolMessage } from './tool-messages.js';
import {
  createLifecycleRecorder,
  type LifecycleRecorder,
  type SessionLifecycleSource,
} from './lifecycle.js';
import { createReasoningClock } from './reasoning-clock.js';
import {
  answersNotice,
  type InterruptMode,
  type InterruptTransport,
} from './interrupt-mode.js';
import {
  assertResumeEligible,
  captureResponses,
  acknowledgeDecision,
  claimDecision,
  observeDecision,
  pauseFor,
  type Decision,
  pausedByNotice,
  settleDecision,
  type InterruptResponse,
  type NativeDecision,
  type NativeResponse,
} from './decision.js';

import {
  createInstruments,
  type InstrumentOptions,
  type SessionRequestType,
} from './session-instruments.js';
import {
  createDurability,
  gated,
  isDurable,
  type Durability,
  type DurabilityOptions,
} from './durability.js';

/** Why `resume` rejects while a run is active or the session cannot answer. */
const NOT_SETTLED = 'Resume needs a settled session with a pending interrupt.';
import { copyData } from './copy-data.js';
import {
  captureExtras,
  captureSubmit,
  mergeSubmitState,
  type CapturedExtras,
  type SubmitInput,
  type SubmitState,
  type UserContent,
} from './submit-input.js';

/** The options every session takes, whatever it sends its requests with. */
export interface SessionCommonOptions
  extends DurabilityOptions,
    InstrumentOptions {
  /**
   * The thread this session owns. Absent, the handed agent's `threadId` is
   * used, or else a new one is generated; read it from `session.threadId`.
   * `persistence` needs one the application chose, and `replay` is skipped
   * without one: a new conversation has nothing to replay.
   */
  readonly threadId?: string;
  /** Names the agent, when an endpoint serves more than one. Published as `session.agentId`. */
  readonly agentId?: string;
  readonly messages?: readonly Message[] | Transcript;
  readonly state?: unknown;
  /**
   * The type of the state document: `type<T>()` to declare it, or a Standard
   * Schema to also check each state. The snapshot's `state` has this type.
   * Requests still send the literal document, whatever is declared here.
   */
  readonly stateType?: StateDeclaration;
  /** Child evidence saved with this thread, published as `earlierSubagents`. Their attributed messages belong in `messages`. */
  readonly subagents?: Subagents;
  readonly interruptMode?: InterruptMode;
  /**
   * How a pause is answered. Absent, a session answers the protocol's own
   * interrupt outcome only, as with `'protocol'`. `'auto'`,
   * `'legacy-command'` and `'mastra-command'` also answer a
   * `CUSTOM on_interrupt` notice, through `forwardedProps.command`.
   */
  readonly interruptTransport?: InterruptTransport;
}
/** A session that posts each run to an HTTP endpoint. */
export interface HttpSessionSource
  extends Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'> {
  readonly agent?: undefined;
}
/**
 * A session over an AG-UI client agent the application built, HTTP or not, as
 * the Angular adapter's `toAgent(source)` allowed. The session calls the
 * agent's `run` with each request's full input; it does not use `runAgent`,
 * and neither reads nor changes the agent's own messages and state.
 */
export interface AgentSessionSource {
  readonly agent: SessionAgent;
  readonly url?: undefined;
  readonly headers?: undefined;
  readonly fetch?: undefined;
}
export type SessionOptions = SessionCommonOptions &
  (HttpSessionSource | AgentSessionSource);
/** Options as the factory captured them: one read of each, thread resolved. */
interface CapturedOptions
  extends Omit<SessionCommonOptions, 'threadId'>,
    RequestSource {
  readonly threadId: string;
  /** The session named the thread itself; its first request creates it. */
  readonly ownThread: boolean;
}
/** The session's options with its state declaration as the type parameter. */
type DeclaredOptions<D> = Omit<SessionCommonOptions, 'stateType'> & {
  readonly stateType?: D;
} & (HttpSessionSource | AgentSessionSource);
/**
 * A new root invocation observes no children yet; settled ones become history.
 * `transcript` is the history the new invocation begins with, when it is not
 * the previous one.
 */
function nextInvocationSubagents(
  previous: Observation,
  transcript: Transcript = previous.transcript
) {
  return nextInvocation(
    previous,
    previous.transcript.length,
    transcript.length
  );
}
/** What `resume` takes beside the responses. */
export interface ResumeOptions<TState = unknown> {
  readonly signal?: AbortSignal;
  /**
   * A user message sent in the same request as the answers, as the core
   * contract's resume options and the Angular adapter's
   * `submit({ resume, message })`. It is appended to the conversation.
   */
  readonly message?: string;
  /** That message as structured content; see `submit`. */
  readonly blocks?: readonly ContentBlock[];
  /** A patch merged into the state document before the answering request. */
  readonly state?: SubmitState<TState>;
  /**
   * The `id` of the pause a control was rendered for, from
   * `decisionState(snapshot)` or `interruptSession(snapshot)`. When given,
   * `resume` rejects without sending unless that pause is the one pending, so
   * a control left over from an earlier pause cannot answer a later one whose
   * interrupts reuse the same identifiers.
   */
  readonly pause?: string;
}
/** Rejects an answer aimed at a pause that is no longer the pending one. */
function assertCurrentPause(decision: NativeDecision, pause: unknown): void {
  if (pause !== undefined && pause !== decision.id)
    throw new TypeError(
      'Stale pause: read the pending decision again before answering.'
    );
}
export interface Session<TState = unknown> {
  /** The thread this session owns. The factory always supplies it. */
  readonly threadId?: string;
  /** The agent's name, when the session was given one. */
  readonly agentId?: string;
  /** The state declaration this session was created with, when it has one. */
  readonly stateType?: StateDeclaration<TState>;
  getSnapshot(): SessionSnapshot<TState>;
  subscribe(notify: () => void): () => void;
  submit(
    input: SubmitInput<TState>,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  /**
   * Answers the pending interrupts, as the core contract's `resume`: one
   * response for each interrupt in the snapshot's `interrupts`, naming it by
   * `id`. A response may also carry the protocol's `metadata`.
   *
   * Rejects without sending when no interrupt is waiting, a run is active, an
   * interrupt has expired, a response names an interrupt that is not pending
   * or names one twice, or an interrupt is left unanswered. Resolves `aborted`
   * without sending after disposal or when the signal is already aborted.
   */
  resume(
    responses: readonly InterruptResponse[],
    options?: ResumeOptions<TState>
  ): Promise<CompleteOutcome>;
  /**
   * Runs the agent on the conversation as it stands, appending no user
   * message, after merging `input.state` when given: the core contract's
   * `runWithoutMessage`. Refused, like `submit`, while a decision is waiting.
   * The factory always supplies it.
   */
  runWithoutMessage?(
    input?: { readonly state?: SubmitState<TState> },
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  /**
   * The core client-tool capability, on a session created without a handler
   * map: `setCatalog` declares the tools each later request sends, the calls
   * that wait are in the snapshot's `pendingClientTools` once a catalog was
   * set, `settle` records a result as a tool record without running, `flush`
   * saves the thread when the session has `persistence`, and `resolve`
   * records a result and continues the run. A session created with a handler
   * map runs its tools itself and leaves this undefined.
   */
  readonly clientTools?: AgentClientTools;
  /**
   * When the session first saw each milestone, in the shape the LangGraph
   * session's `lifecycle` has. The factory always supplies it.
   */
  readonly lifecycle?: SessionLifecycleSource;
  /**
   * Present with `replay` or `persistence`. Reads the thread again, as the
   * session did when it was created: replay first, then storage. The
   * snapshot's `inputBlocked.reason` is `hydrating` meanwhile, which is what
   * a thread-loading indicator reads, and commands are refused until it
   * settles. Rejects after disposal, while a run or a status check is going,
   * and when storage could not be read; a failed replay does not reject it.
   * The first load starts by itself at creation: `ready` resolves with it.
   */
  load?(options?: { readonly signal?: AbortSignal }): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  /**
   * Whether a host may run development-install collection for this session:
   * true unless the session was created with a `telemetry` option, `false`
   * included. The session itself collects nothing.
   */
  isDevelopmentRuntimeEnabled(): boolean;
  /**
   * Sends the last submission again after its run failed with a backend
   * `RUN_ERROR`. The request carries the history and state that submission
   * sent, so no second user message is added and the failed run's output is
   * dropped. Resolves `aborted` without sending while a run is active, when
   * nothing failed or when the last run was not a failed submission. Rejects
   * without sending when the error's `recovery` is not `'retry'`: the failure
   * leaves the backend outcome open. With a client-tool catalog it sends the
   * failed request again, whichever request of the command that was, and runs
   * no handler a second time.
   *
   * It also sends a failed `resume` again, unchanged, when that request
   * provably reached no run: it was never made, or the backend refused it
   * with its own `RUN_ERROR` before any `RUN_STARTED`. The pause is then
   * pending again and the error's `recovery` is `'retry'`. An answer that
   * may have arrived is never sent twice, and a transport's own claim that
   * a request did not leave is not taken as proof.
   */
  retry?(): Promise<CompleteOutcome>;
  /**
   * Answers the prompt behind one assistant message again, as the Angular
   * adapter's `regenerate` does. Takes the `id` of a root assistant record (or
   * of the reasoning record a reasoning-only answer is shown under), drops
   * every record after the user message that precedes it, and sends a run
   * with that history and the current state. The prompt is not added again.
   * Rejects without sending while a run is active, while a decision is
   * waiting, after disposal, for an id that is not an assistant record, and
   * when no user message precedes it. `retry` can send a failed regenerate
   * again. With a client-tool catalog it also forgets the client-tool calls
   * of the dropped records, and rejects while a blocker is installed.
   */
  regenerate?(
    messageId: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  /**
   * Listens for `CUSTOM` events other than `on_interrupt` while runs stream.
   * The factory always supplies it; it is optional so hand-written sessions
   * need not. Returns an idempotent release. Nothing is replayed to a later
   * listener, a throwing listener cannot fail the run, and nothing is
   * delivered after disposal.
   */
  onCustomEvent?(
    listener: (event: AgentSessionCustomEvent) => void
  ): () => void;
  /**
   * Listens for every AG-UI protocol event the session applied to its
   * snapshot, in arrival order, for a host that folds the full stream into a
   * view of its own. The factory always supplies it. Each event is delivered
   * after the snapshot shows it. Events the session ignores are not
   * delivered: those of a superseded or stopped run, and those after a run's
   * terminal event. A thread restored from `replay` delivers every replayed
   * event, in order, once the snapshot shows the whole replay; a thread
   * restored from `persistence` delivers none. With a
   * `reportOperationFailure` a `RUN_ERROR` carries only the fixed message.
   * Nothing is retained for a later listener, a throwing listener cannot fail
   * the run, and nothing is delivered after disposal. Returns an idempotent
   * release.
   */
  onRawEvent?(listener: (event: AGUIEvent) => void): () => void;
  /**
   * Resolves once the thread is restored from `replay` or `persistence`, and
   * at once for a session with neither. Commands issued before then wait for
   * it. Rejects when the stored thread could not be read; a failed replay
   * does not reject it. The factory always supplies it.
   */
  readonly ready?: Promise<void>;
  /**
   * Present with `persistence`. Asks the configured reconciler what became of
   * the saved thread and adopts whatever it reports, including an answer that
   * only proves a resume started. Rejects after disposal, while a run or
   * another check is going, without a reconciler, and when the backend does
   * not know. Prefer `checkStatus` for the control a person is offered.
   */
  reconcileInterrupt?(): Promise<void>;
  /**
   * Present with a `persistence.reconcile`. The control to offer when
   * `error.recovery` is `'check'`: asks the reconciler what became of an
   * answer that was sent and not proven taken, and settles the session only
   * on a conclusive report (the answer's run ended, or the pause still
   * waits). Anything less, and any failure to ask, leaves the error in place
   * so the check can be offered again. Never sends the answer again. Rejects
   * after disposal and while a run is going.
   */
  checkStatus?(): Promise<void>;
}
const READY = Promise.resolve();
/**
 * Completes a session with its durability: `ready`, the recovery commands, and
 * commands that wait for the thread to be restored.
 */
function durableSession<S extends Session>(
  session: S,
  durability: Durability | undefined,
  persisted: boolean
): S {
  if (!durability) return { ...session, ready: READY };
  const reject = (reason: string) =>
    Promise.reject<CompleteOutcome>(new Error(reason));
  return {
    ...session,
    ready: durability.ready,
    submit: gated(durability, session.submit, () => Promise.resolve('error')),
    resume: gated(durability, session.resume, reject),
    ...(session.retry && { retry: gated(durability, session.retry, reject) }),
    ...(session.regenerate && {
      regenerate: gated(durability, session.regenerate, reject),
    }),
    ...(session.runWithoutMessage && {
      runWithoutMessage: gated(durability, session.runWithoutMessage, () =>
        Promise.resolve('error')
      ),
    }),
    load: durability.load,
    ...(persisted && { reconcileInterrupt: durability.reconcileInterrupt }),
    ...(durability.checkStatus && { checkStatus: durability.checkStatus }),
  };
}

/** A user record for `content`, with an identifier no record in `history` has. */
function userRecord(history: Transcript, content: UserContent) {
  const id = crypto.randomUUID();
  if (history.some((message) => message.id === id))
    throw new TypeError('Generated message ID collides with history');
  return ownTranscript([
    { id, role: 'user', content } as Parameters<
      typeof ownTranscript
    >[0][number],
  ])[0];
}

/** The history and state a request sends once a command's extras are applied. */
function withExtras(previous: Observation, extras: CapturedExtras) {
  const state = mergeSubmitState(previous.state, extras.state);
  const transcript =
    extras.content === undefined
      ? previous.transcript
      : Object.freeze([
          ...previous.transcript,
          userRecord(previous.transcript, extras.content),
        ]);
  return { state, transcript };
}

/**
 * What a failed run was classified from: the backend's own `RUN_ERROR`, or
 * the value the transport failed with.
 */
function failureDiagnostic(
  terminal: NonNullable<Observation['run']>['terminal'],
  cause: unknown
): AgentErrorDiagnostic | undefined {
  if (terminal?.type === 'RUN_ERROR')
    return Object.freeze({
      name: 'RunError',
      message: String(terminal.message),
      ...(terminal.code !== undefined && { code: terminal.code }),
    });
  return cause === undefined ? undefined : projectErrorDiagnostic(cause);
}

const NO_EXTRAS: CapturedExtras = Object.freeze({});

/**
 * False when an answering request provably reached no run: it was never
 * made, or the backend refused it with its own `RUN_ERROR` before any
 * `RUN_STARTED`. A transport's claim about its own failure is not proof.
 */
function answerTaken(
  result: RunResult,
  started: boolean,
  terminal: NonNullable<Observation['run']>['terminal']
): boolean {
  return (
    result.fetchInvoked &&
    !(result.outcome === 'error' && !started && terminal?.type === 'RUN_ERROR')
  );
}

/** The failed answer `retry` may send again, held by the owner that sent it. */
interface FailedAnswer {
  readonly runId: string;
  readonly pause: string;
  readonly responses: readonly NativeResponse[];
  readonly transcript: Transcript;
  readonly state: PlainValue;
}

/**
 * True when `answer` is a resume whose request provably never left: its run
 * failed, and the pause it answered is pending again with no answer claimed.
 */
function answerUnsent(
  observation: Observation,
  answer: FailedAnswer | undefined
): answer is FailedAnswer {
  const decision = observation.decision;
  return (
    answer !== undefined &&
    observation.status === 'error' &&
    observation.hold === undefined &&
    observation.run?.id === answer.runId &&
    observation.run.outcome === 'error' &&
    decision?.kind === 'native' &&
    !decision.attempt &&
    decision.id === answer.pause
  );
}

/** Tells the lifecycle recorder about each publication. */
function followLifecycle(
  publication: {
    getSnapshot(): SessionSnapshot;
    subscribe(notify: () => void): () => void;
  },
  lifecycle: LifecycleRecorder
): void {
  publication.subscribe(() => {
    lifecycle.observe(publication.getSnapshot());
    lifecycle.flush();
  });
}
/** The thread a session starts with, held while a durable one is restored. */
function startingObservation(
  options: Pick<
    SessionCommonOptions,
    'messages' | 'state' | 'subagents' | 'persistence' | 'replay'
  >
): Observation {
  const initial = initialObservation(
    options.messages,
    options.state,
    options.subagents
  );
  return isDurable(options)
    ? Object.freeze({ ...initial, hold: 'hydrating' as const })
    : initial;
}
export type ClientToolSession<
  C extends Record<string, ToolContract>,
  TState = unknown
> = Omit<Session<TState>, 'getSnapshot' | 'clientTools'> & {
  getSnapshot(): ClientToolSessionSnapshot<C, TState>;
};
/** A `CUSTOM` event as an application event, read the way the Angular adapter
 * reads it: a string value that parses as JSON becomes that data. The legacy
 * `on_interrupt` notice is protocol, not application data. Values that are not
 * plain data are dropped. */
function captureCustomEvent(
  event: AGUIEvent
): AgentSessionCustomEvent | undefined {
  if (event.type !== 'CUSTOM' || event.name === 'on_interrupt')
    return undefined;
  let value: unknown = event.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      /* Keep text that is not JSON. */
    }
  }
  try {
    return Object.freeze({
      name: event.name,
      data: copyData(value, true) as PlainValue,
    });
  } catch {
    return undefined;
  }
}
/**
 * Where the history ends for a regenerate of `messageId`: the index of the
 * root user message before that root assistant (or reasoning) record. Throws
 * the reason when there is no such record or no prompt before it.
 */
function regeneratePrompt(transcript: Transcript, messageId: string): number {
  const root = (index: number) =>
    typeof transcript[index].subagentRunId !== 'string';
  const at = transcript.findIndex(
    (record, index) =>
      record.id === messageId &&
      (record.role === 'assistant' || record.role === 'reasoning') &&
      root(index)
  );
  if (at < 0)
    throw new Error('Regenerate needs the id of an assistant message.');
  for (let index = at - 1; index >= 0; index--)
    if (transcript[index].role === 'user' && root(index)) return index;
  throw new Error('No prompt precedes that message.');
}
/**
 * What a request carries for the answer it sends, when `runId` is the run
 * answering `decision`: the protocol's `resume` entries, or the command of a
 * command profile in `forwardedProps`. Each request owns its copies.
 */
function answerFields(
  decision: Decision | undefined,
  runId: string
): Pick<RunAgentInput, 'forwardedProps' | 'resume'> {
  const attempt =
    decision?.kind === 'native' && decision.attempt?.runId === runId
      ? decision.attempt
      : undefined;
  if (attempt?.forwardedProps)
    return { forwardedProps: copyData(attempt.forwardedProps, false) };
  return {
    forwardedProps: {},
    ...(attempt && {
      resume: copyData(attempt.responses, false) as ResumeEntry[],
    }),
  };
}
interface Attempt {
  readonly id: string;
  readonly kind: SessionRequestType;
  /** Reports the request's end to telemetry, once it was sent. */
  ended?: (outcome: CompleteOutcome) => void;
  readonly controller: AbortController;
  readonly done: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  cleanup: () => void;
  handle?: RunHandle;
  starting: boolean;
  /** The backend reported `RUN_STARTED` for this request. */
  started: boolean;
  finished: boolean;
}

/**
 * Creates the session that owns one AG-UI thread. It is a core `AgentSession`:
 * its snapshot is the core snapshot with the protocol evidence behind it.
 */
export function createSession<
  T extends Record<string, FunctionToolDefinition>,
  D extends StateDeclaration | undefined = undefined
>(
  options: DeclaredOptions<D>,
  tools: T & CheckedTools<T>
): ClientToolSession<ToolContracts<T>, InferState<D>>;
export function createSession<
  D extends StateDeclaration | undefined = undefined
>(options: DeclaredOptions<D>): Session<InferState<D>>;
export function createSession(
  options: SessionOptions,
  tools?: Record<string, FunctionToolDefinition>
): Session {
  const {
    url,
    headers,
    fetch,
    agent,
    messages,
    state,
    stateType,
    subagents,
    interruptMode = 'native',
    interruptTransport,
    persistence,
  } = options;
  const given = options.threadId;
  if (given !== undefined && !given)
    throw new TypeError('A nonempty threadId is required');
  if (agent !== undefined && url !== undefined)
    throw new TypeError('A session takes a url or an agent, not both');
  // The thread the application chose, on the option or on its own agent.
  const stable = given ?? (agent?.threadId || undefined);
  if (persistence && stable === undefined)
    throw new TypeError('Persistence requires a stable threadId');
  const threadId = stable ?? crypto.randomUUID();
  const agentId = options.agentId ?? agent?.agentId;
  // A new conversation has nothing to replay.
  const replay = stable === undefined ? undefined : options.replay;
  const catalog = tools === undefined ? undefined : captureClientTools(tools);
  if (catalog !== undefined)
    return createToolsOwner(
      {
        threadId,
        ownThread: stable === undefined,
        url,
        headers,
        fetch,
        agent,
        agentId,
        messages,
        state,
        stateType,
        subagents,
        interruptMode,
        interruptTransport,
        persistence,
        replay,
        a2uiClientCapabilities: options.a2uiClientCapabilities,
        telemetry: options.telemetry,
        reportOperationFailure: options.reportOperationFailure,
        devtools: options.devtools,
      },
      catalog
    );
  const instruments = createInstruments(options);
  const factory = createRun({
    url,
    headers,
    fetch: instruments.fetch(fetch),
    agent,
    agentId,
    interruptMode,
  });
  // Legacy observation answers nothing unless a profile answers its notice.
  const answerable =
    interruptMode === 'native' || answersNotice(interruptTransport);
  const reasoningClock = createReasoningClock();
  const initial = startingObservation({
    messages,
    state,
    subagents,
    persistence,
    replay,
  });
  /** What the latest admitted submission sent; a resume or newer submission replaces it. */
  let saved:
    | {
        readonly runId: string;
        readonly transcript: Transcript;
        readonly state: PlainValue;
      }
    | undefined;
  /** The latest answer sent, kept until another command replaces it. */
  let answered: FailedAnswer | undefined;
  /** The tools declared through `clientTools.setCatalog`, as requests send them. */
  let declared: readonly Tool[] = [];
  const lifecycle = createLifecycleRecorder();
  const publication = createPublication(
    initial,
    createPresenter(
      stateType,
      (observation) =>
        failedWithRunError(observation) || answerUnsent(observation, answered),
      persistence?.reconcile !== undefined,
      instruments.protect
    )
  );
  // Reading a snapshot asks about `answered`, so these follow its definition.
  instruments.follow(publication);
  followLifecycle(publication, lifecycle);
  let active: Attempt | undefined;
  let disposed = false;
  let revision = 0;
  /** A restored thread keeps the catalog the application declared. */
  const withCatalog = (observation: Observation): Observation => {
    const catalog = publication.getObservation().clientToolCatalog;
    return catalog
      ? Object.freeze({ ...observation, clientToolCatalog: catalog })
      : observation;
  };
  const durability = isDurable({ persistence, replay })
    ? createDurability(
        {
          threadId,
          persistence,
          replay,
          interruptMode,
          interruptTransport,
          redact: instruments.redact,
        },
        {
          publication,
          active: () => active !== undefined,
          disposed: () => disposed,
          adopt: (observation) => {
            saved = undefined;
            answered = undefined;
            instruments.cause('history');
            publication.publish(withCatalog(observation));
          },
          replayed: (events) => events.forEach(instruments.raw),
          restored: () => {
            lifecycle.mark('threadPersistedAt');
            lifecycle.flush();
          },
        }
      )
    : undefined;
  const current = (attempt: Attempt) =>
    active === attempt &&
    !disposed &&
    !attempt.controller.signal.aborted &&
    !attempt.finished;
  /** `taken`: the request may have reached a run; see `answerTaken`. */
  const finish = (
    attempt: Attempt,
    outcome: CompleteOutcome,
    taken: boolean,
    failure?: { readonly status: number },
    cause?: unknown
  ) => {
    if (attempt.finished) return;
    attempt.finished = true;
    attempt.cleanup();
    if (active === attempt) {
      active = undefined;
      const previous = publication.getObservation();
      const decision = settleDecision(
        previous.decision,
        { id: attempt.id, outcome, terminal: previous.run?.terminal },
        taken
      );
      // The run announced a pause and then finished in the ordinary way.
      if (outcome === 'success' && pausedByNotice(decision, attempt.id))
        outcome = 'paused';
      attempt.ended?.(outcome);
      instruments.cause('run:end');
      const run = Object.freeze({
        ...previous.run,
        id: attempt.id,
        outcome,
        ...(failure &&
          outcome === 'error' &&
          !instruments.protect && { failure }),
      });
      const diagnostic =
        outcome === 'error' && !instruments.protect
          ? failureDiagnostic(previous.run?.terminal, cause)
          : undefined;
      if (diagnostic) noteFailure(run, diagnostic);
      publication.publish(
        Object.freeze({
          ...previous,
          decision,
          status:
            outcome === 'error' || outcome === 'interrupted' ? 'error' : 'idle',
          run,
        })
      );
      durability?.settled();
      if (disposed) publication.clear();
    }
    attempt.resolve(outcome);
  };
  const cancel = (attempt: Attempt) => {
    attempt.controller.abort();
    attempt.handle?.abort();
    // A start in progress already owns first-result authority even though its
    // handle is not assigned. Its done promise must select the local outcome.
    if (!attempt.starting && !attempt.handle) finish(attempt, 'aborted', false);
  };
  const dispatch = (attempt: Attempt) => {
    if (!current(attempt)) return;
    let input: RunAgentInput;
    try {
      const value = publication.getObservation();
      const decision = value.decision;
      input = {
        threadId,
        runId: attempt.id,
        protocolVersion: PROTOCOL_VERSION,
        messages: requestMessages(value.transcript),
        state: instruments.requestState(requestState(value.state)),
        tools: copyData(declared, false) as Tool[],
        context: [],
        ...answerFields(decision, attempt.id),
      };
    } catch {
      publication.command(() =>
        finish(
          attempt,
          attempt.controller.signal.aborted ? 'aborted' : 'error',
          false
        )
      );
      return;
    }
    if (!current(attempt)) return;
    attempt.starting = true;
    if (stable === undefined) lifecycle.mark('threadCreatedAt');
    attempt.ended = instruments.request(attempt.kind);
    // A run a host scripted is served in place of the network, once.
    const scripted = instruments.scriptedFetch();
    const runner = scripted
      ? createRun({ url: 'scripted:', fetch: scripted, interruptMode })
      : factory;
    // createRun owns all first-result and invocation facts once start is called.
    attempt.handle = runner.start(
      input,
      (delivered) => {
        if (!current(attempt)) return;
        if (delivered.type === 'RUN_STARTED') attempt.started = true;
        lifecycle.mark('streamStartedAt');
        // createRun delivers the SDK's normalized/verified union through its
        // BaseEvent callback. No second schema parse or sequence verifier.
        const event = instruments.redact(delivered as AGUIEvent);
        instruments.received(event);
        const previous = publication.getObservation();
        let next = reasoningClock.observe(
          event as AGUIEvent,
          applyObservation(previous, event as AGUIEvent, interruptMode),
          previous
        );
        const terminal = next.run?.terminal;
        const notice = next.run?.legacyInterrupt;
        const evidence =
          terminal !== previous.run?.terminal
            ? terminal
            : notice !== previous.run?.legacyInterrupt
            ? notice
            : undefined;
        if (evidence)
          next = Object.freeze({
            ...next,
            decision: observeDecision(
              previous.decision,
              attempt.id,
              evidence,
              pauseFor(evidence, interruptTransport),
              interruptTransport
            ),
          });
        // Only a durable session records that the answering run started: the
        // saved thread then says the backend has the answer.
        const acknowledged = durability
          ? acknowledgeDecision(next.decision, attempt.id)
          : next.decision;
        const started =
          event.type === 'RUN_STARTED' && acknowledged !== next.decision;
        if (started) next = Object.freeze({ ...next, decision: acknowledged });
        if (current(attempt)) {
          instruments.cause(event.type);
          publication.publish(next);
          if (started) void durability?.save().catch(() => undefined);
        }
        // The stream shows what the snapshot saw, after the snapshot shows it.
        if (current(attempt)) instruments.raw(event);
        const custom = captureCustomEvent(event as AGUIEvent);
        if (custom && current(attempt)) publication.emitCustomEvent(custom);
      },
      attempt.controller.signal
    );
    attempt.starting = false;
    if (!current(attempt)) attempt.handle.abort();
    void attempt.handle.done.then((result) =>
      publication.command(() =>
        finish(
          attempt,
          result.outcome,
          answerTaken(
            result,
            attempt.started,
            publication.getObservation().run?.terminal
          ),
          httpFailure(result),
          result.outcome === 'error' ? result.error : undefined
        )
      )
    );
  };
  const admit = (
    id: string,
    next: Observation,
    signal: AbortSignal | undefined,
    resolve: (outcome: CompleteOutcome) => void,
    kind: SessionRequestType = 'submit'
  ) => {
    revision++;
    let settle!: (outcome: CompleteOutcome) => void;
    const done = new Promise<CompleteOutcome>((yes) => {
      settle = yes;
    });
    const attempt: Attempt = {
      id,
      kind,
      controller: new AbortController(),
      done,
      resolve: settle,
      cleanup: () => undefined,
      starting: false,
      started: false,
      finished: false,
    };
    void done.then(resolve);
    const previous = active;
    active = attempt;
    if (previous) cancel(previous);
    const abort = () =>
      publication.command(() => {
        if (active === attempt) {
          revision++;
          cancel(attempt);
        }
      });
    signal?.addEventListener('abort', abort, { once: true });
    attempt.cleanup = () => signal?.removeEventListener('abort', abort);
    instruments.cause('run:start');
    publication.publish(next);
    if (!current(attempt)) return;
    // An answer is saved before it is sent, so a reload in between knows one
    // may have left. A failed save sends nothing and releases the claim.
    if (durability && next.decision?.kind === 'native' && next.decision.attempt)
      void durability.save().then(
        () => dispatch(attempt),
        () => publication.command(() => finish(attempt, 'error', false))
      );
    // Dispatch only after commands queued by this publication have drained.
    else queueMicrotask(() => dispatch(attempt));
  };
  const close = (permanent: boolean): Promise<void> => {
    // Track command intent even while notification defers its mutation. A
    // reentrant caller getter must not make an older capture current again.
    revision++;
    return new Promise((resolve) => {
      publication.command(() => {
        if (permanent) {
          disposed = true;
          durability?.dispose();
          // Events are not settlement: stop delivering them right away.
          publication.clearCustomEventListeners();
          instruments.clear();
          lifecycle.clearListeners();
        }
        const attempt = active;
        if (attempt) {
          cancel(attempt);
          void attempt.done.then(() => resolve());
        } else {
          if (disposed) publication.clear();
          resolve();
        }
      });
    });
  };
  /**
   * Starts a run for `submit` and `runWithoutMessage`: the captured content,
   * when there is any, is appended as the user message.
   */
  const begin = (
    capture: () => CapturedExtras,
    options: { readonly signal?: AbortSignal } | undefined,
    kind: SessionRequestType = 'submit'
  ) =>
    new Promise<CompleteOutcome>((resolve) => {
      const capturedRevision = revision;
      let signal: AbortSignal | undefined;
      try {
        signal = options?.signal;
      } catch {
        resolve(
          disposed || revision !== capturedRevision ? 'aborted' : 'error'
        );
        return;
      }
      if (disposed || signal?.aborted || revision !== capturedRevision) {
        resolve('aborted');
        return;
      }
      if (publication.getObservation().decision) {
        resolve('error');
        return;
      }
      const beforeInput = ++revision;
      let captured: CapturedExtras;
      try {
        captured = capture();
      } catch {
        resolve(
          disposed || signal?.aborted || revision !== beforeInput
            ? 'aborted'
            : 'error'
        );
        return;
      }
      if (disposed || signal?.aborted || revision !== beforeInput) {
        resolve('aborted');
        return;
      }
      publication.command(() => {
        if (disposed || signal?.aborted) {
          resolve('aborted');
          return;
        }
        if (publication.getObservation().decision) {
          resolve('error');
          return;
        }
        const beforeCapture = revision;
        let next: Observation;
        let id: string;
        try {
          const previous = publication.getObservation();
          // Capture precedes queueing, but admission uses the latest state.
          // Incompatible patches fail before transferring the active run.
          const sent = withExtras(previous, captured);
          id = crypto.randomUUID();
          next = Object.freeze({
            ...previous,
            status: 'running',
            ...sent,
            ...nextInvocationSubagents(previous),
            run: Object.freeze({ id }),
          });
        } catch {
          resolve(
            disposed || signal?.aborted || revision !== beforeCapture
              ? 'aborted'
              : 'error'
          );
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeCapture) {
          resolve('aborted');
          return;
        }
        saved = {
          runId: id,
          transcript: next.transcript,
          state: next.state,
        };
        answered = undefined;
        admit(id, next, signal, resolve, kind);
      });
    });
  /** Records one pending call's result as the tool record the next request sends. */
  const settleCall = (toolCallId: string, result: ClientToolResult): void => {
    if (disposed) throw new Error('The session is disposed.');
    const pending = publication.getSnapshot().pendingClientTools;
    if (!pending?.some((call) => call.id === toolCallId))
      throw new Error(`No pending client tool call has the id ${toolCallId}.`);
    const ok = result.ok === true;
    const failure = ok ? undefined : String(result.error);
    const value = ok ? result.value : undefined;
    const content = ok
      ? typeof value === 'string'
        ? value
        : JSON.stringify(value) ?? ''
      : `Error: ${failure}`;
    const previous = publication.getObservation();
    const wanted = `tool-${toolCallId}`;
    const messageId = previous.transcript.some((row) => row.id === wanted)
      ? crypto.randomUUID()
      : wanted;
    let transcript = applyToolMessage(previous.transcript, {
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId,
      content,
    } as ToolCallResultEvent);
    // The protocol's tool record says why a tool failed in its own field.
    if (failure !== undefined)
      transcript = Object.freeze(
        transcript.map((row) =>
          row.id === messageId ? Object.freeze({ ...row, error: failure }) : row
        )
      );
    instruments.cause('client-tool:result');
    publication.publish(Object.freeze({ ...previous, transcript }));
  };
  const clientTools: AgentClientTools = {
    setCatalog: (specs: readonly ClientToolSpec[]): void => {
      if (!Array.isArray(specs))
        throw new TypeError('A catalog is an array of client tool specs');
      const tools: Tool[] = [];
      const names = new Set<string>();
      for (const spec of specs as readonly ClientToolSpec[]) {
        const { name, description, parameters } = spec;
        if (typeof name !== 'string' || !name || names.has(name))
          throw new TypeError('A client tool needs a unique name');
        if (typeof description !== 'string')
          throw new TypeError('A client tool needs a description');
        names.add(name);
        tools.push(
          copyData(
            {
              name,
              description,
              ...(parameters !== undefined && { parameters }),
            },
            true
          ) as Tool
        );
      }
      if (disposed) return;
      declared = Object.freeze(tools);
      const catalog = Object.freeze([...names]);
      publication.command(() => {
        if (disposed) return;
        instruments.cause('client-tool:catalog');
        publication.publish(
          Object.freeze({
            ...publication.getObservation(),
            clientToolCatalog: catalog,
          })
        );
      });
    },
    settle: settleCall,
    // A settled result is already in the history the next request sends.
    // With persistence, the thread that holds it is saved now.
    flush: () => durability?.save(),
    resolve: (toolCallId, result) => {
      settleCall(toolCallId, result);
      void begin(() => NO_EXTRAS, undefined, 'client-tool-continuation');
    },
  };
  const session: Session = {
    threadId,
    ...(agentId !== undefined && { agentId }),
    ...(stateType !== undefined && { stateType }),
    getSnapshot: publication.getSnapshot,
    subscribe: (notify) =>
      disposed ? () => undefined : publication.subscribe(notify),
    onCustomEvent: (listener) =>
      disposed ? () => undefined : publication.onCustomEvent(listener),
    onRawEvent: (listener) =>
      disposed ? () => undefined : instruments.onRawEvent(listener),
    resume: (responses, options) =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        const beforeSignal = revision;
        let signal: AbortSignal | undefined;
        let pause: unknown;
        try {
          signal = options?.signal;
          pause = options?.pause;
        } catch {
          resolve(disposed || revision !== beforeSignal ? 'aborted' : 'error');
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeSignal) {
          resolve('aborted');
          return;
        }
        const beforeInput = ++revision;
        let captured: readonly NativeResponse[];
        let extras: CapturedExtras;
        try {
          const previous = publication.getObservation();
          if (!answerable || active) throw new TypeError(NOT_SETTLED);
          captured = captureResponses(responses);
          extras = captureExtras(options);
          const eligible = assertResumeEligible(
            previous.decision,
            previous.run,
            Date.now()
          );
          assertCurrentPause(eligible, pause);
          claimDecision(eligible, captured, '');
        } catch (error) {
          if (disposed || signal?.aborted || revision !== beforeInput)
            resolve('aborted');
          else reject(error);
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeInput) {
          resolve('aborted');
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted) {
            resolve('aborted');
            return;
          }
          const beforeAdmission = revision;
          let next: Observation;
          let id: string;
          try {
            const previous = publication.getObservation();
            if (active || !answerable) throw new TypeError(NOT_SETTLED);
            const decision = assertResumeEligible(
              previous.decision,
              previous.run,
              Date.now()
            );
            assertCurrentPause(decision, pause);
            id = crypto.randomUUID();
            next = Object.freeze({
              ...previous,
              decision: claimDecision(decision, captured, id),
              status: 'running',
              // A message and a state patch travel with the answers.
              ...withExtras(previous, extras),
              ...nextInvocationSubagents(previous),
              run: Object.freeze({ id }),
            });
            answered = {
              runId: id,
              pause: decision.id,
              responses: captured,
              transcript: next.transcript,
              state: next.state,
            };
          } catch (error) {
            if (disposed || signal?.aborted || revision !== beforeAdmission)
              resolve('aborted');
            else reject(error);
            return;
          }
          if (disposed || signal?.aborted || revision !== beforeAdmission) {
            resolve('aborted');
            return;
          }
          saved = undefined;
          lifecycle.mark('interruptResolvedAt');
          admit(id, next, signal, resolve, 'resume');
        });
      }),
    submit: (input, options) =>
      begin(() => {
        const captured = captureSubmit(input);
        return {
          content: captured.content ?? captured.message,
          ...(captured.state && { state: captured.state }),
        };
      }, options),
    runWithoutMessage: (input, options) =>
      begin(() => captureExtras({ state: input?.state }), options),
    clientTools,
    lifecycle: {
      getSnapshot: lifecycle.source.getSnapshot,
      subscribe: (notify) =>
        disposed ? () => undefined : lifecycle.source.subscribe(notify),
    },
    retry: () =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        if (disposed) {
          resolve('aborted');
          return;
        }
        // Nothing failed or a run is going: nothing runs, as for an ignored submit.
        const published = publication.getSnapshot();
        if (published.status !== 'error') {
          resolve('aborted');
          return;
        }
        if (published.error?.recovery !== 'retry') {
          reject(new Error(UNSAFE_RETRY));
          return;
        }
        publication.command(() => {
          const previous = publication.getObservation();
          const answer = answered;
          // A resume that never left is sent again, exactly as it was.
          if (!disposed && !active && answerUnsent(previous, answer)) {
            let decision: NativeDecision;
            const id = crypto.randomUUID();
            try {
              decision = claimDecision(
                assertResumeEligible(
                  previous.decision,
                  previous.run,
                  Date.now()
                ),
                answer.responses,
                id
              );
            } catch {
              resolve('error');
              return;
            }
            answered = { ...answer, runId: id };
            admit(
              id,
              Object.freeze({
                ...previous,
                decision,
                status: 'running',
                transcript: answer.transcript,
                state: answer.state,
                ...nextInvocationSubagents(previous, answer.transcript),
                run: Object.freeze({ id }),
              }),
              undefined,
              resolve,
              'retry'
            );
            return;
          }
          const last = saved;
          if (
            disposed ||
            active ||
            !last ||
            previous.status !== 'error' ||
            previous.run?.id !== last.runId
          ) {
            resolve('aborted');
            return;
          }
          if (!failedWithRunError(previous)) {
            resolve('error');
            return;
          }
          const id = crypto.randomUUID();
          saved = { ...last, runId: id };
          // The failed run's output and state changes are dropped: the request
          // is rebuilt from exactly what the failed submission sent.
          admit(
            id,
            Object.freeze({
              ...previous,
              status: 'running',
              transcript: last.transcript,
              state: last.state,
              ...nextInvocationSubagents(previous, last.transcript),
              run: Object.freeze({ id }),
            }),
            undefined,
            resolve,
            'retry'
          );
        });
      }),
    regenerate: (messageId, options) =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        const signal = options?.signal;
        publication.command(() => {
          const previous = publication.getObservation();
          let prompt = -1;
          try {
            if (disposed) throw new Error('The session is disposed.');
            if (active)
              throw new Error('Cannot regenerate while a response is running.');
            if (previous.decision)
              throw new Error('Cannot regenerate while a decision is waiting.');
            prompt = regeneratePrompt(previous.transcript, messageId);
          } catch (error) {
            reject(error);
            return;
          }
          if (signal?.aborted) {
            resolve('aborted');
            return;
          }
          const id = crypto.randomUUID();
          // Keep the prompt: it ends the history and is the next run's input.
          const transcript = Object.freeze(
            previous.transcript.slice(0, prompt + 1)
          );
          saved = { runId: id, transcript, state: previous.state };
          answered = undefined;
          admit(
            id,
            Object.freeze({
              ...previous,
              status: 'running',
              transcript,
              ...nextInvocationSubagents(previous, transcript),
              run: Object.freeze({ id }),
            }),
            signal,
            resolve,
            'regenerate'
          );
        });
      }),
    stop: () => close(false),
    dispose: () => close(true),
    isDevelopmentRuntimeEnabled: instruments.developmentEnabled,
  };
  return durableSession(session, durability, persistence !== undefined);
}

/** A command can own several physical runs, but never lends execution authority
 * to a superseding submit. The legacy no-catalog owner above remains separate. */
function createToolsOwner(
  options: CapturedOptions,
  catalog: ReturnType<typeof captureClientTools>
): Session {
  const { threadId, interruptMode = 'native', interruptTransport } = options;
  const instruments = createInstruments(options);
  const factory = createRun({
    ...options,
    fetch: instruments.fetch(options.fetch),
  });
  const answerable =
    interruptMode === 'native' || answersNotice(interruptTransport);
  const reasoningClock = createReasoningClock();
  const initial = startingObservation(options);
  let ledger = createClientToolLedger<Record<string, ToolContract>>(
    [...catalog.keys()],
    initial.transcript
  );
  /** The latest answer sent, kept until another command replaces it. */
  let answered: FailedAnswer | undefined;
  const lifecycle = createLifecycleRecorder();
  const publication = createPublication(
    Object.freeze({
      ...initial,
      clientTools: ledger.snapshot(),
    }),
    // Only the failed request this owner can rebuild is offered as retryable.
    createPresenter(
      options.stateType,
      (observation) =>
        retryable(observation) || answerUnsent(observation, answered),
      options.persistence?.reconcile !== undefined,
      instruments.protect
    )
  );
  /** The last request sent that was not an answer to a decision. */
  let saved:
    | {
        readonly runId: string;
        readonly transcript: Transcript;
        readonly state: PlainValue;
      }
    | undefined;
  /**
   * A backend `RUN_ERROR` for the saved request, with nothing in the ledger in
   * doubt beyond the blocker that failure itself installed.
   */
  const retryable = (observation: Observation): boolean => {
    const blocker = (
      observation as { clientTools?: { blocker?: ClientToolBlocker } }
    ).clientTools?.blocker;
    const runId = saved?.runId;
    return (
      failedWithRunError(observation) &&
      runId !== undefined &&
      runId === observation.run?.id &&
      (!blocker ||
        (blocker.reason === 'uncertain' &&
          blocker.sourceRunId === runId &&
          !blocker.callIds.length))
    );
  };
  // Reading a snapshot asks `retryable`, so this follows its definition.
  instruments.follow(publication);
  followLifecycle(publication, lifecycle);
  interface Physical {
    readonly id: string;
    readonly token: object;
    readonly kind: SessionRequestType;
    ended?: (outcome: CompleteOutcome) => void;
    handle?: RunHandle;
    starting: boolean;
    /** The backend reported `RUN_STARTED` for this request. */
    started: boolean;
    settled: boolean;
    fetchInvoked: boolean;
  }
  interface Command {
    readonly controller: AbortController;
    readonly done: Promise<CompleteOutcome>;
    readonly resolve: (outcome: CompleteOutcome) => void;
    cleanup: () => void;
    physical?: Physical;
    groups: number;
    finished: boolean;
  }
  let active: Command | undefined;
  let disposed = false;
  let revision = 0;
  let pausedPhysical:
    | { readonly id: string; readonly token: object }
    | undefined;
  const durability = isDurable(options)
    ? createDurability(
        { ...options, redact: instruments.redact },
        {
          publication,
          replayed: (events) => events.forEach(instruments.raw),
          restored: () => {
            lifecycle.mark('threadPersistedAt');
            lifecycle.flush();
          },
          active: () => active !== undefined,
          disposed: () => disposed,
          adopt: (observation) => {
            const decision = observation.decision;
            // A restored pause keeps the calls that were unresolved when it
            // paused; they travel with its answer.
            ledger = createClientToolLedger<Record<string, ToolContract>>(
              [...catalog.keys()],
              observation.transcript,
              decision?.kind === 'native'
            );
            saved = undefined;
            answered = undefined;
            pausedPhysical = undefined;
            if (decision?.kind === 'native') {
              const token = ledger.startPhysical({
                runId: decision.sourceRunId,
                threadId,
                transcript: observation.transcript,
              });
              ledger.markPaused(token);
              pausedPhysical = { id: decision.sourceRunId, token };
            }
            instruments.cause('history');
            publication.publish(
              Object.freeze({ ...observation, clientTools: ledger.snapshot() })
            );
          },
        }
      )
    : undefined;
  const owns = (command: Command, physical?: Physical) =>
    active === command &&
    !command.finished &&
    (!physical || command.physical === physical);
  const eligible = (command: Command, physical?: Physical) =>
    owns(command, physical) &&
    !disposed &&
    !command.controller.signal.aborted &&
    !ledger.snapshot().blocker &&
    !publication.getObservation().decision;
  const publishLedger = (outcome?: CompleteOutcome) => {
    const previous = publication.getObservation();
    publication.publish(
      Object.freeze({
        ...previous,
        transcript: ledger.retainHistory(previous.transcript),
        clientTools: Object.freeze({
          ...ledger.snapshot(),
          ...(outcome && { commandOutcome: outcome }),
        }),
      })
    );
  };
  const block = (
    reason: 'cancelled' | 'uncertain' | 'limit',
    command: Command,
    ids: readonly string[] = []
  ) => {
    ledger.installBlocker({
      reason,
      callIds: ids,
      sourceRunId: command.physical?.id ?? '',
    });
  };
  const unresolvedRootIds = () => {
    const history = publication.getObservation().transcript;
    return history.flatMap((message) =>
      message.role === 'assistant' && typeof message.subagentRunId !== 'string'
        ? (message.toolCalls ?? [])
            .filter(
              (call) =>
                !history.some(
                  (row) =>
                    row.role === 'tool' &&
                    row.toolCallId === call.id &&
                    typeof row.subagentRunId !== 'string'
                )
            )
            .map((call) => call.id)
        : []
    );
  };
  const protectCancellation = (command: Command, physical: Physical) => {
    ledger.cancelIncomplete(physical.id);
    const snapshot = publication.getObservation();
    if (snapshot.decision) return;
    const terminal = snapshot.run?.terminal;
    const conclusive =
      terminal?.type === 'RUN_FINISHED' &&
      (terminal.outcome == null ||
        terminal.outcome.type === 'success' ||
        terminal.outcome.type === 'cancelled');
    if (conclusive) {
      const unresolved = unresolvedRootIds();
      if (unresolved.length) block('cancelled', command, unresolved);
    } else if (physical.fetchInvoked || command.groups > 0)
      block('uncertain', command);
  };
  const finish = (command: Command, outcome: CompleteOutcome) => {
    if (!owns(command)) return;
    command.finished = true;
    command.cleanup();
    // Keep admission busy through final notification; reentrant submit cannot
    // append a new human while this command's result is being published.
    const previous = publication.getObservation();
    instruments.cause('run:end');
    publication.publish(
      Object.freeze({
        ...previous,
        transcript: ledger.retainHistory(previous.transcript),
        status:
          outcome === 'error' || outcome === 'interrupted' ? 'error' : 'idle',
        clientTools: Object.freeze({
          ...ledger.snapshot(),
          commandOutcome: outcome,
        }),
      })
    );
    active = undefined;
    durability?.settled();
    if (disposed) publication.clear();
    command.resolve(outcome);
  };
  const cancel = (command: Command) => {
    if (!owns(command)) return;
    command.controller.abort();
    const physical = command.physical;
    if (physical && !physical.settled) {
      physical.handle?.abort();
      // Its result callback owns native decision settlement, including starts
      // whose physical handle is not assigned yet.
      if (physical.starting || physical.handle) return;
    }
    if (physical?.settled) protectCancellation(command, physical);
    else ledger.cancelIncomplete(physical?.id ?? '');
    finish(command, 'aborted');
  };
  const cancelledResult = Symbol('cancelled handler');
  const admittedDefinition = (id: string) => {
    const call = ledger.snapshot().calls.find((call) => call.callId === id);
    const definition = call && catalog.get(call.name);
    if (!call || !definition) throw new TypeError('No admitted client tool');
    return { call, definition };
  };
  const invoke = async (command: Command, action: () => unknown) => {
    const signal = command.controller.signal;
    if (signal.aborted) return cancelledResult;
    let abort!: () => void;
    const cancelled = new Promise<typeof cancelledResult>((resolve) => {
      abort = () => resolve(cancelledResult);
      signal.addEventListener('abort', abort, { once: true });
    });
    // Promise adoption observes late rejection even when cancellation wins.
    const result = Promise.resolve().then(() => {
      if (!eligible(command)) return cancelledResult;
      return action();
    });
    try {
      return await Promise.race([result, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  const execute = async (
    command: Command,
    physical: Physical,
    group: readonly string[]
  ) => {
    for (const id of group) {
      if (!eligible(command, physical)) return;
      const { call, definition } = admittedDefinition(id);
      let value: unknown;
      let error = call.error;
      if (error === undefined) {
        publication.command(() => {
          if (eligible(command, physical)) {
            ledger.markRunning(id);
            publishLedger();
          }
        });
        // Publications have drained all queued stop/dispose/submit commands.
        if (!eligible(command, physical)) return;
        try {
          value = await invoke(command, () =>
            definition.handler(ledger.argumentsFor(id) as never, {
              signal: command.controller.signal,
            })
          );
        } catch (failure) {
          try {
            const message =
              failure instanceof Error ? failure.message : undefined;
            error =
              typeof message === 'string'
                ? message
                : 'Client tool handler failed';
          } catch {
            error = 'Client tool handler failed';
          }
        }
      }
      if (value === cancelledResult || !eligible(command, physical)) return;
      publication.command(() => {
        if (!eligible(command, physical)) return;
        // Result getters run while this command queue is draining. Stop,
        // disposal and caller abort register intent synchronously via revision,
        // before their queued cancellation can mutate the command or ledger.
        const completionRevision = revision;
        const completionAuthority = () =>
          revision === completionRevision && eligible(command, physical);
        try {
          const history = publication.getObservation().transcript;
          if (error !== undefined)
            ledger.fail(
              id,
              crypto.randomUUID(),
              error,
              history,
              completionAuthority
            );
          else
            ledger.complete(
              id,
              crypto.randomUUID(),
              value,
              history,
              completionAuthority
            );
          if (completionAuthority()) publishLedger();
        } catch {
          // A queued cancellation owns settlement; do not relabel that intent
          // as a conflict or retain a result authored during its ownership copy.
          if (revision !== completionRevision) return;
          if (
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          ) {
            ledger.installBlocker({
              reason: 'conflict',
              sourceRunId: physical.id,
              callIds: [id],
            });
            ledger.cancelIncomplete(physical.id);
            finish(command, 'interrupted');
          }
        }
      });
      if (!eligible(command, physical)) return;
    }
    publication.command(() => {
      if (!eligible(command, physical)) return;
      if (!group.some((id) => admittedDefinition(id).definition.followUp)) {
        finish(command, 'success');
        return;
      }
      startPhysical(command, crypto.randomUUID());
    });
  };
  const settlePhysical = (
    command: Command,
    physical: Physical,
    outcome: CompleteOutcome,
    fetchInvoked: boolean,
    failure?: { readonly status: number },
    cause?: unknown,
    /** The request may have reached a run; see `answerTaken`. */
    taken = fetchInvoked
  ) => {
    if (physical.settled) return;
    physical.settled = true;
    physical.fetchInvoked = fetchInvoked;
    physical.ended?.(outcome);
    if (!owns(command, physical)) return;
    const previous = publication.getObservation();
    const terminal = previous.run?.terminal;
    const decision = settleDecision(
      previous.decision,
      { id: physical.id, outcome, terminal },
      taken
    );
    // The run announced a pause and then finished in the ordinary way.
    const noticed =
      (outcome === 'success' || outcome === 'paused') &&
      pausedByNotice(decision, physical.id);
    if (noticed) {
      outcome = 'paused';
      ledger.markPaused(physical.token);
    }
    if (
      noticed ||
      (previous.decision?.kind === 'native' &&
        terminal?.type === 'RUN_FINISHED' &&
        terminal.outcome?.type === 'interrupt')
    )
      pausedPhysical = physical;
    const nativeSuccess =
      !noticed &&
      terminal?.type === 'RUN_FINISHED' &&
      (terminal.outcome == null || terminal.outcome.type === 'success');
    const run = Object.freeze({
      ...previous.run,
      id: physical.id,
      outcome: nativeSuccess ? ('success' as const) : outcome,
      ...(failure &&
        !nativeSuccess &&
        outcome === 'error' &&
        !instruments.protect && { failure }),
    });
    const diagnostic =
      !nativeSuccess && outcome === 'error' && !instruments.protect
        ? failureDiagnostic(terminal, cause)
        : undefined;
    if (diagnostic) noteFailure(run, diagnostic);
    publication.publish(
      Object.freeze({
        ...previous,
        decision,
        run,
        clientTools: ledger.snapshot(),
      })
    );
    // Observer commands queued by native result publication precede local tool
    // admission or command completion, including stop on a success callback.
    publication.command(() => {
      if (!owns(command, physical)) return;
      if (command.controller.signal.aborted || disposed) {
        protectCancellation(command, physical);
        finish(command, 'aborted');
        return;
      }
      if (publication.getObservation().decision || outcome === 'paused') {
        finish(command, outcome);
        return;
      }
      if (outcome !== 'success') {
        if (
          terminal?.type === 'RUN_FINISHED' &&
          terminal.outcome?.type === 'cancelled'
        )
          protectCancellation(command, physical);
        else if (fetchInvoked || command.groups > 0)
          block('uncertain', command);
        finish(command, outcome);
        return;
      }
      if (ledger.snapshot().blocker) {
        finish(command, 'interrupted');
        return;
      }
      // The ledger consumes the whole group before observers can issue commands.
      const group = ledger.admitSuccess(physical.token, command.groups < 10);
      if (ledger.snapshot().blocker) {
        finish(command, 'interrupted');
        return;
      }
      if (!group.length) {
        finish(command, 'success');
        return;
      }
      command.groups++;
      publishLedger();
      queueMicrotask(() => {
        if (eligible(command, physical))
          void execute(command, physical, group).catch(() => {
            publication.command(() => {
              if (
                !owns(command, physical) ||
                command.controller.signal.aborted ||
                disposed
              )
                return;
              ledger.installBlocker({
                reason: 'conflict',
                sourceRunId: physical.id,
                callIds: group,
              });
              ledger.cancelIncomplete(physical.id);
              finish(command, 'interrupted');
            });
          });
      });
    });
  };
  const dispatch = (command: Command, physical: Physical) => {
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      return;
    let input: RunAgentInput;
    let capture: ReturnType<typeof ledger.captureRequest>;
    try {
      const snapshot = publication.getObservation();
      const resuming =
        snapshot.decision?.kind === 'native' &&
        snapshot.decision.attempt?.runId === physical.id;
      if (
        resuming &&
        (!pausedPhysical ||
          snapshot.decision?.sourceRunId !== pausedPhysical.id)
      )
        throw new TypeError('Resume does not match owned physical pause');
      capture =
        resuming && pausedPhysical
          ? ledger.captureNativeResumeRequest(
              snapshot.transcript,
              pausedPhysical.token
            )
          : ledger.captureRequest(snapshot.transcript);
      saved = resuming
        ? undefined
        : {
            runId: physical.id,
            transcript: capture.transcript,
            state: snapshot.state,
          };
      input = {
        threadId,
        runId: physical.id,
        protocolVersion: PROTOCOL_VERSION,
        messages: requestMessages(capture.transcript),
        state: instruments.requestState(requestState(snapshot.state)),
        tools: requestClientTools(catalog),
        context: [],
        ...answerFields(snapshot.decision, physical.id),
      };
    } catch {
      publication.command(() =>
        settlePhysical(
          command,
          physical,
          command.controller.signal.aborted ? 'aborted' : 'error',
          false
        )
      );
      return;
    }
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      return;
    physical.starting = true;
    if (options.ownThread) lifecycle.mark('threadCreatedAt');
    physical.ended = instruments.request(physical.kind);
    const scripted = instruments.scriptedFetch();
    const runner = scripted
      ? createRun({ url: 'scripted:', fetch: scripted, interruptMode })
      : factory;
    physical.handle = runner.start(
      input,
      (delivered) => {
        publication.command(() => {
          if (
            !owns(command, physical) ||
            command.controller.signal.aborted ||
            disposed
          )
            return;
          if (delivered.type === 'RUN_STARTED') physical.started = true;
          lifecycle.mark('streamStartedAt');
          const event = instruments.redact(delivered as AGUIEvent);
          instruments.received(event);
          const previous = publication.getObservation();
          let next = reasoningClock.observe(
            event as AGUIEvent,
            applyObservation(previous, event as AGUIEvent, interruptMode),
            previous
          );
          ledger.observe(physical.token, event as AGUIEvent, next.transcript);
          const evidence =
            next.run?.terminal !== previous.run?.terminal
              ? next.run?.terminal
              : next.run?.legacyInterrupt !== previous.run?.legacyInterrupt
              ? next.run?.legacyInterrupt
              : undefined;
          if (evidence)
            next = Object.freeze({
              ...next,
              decision: observeDecision(
                previous.decision,
                physical.id,
                evidence,
                pauseFor(evidence, interruptTransport),
                interruptTransport
              ),
            });
          const acknowledged = durability
            ? acknowledgeDecision(next.decision, physical.id)
            : next.decision;
          const started =
            event.type === 'RUN_STARTED' && acknowledged !== next.decision;
          if (started)
            next = Object.freeze({ ...next, decision: acknowledged });
          if (
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          ) {
            instruments.cause(event.type);
            publication.publish(
              Object.freeze({
                ...next,
                transcript: ledger.retainHistory(next.transcript),
                clientTools: ledger.snapshot(),
              })
            );
            if (started) void durability?.save().catch(() => undefined);
          }
          if (
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          )
            instruments.raw(event);
          const custom = captureCustomEvent(event as AGUIEvent);
          if (
            custom &&
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          )
            publication.emitCustomEvent(custom);
        });
      },
      command.controller.signal,
      () => {
        if (
          !owns(command, physical) ||
          disposed ||
          command.controller.signal.aborted ||
          ledger.snapshot().blocker
        )
          return false;
        const decision = publication.getObservation().decision;
        if (
          decision &&
          !(
            decision.kind === 'native' &&
            decision.attempt?.runId === physical.id
          )
        )
          return false;
        ledger.markFetchInvoked(capture);
        // No publication here: the guard is adjacent to actual fetch invocation.
        return (
          owns(command, physical) &&
          !disposed &&
          !command.controller.signal.aborted
        );
      }
    );
    physical.starting = false;
    if (
      owns(command, physical) &&
      !disposed &&
      !command.controller.signal.aborted
    )
      publication.command(() => {
        if (owns(command, physical)) publishLedger();
      });
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      physical.handle.abort();
    void physical.handle.done.then((result) =>
      publication.command(() =>
        settlePhysical(
          command,
          physical,
          result.outcome,
          result.fetchInvoked,
          httpFailure(result),
          result.outcome === 'error' ? result.error : undefined,
          answerTaken(
            result,
            physical.started,
            publication.getObservation().run?.terminal
          )
        )
      )
    );
  };
  const startPhysical = (command: Command, id: string) => {
    const previous = publication.getObservation();
    const physical: Physical = {
      id,
      kind: 'client-tool-continuation',
      token: ledger.startPhysical({
        runId: id,
        threadId,
        transcript: previous.transcript,
      }),
      starting: false,
      started: false,
      settled: false,
      fetchInvoked: false,
    };
    command.physical = physical;
    instruments.cause('run:start');
    publication.publish(
      Object.freeze({
        ...previous,
        status: 'running',
        ...nextInvocationSubagents(previous),
        run: Object.freeze({ id }),
        clientTools: ledger.snapshot(),
      })
    );
    queueMicrotask(() => dispatch(command, physical));
  };
  const admit = (
    next: Observation,
    id: string,
    signal: AbortSignal | undefined,
    resolve: (outcome: CompleteOutcome) => void,
    kind: SessionRequestType = 'submit'
  ) => {
    let settle!: (outcome: CompleteOutcome) => void;
    const done = new Promise<CompleteOutcome>((yes) => {
      settle = yes;
    });
    const command: Command = {
      controller: new AbortController(),
      done,
      resolve: settle,
      cleanup: () => undefined,
      groups: 0,
      finished: false,
    };
    active = command;
    revision++;
    void done.then(resolve);
    const abort = () => {
      revision++;
      publication.command(() => cancel(command));
    };
    signal?.addEventListener('abort', abort, { once: true });
    command.cleanup = () => signal?.removeEventListener('abort', abort);
    const physical: Physical = {
      id,
      kind,
      token: ledger.startPhysical({
        runId: id,
        threadId,
        transcript: next.transcript,
      }),
      starting: false,
      started: false,
      settled: false,
      fetchInvoked: false,
    };
    command.physical = physical;
    instruments.cause('run:start');
    publication.publish(
      Object.freeze({ ...next, clientTools: ledger.snapshot() })
    );
    // An answer is saved before it is sent; see the owner without tools.
    if (durability && next.decision?.kind === 'native' && next.decision.attempt)
      void durability.save().then(
        () => dispatch(command, physical),
        () =>
          publication.command(() =>
            settlePhysical(command, physical, 'error', false)
          )
      );
    else queueMicrotask(() => dispatch(command, physical));
  };
  const close = (permanent: boolean) => {
    revision++;
    return new Promise<void>((resolve) =>
      publication.command(() => {
        if (permanent) {
          disposed = true;
          durability?.dispose();
          // Events are not settlement: stop delivering them right away.
          publication.clearCustomEventListeners();
          instruments.clear();
          lifecycle.clearListeners();
        }
        const command = active;
        if (command) {
          cancel(command);
          void command.done.then(() => resolve());
        } else {
          if (disposed) publication.clear();
          resolve();
        }
      })
    );
  };
  /**
   * Starts a command for `submit` and `runWithoutMessage`: the captured
   * content, when there is any, is appended as the user message.
   */
  const begin = (
    capture: () => CapturedExtras,
    options: { readonly signal?: AbortSignal } | undefined
  ) =>
    new Promise<CompleteOutcome>((resolve) => {
      if (disposed) {
        resolve('aborted');
        return;
      }
      // Even options.signal is caller code. Busy/blocker checks precede it.
      if (
        active ||
        ledger.snapshot().blocker ||
        publication.getObservation().decision
      ) {
        resolve('error');
        return;
      }
      const before = revision;
      let signal: AbortSignal | undefined;
      let captured: CapturedExtras;
      try {
        signal = options?.signal;
        if (disposed || signal?.aborted || revision !== before) {
          resolve('aborted');
          return;
        }
        captured = capture();
      } catch {
        resolve(
          disposed || signal?.aborted || revision !== before
            ? 'aborted'
            : 'error'
        );
        return;
      }
      if (disposed || signal?.aborted || revision !== before) {
        resolve('aborted');
        return;
      }
      publication.command(() => {
        if (disposed || signal?.aborted || revision !== before) {
          resolve('aborted');
          return;
        }
        if (
          active ||
          ledger.snapshot().blocker ||
          publication.getObservation().decision
        ) {
          resolve('error');
          return;
        }
        try {
          const previous = publication.getObservation();
          if (!ledger.historyIntegrity(previous.transcript)) {
            publishLedger();
            resolve('error');
            return;
          }
          const sent = withExtras(previous, captured);
          const id = crypto.randomUUID();
          answered = undefined;
          admit(
            Object.freeze({
              ...previous,
              ...sent,
              status: 'running',
              ...nextInvocationSubagents(previous),
              run: Object.freeze({ id }),
            }),
            id,
            signal,
            resolve
          );
        } catch {
          resolve('error');
        }
      });
    });
  const session: Session = {
    threadId,
    ...(options.agentId !== undefined && { agentId: options.agentId }),
    ...(options.stateType !== undefined && { stateType: options.stateType }),
    getSnapshot: publication.getSnapshot,
    subscribe: (notify) =>
      disposed ? () => undefined : publication.subscribe(notify),
    onCustomEvent: (listener) =>
      disposed ? () => undefined : publication.onCustomEvent(listener),
    onRawEvent: (listener) =>
      disposed ? () => undefined : instruments.onRawEvent(listener),
    stop: () => close(false),
    dispose: () => close(true),
    isDevelopmentRuntimeEnabled: instruments.developmentEnabled,
    submit: (input, options) =>
      begin(() => {
        const captured = captureSubmit(input);
        return {
          content: captured.content ?? captured.message,
          ...(captured.state && { state: captured.state }),
        };
      }, options),
    runWithoutMessage: (input, options) =>
      begin(() => captureExtras({ state: input?.state }), options),
    lifecycle: {
      getSnapshot: lifecycle.source.getSnapshot,
      subscribe: (notify) =>
        disposed ? () => undefined : lifecycle.source.subscribe(notify),
    },
    resume: (responses, options) =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        if (disposed) {
          resolve('aborted');
          return;
        }
        if (active || ledger.snapshot().blocker) {
          reject(new TypeError(NOT_SETTLED));
          return;
        }
        const before = revision;
        let signal: AbortSignal | undefined;
        let pause: unknown;
        let captured: readonly NativeResponse[];
        let extras: CapturedExtras;
        try {
          signal = options?.signal;
          pause = options?.pause;
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          if (!answerable) throw new TypeError(NOT_SETTLED);
          const previous = publication.getObservation();
          captured = captureResponses(responses);
          extras = captureExtras(options);
          const eligible = assertResumeEligible(
            previous.decision,
            previous.run,
            Date.now()
          );
          assertCurrentPause(eligible, pause);
          claimDecision(eligible, captured, '');
        } catch (error) {
          if (disposed || signal?.aborted || revision !== before)
            resolve('aborted');
          else reject(error);
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          if (active || ledger.snapshot().blocker) {
            reject(new TypeError(NOT_SETTLED));
            return;
          }
          try {
            const previous = publication.getObservation();
            const decision = assertResumeEligible(
              previous.decision,
              previous.run,
              Date.now()
            );
            assertCurrentPause(decision, pause);
            const id = crypto.randomUUID();
            const next = Object.freeze({
              ...previous,
              decision: claimDecision(decision, captured, id),
              status: 'running' as const,
              // A message and a state patch travel with the answers.
              ...withExtras(previous, extras),
              ...nextInvocationSubagents(previous),
              run: Object.freeze({ id }),
            });
            answered = {
              runId: id,
              pause: decision.id,
              responses: captured,
              transcript: next.transcript,
              state: next.state,
            };
            lifecycle.mark('interruptResolvedAt');
            admit(next, id, signal, resolve, 'resume');
          } catch (error) {
            reject(error);
          }
        });
      }),
    retry: () =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        if (disposed) {
          resolve('aborted');
          return;
        }
        const published = publication.getSnapshot();
        if (published.status !== 'error') {
          resolve('aborted');
          return;
        }
        if (published.error?.recovery !== 'retry') {
          reject(new Error(UNSAFE_RETRY));
          return;
        }
        publication.command(() => {
          const previous = publication.getObservation();
          const answer = answered;
          // A resume that never left is sent again, exactly as it was.
          if (
            !disposed &&
            !active &&
            !ledger.snapshot().blocker &&
            answerUnsent(previous, answer)
          ) {
            const id = crypto.randomUUID();
            let decision: NativeDecision;
            try {
              decision = claimDecision(
                assertResumeEligible(
                  previous.decision,
                  previous.run,
                  Date.now()
                ),
                answer.responses,
                id
              );
            } catch {
              resolve('error');
              return;
            }
            answered = { ...answer, runId: id };
            admit(
              Object.freeze({
                ...previous,
                decision,
                status: 'running',
                transcript: answer.transcript,
                state: answer.state,
                ...nextInvocationSubagents(previous, answer.transcript),
                run: Object.freeze({ id }),
              }),
              id,
              undefined,
              resolve,
              'retry'
            );
            return;
          }
          const last = saved;
          if (
            disposed ||
            active ||
            !last ||
            previous.status !== 'error' ||
            previous.run?.id !== last.runId
          ) {
            resolve('aborted');
            return;
          }
          if (!retryable(previous) || !ledger.releaseUncertain(last.runId)) {
            resolve('error');
            return;
          }
          const id = crypto.randomUUID();
          // The failed run's output and state changes are dropped: the request
          // is rebuilt from what the failed request sent, local tool results
          // included. No handler runs again for them.
          admit(
            Object.freeze({
              ...previous,
              status: 'running',
              transcript: last.transcript,
              state: last.state,
              ...nextInvocationSubagents(previous, last.transcript),
              run: Object.freeze({ id }),
            }),
            id,
            undefined,
            resolve,
            'retry'
          );
        });
      }),
    regenerate: (messageId, options) =>
      new Promise<CompleteOutcome>((resolve, reject) => {
        const signal = options?.signal;
        publication.command(() => {
          const previous = publication.getObservation();
          let prompt: number;
          try {
            if (disposed) throw new Error('The session is disposed.');
            if (active)
              throw new Error('Cannot regenerate while a response is running.');
            if (previous.decision)
              throw new Error('Cannot regenerate while a decision is waiting.');
            if (ledger.snapshot().blocker && !retryable(previous))
              throw new Error(
                'Cannot regenerate while client tool calls are unresolved.'
              );
            prompt = regeneratePrompt(previous.transcript, messageId);
          } catch (error) {
            reject(error);
            return;
          }
          if (signal?.aborted) {
            resolve('aborted');
            return;
          }
          if (saved) ledger.releaseUncertain(saved.runId);
          answered = undefined;
          // Keep the prompt: it ends the history and is the next run's input.
          const transcript = Object.freeze(
            previous.transcript.slice(0, prompt + 1)
          );
          // The calls of the dropped records are dropped with them. A new
          // answer that calls a tool runs its handler again.
          ledger.forgetDropped(transcript);
          const id = crypto.randomUUID();
          admit(
            Object.freeze({
              ...previous,
              status: 'running',
              transcript,
              ...nextInvocationSubagents(previous, transcript),
              run: Object.freeze({ id }),
            }),
            id,
            signal,
            resolve,
            'regenerate'
          );
        });
      }),
  };
  return durableSession(session, durability, options.persistence !== undefined);
}
