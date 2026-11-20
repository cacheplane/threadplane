import {
  readState,
  type AgentError,
  type AgentInterrupt,
  type AgentSnapshot,
  type AgentUsage,
  type AgentUsageEntry,
  type PlainValue,
  type StateDeclaration,
  type ToolContract,
} from '@threadplane/core';
import { projectSubagents, type SessionSubagent } from './child-projection.js';
import type { OwnedInterrupt } from './decision.js';
import { NO_STATE, ownState } from './state.js';
import { projectMessages, projectToolCalls } from './message-projection.js';
import { failedWithRunError, type Observation } from './session-observation.js';

type Tools = Record<string, ToolContract>;
/**
 * What an AG-UI session publishes: the core snapshot, with the protocol
 * evidence behind it. `state` is the typed state; the literal document a
 * request sends is not published.
 */
export type SessionSnapshot<TState = unknown> = Omit<
  Observation,
  'state' | 'subagents'
> &
  Omit<AgentSnapshot<Tools, TState>, 'interrupts' | 'subagents'> & {
    /**
     * What a paused run waits on, each with the protocol's own fields. Listed
     * from the pause until an answer is sent, and absent otherwise; a pause
     * this session cannot answer lists nothing.
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
  };

/** A pending interrupt: the core interrupt, with the protocol's own fields. */
export type SessionInterrupt = AgentInterrupt & OwnedInterrupt;

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
const FAILED = 'The agent request failed.';
/** The same wording the LangGraph runtime uses for a rejected credential. */
export const AUTH_COPY = 'Authentication failed. Check your credentials.';

/**
 * The native snapshot keeps the run's outcome, its terminal event and the HTTP
 * status of a response that was not OK. So a failure is the backend's own
 * `RUN_ERROR` text, a stream that ended without a terminal, a rejected
 * credential (401 or 403), another HTTP status, or a request that failed for a
 * reason this view cannot name, such as a host that could not be reached.
 */
function failure(
  native: Observation,
  canRetry: boolean,
  previous?: AgentError
): AgentError {
  const terminal = native.run?.terminal;
  const reported =
    terminal?.type === 'RUN_ERROR' && 'message' in terminal
      ? terminal.message
      : undefined;
  const interrupted =
    reported === undefined && native.run?.outcome === 'interrupted';
  const status =
    reported === undefined ? native.run?.failure?.status : undefined;
  const auth = status === 401 || status === 403;
  const kind = interrupted ? 'interrupted' : auth ? 'auth' : 'server';
  const message = interrupted
    ? INTERRUPTED_COPY.message
    : auth
    ? AUTH_COPY
    : reported || FAILED;
  const detail = interrupted ? INTERRUPTED_COPY.detail : undefined;
  // Only the backend's own RUN_ERROR settles what happened. Any other failure
  // leaves open whether the request did its work, so sending it again could
  // repeat it, and the native owner has no status check to find out.
  const retryable = canRetry && failedWithRunError(native);
  if (
    previous &&
    previous.kind === kind &&
    previous.message === message &&
    previous.detail === detail &&
    previous.status === status &&
    previous.retryable === retryable
  )
    return previous;
  return Object.freeze({
    kind,
    message,
    ...(status !== undefined && { status }),
    retryable,
    recovery: retryable ? 'retry' : 'none',
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

function project(
  native: Observation,
  canRetry: boolean,
  view: StateView,
  previous?: SessionSnapshot
): SessionSnapshot {
  const messages = projectMessages(native, previous?.messages);
  const toolCalls = projectToolCalls(native, previous?.toolCalls);
  const error =
    native.status === 'error'
      ? failure(native, canRetry, previous?.error)
      : undefined;
  const used = usage(native);
  const { state: _document, subagents: _children, ...evidence } = native;
  const decision = native.decision;
  const interrupts =
    decision?.kind === 'native' && !decision.attempt
      ? decision.interrupts
      : undefined;
  return Object.freeze({
    ...evidence,
    messages,
    toolCalls,
    subagents: projectSubagents(native, previous?.subagents),
    ...(interrupts && { interrupts }),
    ...(error && { error }),
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
  canRetry: boolean
): (observation: Observation) => SessionSnapshot {
  const readView = stateReader(declaration);
  let seen: Observation | undefined;
  let current: SessionSnapshot | undefined;
  return (observation) => {
    if (observation !== seen || !current) {
      current = project(
        observation,
        canRetry,
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
