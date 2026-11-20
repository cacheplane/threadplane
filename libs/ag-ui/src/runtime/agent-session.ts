import {
  readState,
  type AgentError,
  type AgentErrorDiagnostic,
  type AgentInputBlock,
  type AgentInterrupt,
  type AgentSnapshot,
  type AgentUsage,
  type AgentUsageEntry,
  type PlainValue,
  type StateDeclaration,
  type ToolCall,
  type ToolContract,
} from '@threadplane/core';
import { projectSubagents, type SessionSubagent } from './child-projection.js';
import type { OwnedInterrupt } from './decision.js';
import { NO_STATE, ownState } from './state.js';
import {
  projectMessages,
  projectStreamingToolCalls,
  projectToolCalls,
} from './message-projection.js';
import { failedWithRunError, type Observation } from './session-observation.js';
import { PROTECTED_COPY } from './session-instruments.js';

/**
 * What an AG-UI session publishes: the core snapshot, with the protocol
 * evidence behind it. `state` is the typed state; the literal document a
 * request sends is not published.
 */
export type SessionSnapshot<TState = unknown> = Omit<
  Observation,
  'state' | 'subagents' | 'clientToolCatalog'
> &
  Omit<
    AgentSnapshot<Record<string, ToolContract>, TState>,
    'interrupts' | 'subagents'
  > & {
    /**
     * What a paused run waits on, each with the protocol's own fields. Listed
     * from the pause until an answer is sent, and absent otherwise; a pause
     * this session cannot answer lists nothing. The core `value` is what the
     * backend sent with the pause: a notice's value, or the protocol
     * interrupt's `metadata`.
     */
    readonly interrupts?: readonly SessionInterrupt[];
    /**
     * Every child agent the session knows, each with its own messages and
     * tool calls and the protocol evidence it was read from: children of
     * earlier root runs first, marked `earlier`, then the current run's.
     * `earlierSubagents` still holds the earlier children's bare evidence.
     */
    readonly subagents: readonly SessionSubagent[];
    /**
     * Why the session's state schema rejected the current state document.
     * `state` then keeps the last document that passed. Absent while the
     * document passes, and always absent without a schema.
     */
    readonly stateIssues?: readonly string[];
    /**
     * Why `submit` is refused right now, for a view that disables its input.
     * Absent when a submission would be admitted. A run in progress is not a
     * reason here: read `status` for that.
     */
    readonly inputBlocked?: SessionInputBlock;
  };

/**
 * Why a session refuses `submit`:
 *
 * - `hydrating`: the saved thread is still loading; commands wait for it.
 * - `checking`: a status check is asking the backend what became of a run.
 * - `storage`: the thread could not be loaded or saved; reconcile first.
 * - `decision`: a decision is waiting, being answered, or left uncertain.
 * - `client-tools`: the client-tool ledger has a blocker installed.
 */
export type InputBlock =
  | 'hydrating'
  | 'checking'
  | 'storage'
  | 'decision'
  | 'client-tools';

/** The core contract's input block, with this session's own reasons. */
export interface SessionInputBlock extends AgentInputBlock {
  readonly reason: InputBlock;
}
const blocks = Object.freeze({
  hydrating: Object.freeze({ reason: 'hydrating' }),
  checking: Object.freeze({ reason: 'checking' }),
  storage: Object.freeze({ reason: 'storage' }),
  decision: Object.freeze({ reason: 'decision' }),
  'client-tools': Object.freeze({ reason: 'client-tools' }),
}) satisfies Record<InputBlock, SessionInputBlock>;

/** A pending interrupt: the core interrupt, with the protocol's own fields. */
export type SessionInterrupt = AgentInterrupt & OwnedInterrupt;

const valued = new WeakMap<
  readonly OwnedInterrupt[],
  readonly SessionInterrupt[]
>();

/**
 * The pending interrupts with the core `value`. A `CUSTOM on_interrupt`
 * notice already has one. The protocol's own interrupt has no such field: what
 * a backend sends with it, beside the display fields, is its `metadata`, so
 * that is its `value`. A pause is owned and frozen, so one batch is read once.
 */
function withValues(
  interrupts: readonly OwnedInterrupt[]
): readonly SessionInterrupt[] {
  let known = valued.get(interrupts);
  if (!known) {
    known = interrupts.some(
      (interrupt) =>
        interrupt.value === undefined && interrupt.metadata !== undefined
    )
      ? Object.freeze(
          interrupts.map((interrupt) =>
            interrupt.value === undefined && interrupt.metadata !== undefined
              ? Object.freeze({
                  ...interrupt,
                  value: interrupt.metadata as PlainValue,
                })
              : interrupt
          )
        )
      : interrupts;
    valued.set(interrupts, known);
  }
  return known;
}

/** The state to publish for one state document, and why a schema rejected it. */
interface StateView {
  readonly source: PlainValue;
  readonly state?: PlainValue;
  readonly issues?: readonly string[];
}
const NOT_PLAIN = Object.freeze(['The state schema must produce plain data.']);

/**
 * Checks each state document once. A session created without a state reports
 * none until the application or the backend supplies one, so a schema is not
 * asked about a document nobody wrote.
 */
function stateReader(declaration: StateDeclaration | undefined) {
  // Starting at the default document is what leaves it unread.
  let view: StateView = { source: NO_STATE };
  return (source: PlainValue): StateView => {
    if (source === view.source) return view;
    const reading = readState(declaration, source);
    if (!reading.valid)
      return (view = {
        source,
        state: view.state,
        issues: Object.freeze([...reading.issues]),
      });
    // A schema may hand back the document itself or a value of its own.
    if (reading.value === source) return (view = { source, state: source });
    try {
      const state = ownState(reading.value);
      // `undefined` would read as no state at all.
      if (state !== undefined) return (view = { source, state });
    } catch {
      /* Reported below. */
    }
    return (view = { source, state: view.state, issues: NOT_PLAIN });
  };
}

/**
 * The same wording the LangGraph runtime uses when it cannot tell whether a
 * request completed. A runtime spec fails when the two drift.
 */
export const INTERRUPTED_COPY = Object.freeze({
  message:
    'The connection dropped. We could not confirm whether the request completed.',
  detail: 'Trying again could repeat it.',
});
/**
 * Shown for a stream that closed before it produced any event, when the
 * request is one `retry` can send again. The LangGraph runtime keeps the same
 * wording for its `retry` recovery; a runtime spec fails when the two drift.
 */
export const UNANSWERED_COPY =
  'The response was interrupted before it started. Try again.';
const FAILED = 'The agent request failed.';
/** Shown when a request got no response, such as an unreachable host. */
export const CONNECTION_COPY =
  "Can't reach the server. Check your connection and try again.";
/** What each failed run was classified from; see `noteFailure`. */
const diagnostics = new WeakMap<object, AgentErrorDiagnostic>();
/**
 * How a `fetch` that got no response names its failure: the browsers' own
 * wording, and the codes Node puts on the failure's cause.
 */
const NO_RESPONSE =
  /failed to fetch|networkerror|econnrefused|enotfound|network request failed|load failed/i;

/** True when what a run failed with says its request got no response. */
function gotNoResponse(diagnostic: AgentErrorDiagnostic | undefined): boolean {
  for (
    let at = diagnostic, depth = 0;
    at && depth < 4;
    at = at.cause, depth++
  )
    if (NO_RESPONSE.test(`${at.name ?? ''} ${at.message} ${at.code ?? ''}`))
      return true;
  return false;
}
/** Shown when the saved thread could not be read or written. */
export const STORAGE_COPY =
  'The saved conversation could not be read or written.';
const STORAGE_ERROR: AgentError = Object.freeze({
  kind: 'server',
  message: STORAGE_COPY,
  retryable: false,
  recovery: 'none',
  detail: 'Reconcile the thread before sending another request.',
});
/** The same wording the LangGraph runtime uses for a rejected credential. */
export const AUTH_COPY = 'Authentication failed. Check your credentials.';

/**
 * The native snapshot keeps the run's outcome, its terminal event and the HTTP
 * status of a response that was not OK. So a failure is the backend's own
 * `RUN_ERROR` text, a stream that ended without a terminal, a rejected
 * credential (401 or 403), another HTTP status, a request that got no response
 * (read from what the run failed with, which a protected session does not
 * keep), or a request that failed for a reason this view cannot name.
 */
function failure(
  native: Observation,
  retryable: boolean,
  canCheck: boolean,
  protect: boolean,
  previous?: AgentError
): AgentError {
  if (native.hold === 'storage')
    return previous?.message === STORAGE_COPY ? previous : STORAGE_ERROR;
  const terminal = native.run?.terminal;
  const reported =
    terminal?.type === 'RUN_ERROR' && 'message' in terminal
      ? terminal.message
      : undefined;
  const interrupted =
    reported === undefined && native.run?.outcome === 'interrupted';
  const status =
    reported === undefined ? native.run?.failure?.status : undefined;
  // A protected session shows one message for whatever a server described.
  const auth = !protect && (status === 401 || status === 403);
  const unreachable =
    !protect &&
    !interrupted &&
    reported === undefined &&
    status === undefined &&
    native.run !== undefined &&
    gotNoResponse(diagnostics.get(native.run));
  const kind = interrupted
    ? 'interrupted'
    : auth
    ? 'auth'
    : unreachable
    ? 'connection'
    : 'server';
  // An interruption is retryable in one case: the stream closed before any
  // event, for a request the owner can send again.
  const unanswered = interrupted && retryable;
  const message = unanswered
    ? UNANSWERED_COPY
    : interrupted
    ? INTERRUPTED_COPY.message
    : auth
    ? AUTH_COPY
    : protect
    ? PROTECTED_COPY
    : unreachable
    ? CONNECTION_COPY
    : reported || FAILED;
  const detail =
    interrupted && !unanswered ? INTERRUPTED_COPY.detail : undefined;
  // `retryable` is the owner's word: the backend's own RUN_ERROR settled what
  // happened, the request provably never left, or its stream closed before
  // any event. Any other failure leaves open whether the request did its
  // work, so sending it again could repeat it.
  // An answer that was sent and not proven taken can be asked about, when the
  // application configured a reconciler to ask.
  const recovery = retryable
    ? 'retry'
    : canCheck &&
      native.decision?.kind === 'native' &&
      native.decision.attempt &&
      native.run?.outcome !== undefined
    ? 'check'
    : 'none';
  if (
    previous &&
    previous.kind === kind &&
    previous.message === message &&
    previous.detail === detail &&
    previous.status === status &&
    previous.retryable === retryable &&
    previous.recovery === recovery
  )
    return previous;
  return Object.freeze({
    kind,
    message,
    ...(status !== undefined && { status }),
    retryable,
    recovery,
    ...(detail !== undefined && { detail }),
  });
}

const USAGE_COUNTS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
] as const;
const usageViews = new WeakMap<object, AgentUsage | null>();

/**
 * The `usage` a settled run's `RUN_FINISHED` or `RUN_ERROR` carried, one entry
 * per provider and model. Only labels and finite counts are read. The terminal
 * is owned and frozen, so one terminal always yields the same projection.
 */
function usage(native: Observation): AgentUsage | undefined {
  if (native.status === 'running') return undefined;
  const terminal = native.run?.terminal;
  if (!terminal || terminal.type === 'CUSTOM') return undefined;
  const reported: unknown = terminal.usage;
  if (!Array.isArray(reported)) return undefined;
  const known = usageViews.get(reported);
  if (known !== undefined) return known ?? undefined;
  const entries: AgentUsageEntry[] = [];
  for (const raw of reported as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const entry: Record<string, string | number> = {};
    for (const label of ['provider', 'model'] as const)
      if (typeof record[label] === 'string') entry[label] = record[label];
    for (const count of USAGE_COUNTS) {
      const value = record[count];
      if (typeof value === 'number' && Number.isFinite(value))
        entry[count] = value;
    }
    entries.push(Object.freeze(entry) as AgentUsageEntry);
  }
  const projected = entries.length
    ? Object.freeze({ entries: Object.freeze(entries) })
    : null;
  usageViews.set(reported, projected);
  return projected ?? undefined;
}

/**
 * Records what a failed run was classified from, for the `errorDiagnostic` a
 * snapshot publishes beside its `error`. Keyed by the observation's own `run`
 * evidence, so it is neither saved with a thread nor sent anywhere.
 */
export function noteFailure(
  run: NonNullable<Observation['run']>,
  diagnostic: AgentErrorDiagnostic
): void {
  diagnostics.set(run, diagnostic);
}

const noPending: readonly ToolCall[] = Object.freeze([]);

/**
 * The calls to declared client tools that wait for a result: none while a run
 * is going, then every pending call whose tool is in the catalog. When the
 * run's `RUN_FINISHED` names `pendingToolCallIds`, only those are listed.
 */
function pendingClientTools(
  native: Observation,
  toolCalls: readonly ToolCall[],
  previous: readonly ToolCall[] = noPending
): readonly ToolCall[] {
  const catalog = native.clientToolCatalog ?? [];
  if (native.status === 'running' || !catalog.length || !toolCalls.length)
    return previous.length ? noPending : previous;
  const terminal = native.run?.terminal;
  const declared =
    terminal?.type === 'RUN_FINISHED'
      ? (terminal.outcome as { pendingToolCallIds?: unknown } | undefined)
          ?.pendingToolCallIds
      : undefined;
  const named = Array.isArray(declared) ? new Set(declared) : undefined;
  const pending = toolCalls.filter(
    (call) =>
      call.status === 'pending' &&
      catalog.includes(call.name) &&
      (!named || named.has(call.id))
  );
  return pending.length === previous.length &&
    pending.every((call, index) => call === previous[index])
    ? previous
    : Object.freeze(pending);
}

function project(
  native: Observation,
  canRetry: boolean,
  canCheck: boolean,
  protect: boolean,
  view: StateView,
  previous?: SessionSnapshot
): SessionSnapshot {
  const messages = projectMessages(native, previous?.messages);
  const toolCalls = projectToolCalls(native, previous?.toolCalls);
  const error =
    native.status === 'error'
      ? failure(native, canRetry, canCheck, protect, previous?.error)
      : undefined;
  const used = usage(native);
  const diagnostic =
    error && !protect && native.run ? diagnostics.get(native.run) : undefined;
  const streaming = projectStreamingToolCalls(
    native,
    previous?.streamingToolCalls
  );
  const {
    state: _document,
    subagents: _children,
    clientToolCatalog: catalog,
    ...evidence
  } = native;
  const decision = native.decision;
  const interrupts =
    decision?.kind === 'native' && !decision.attempt
      ? withValues(decision.interrupts)
      : undefined;
  const blocked: InputBlock | undefined =
    native.hold ??
    (decision
      ? 'decision'
      : (native as { clientTools?: { blocker?: unknown } }).clientTools?.blocker
      ? 'client-tools'
      : undefined);
  return Object.freeze({
    ...evidence,
    messages,
    toolCalls,
    subagents: projectSubagents(native, previous?.subagents),
    // One object per reason, so an unchanged block keeps its reference.
    ...(blocked && { inputBlocked: blocks[blocked] }),
    ...(interrupts && { interrupts }),
    ...(error && { error }),
    ...(diagnostic && { errorDiagnostic: diagnostic }),
    ...(streaming.length > 0 && { streamingToolCalls: streaming }),
    // Present, and possibly empty, on a session with the capability.
    ...(catalog && {
      pendingClientTools: pendingClientTools(
        native,
        toolCalls,
        previous?.pendingClientTools
      ),
    }),
    ...(used && { usage: used }),
    ...(view.state !== undefined && { state: view.state }),
    ...(view.issues && { stateIssues: view.issues }),
  });
}

/**
 * Builds the snapshot a session publishes from each observation. Messages,
 * tool calls, the error, usage and state keep their references until they
 * change, and one observation always yields the same snapshot.
 *
 * `state` is the session's state document, typed by its `stateType`. With a
 * schema, each document is checked once and `state` holds the schema's output;
 * a rejected document leaves `state` at the last one that passed and lists the
 * reasons in `stateIssues`, and the run goes on. A session created without a
 * state has none until the application submits one or the backend reports one.
 */
export function createPresenter(
  declaration: StateDeclaration | undefined,
  canRetry: boolean | ((observation: Observation) => boolean),
  canCheck = false,
  protect = false
): (observation: Observation) => SessionSnapshot {
  const readView = stateReader(declaration);
  let seen: Observation | undefined;
  let current: SessionSnapshot | undefined;
  return (observation) => {
    if (observation !== seen || !current) {
      current = project(
        observation,
        typeof canRetry === 'function'
          ? canRetry(observation)
          : canRetry && failedWithRunError(observation),
        canCheck,
        protect,
        readView(observation.state),
        current
      );
      seen = observation;
    }
    return current;
  };
}

/** Why `retry` rejects after a failure that leaves the backend outcome open. */
export const UNSAFE_RETRY =
  'This failure cannot be retried: the backend may already have done the work.';
