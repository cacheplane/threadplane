import {
  readState,
  type AgentError,
  type AgentSession,
  type AgentSessionCustomEvent,
  type AgentSnapshot,
  type AgentSubmitOptions,
  type AgentUsage,
  type AgentUsageEntry,
  type PlainValue,
  type StateDeclaration,
  type ToolContract,
} from '@threadplane/core';
import type { Session } from './create-session.js';
import { NO_STATE, ownState } from './state.js';
import type { SubmitInput } from './submit-input.js';
import { projectMessages, projectToolCalls } from './message-projection.js';
import {
  failedWithRunError,
  type SessionSnapshot,
} from './session-observation.js';

/** The native owner, with or without a client-tool catalog. */
export type NativeSession<TState = unknown> = Pick<
  Session<TState>,
  | 'stateType'
  | 'subscribe'
  | 'submit'
  | 'stop'
  | 'dispose'
  | 'retry'
  | 'regenerate'
  | 'onCustomEvent'
> & { getSnapshot(): SessionSnapshot };

type Tools = Record<string, ToolContract>;
/** The core snapshot of an AG-UI session, with the outcome of its last state check. */
export type AgUiAgentSnapshot<TState = unknown> = AgentSnapshot<
  Tools,
  TState
> & {
  /**
   * Why the session's state schema rejected the current state document.
   * `state` then keeps the last document that passed. Absent while the
   * document passes, and always absent without a schema.
   */
  readonly stateIssues?: readonly string[];
};
/** A core `AgentSession` over an AG-UI session. */
export type AgUiAgentSession<TState = unknown> = Omit<
  AgentSession<Tools, TState>,
  'getSnapshot'
> & { getSnapshot(): AgUiAgentSnapshot<TState> };

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
  native: SessionSnapshot,
  canRetry: boolean,
  previous?: AgentError
): AgentError {
  const terminal = native.run?.terminal;
  const reported =
    terminal?.type === 'RUN_ERROR' && 'message' in terminal
      ? terminal.message
      : undefined;
  const interrupted = reported === undefined && native.run?.outcome === 'interrupted';
  const status = reported === undefined ? native.run?.failure?.status : undefined;
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
function usage(native: SessionSnapshot): AgentUsage | undefined {
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
  native: SessionSnapshot,
  canRetry: boolean,
  view: StateView,
  previous?: AgUiAgentSnapshot
): AgUiAgentSnapshot {
  const messages = projectMessages(native, previous?.messages);
  const toolCalls = projectToolCalls(native, previous?.toolCalls);
  const error =
    native.status === 'error'
      ? failure(native, canRetry, previous?.error)
      : undefined;
  const used = usage(native);
  if (
    previous &&
    previous.status === native.status &&
    previous.messages === messages &&
    previous.toolCalls === toolCalls &&
    previous.error === error &&
    previous.plan === native.plan &&
    previous.usage === used &&
    previous.state === view.state &&
    previous.stateIssues === view.issues
  )
    return previous;
  return Object.freeze({
    status: native.status,
    messages,
    toolCalls,
    ...(error && { error }),
    ...(native.plan && { plan: native.plan }),
    ...(used && { usage: used }),
    ...(view.state !== undefined && { state: view.state }),
    ...(view.issues && { stateIssues: view.issues }),
  });
}

/**
 * A core `AgentSession` view of a native AG-UI session, so components written
 * for core sessions can observe and drive it.
 *
 * It is a view, not a second owner. The snapshot is derived from the native
 * snapshot on read and keeps its reference until something a core observer can
 * see changes; subscribers are told about those changes only. `submit`, `stop`,
 * `dispose` and, when the native session has them, `retry` and `regenerate`
 * go straight to the native session, so disposing the view disposes the
 * session. `retry` rejects unless the error is `recovery: 'retry'`. Custom
 * event listeners pass straight through to the native session too, when it
 * has them. Native resume and client-tool evidence have no core equivalent:
 * keep the native session for those.
 *
 * `state` is the session's state document, typed by the `stateType` the session
 * was created with. With a schema, each document is checked once and `state`
 * holds the schema's output; a rejected document leaves `state` at the last
 * one that passed and lists the reasons in `stateIssues`, and the run goes on.
 * A session created without a state has none until the application submits
 * one or the backend reports one.
 */
export function createAgentSession<TState = unknown>(
  session: NativeSession<TState>
): AgUiAgentSession<TState> {
  let seen: SessionSnapshot | undefined;
  let current: AgUiAgentSnapshot | undefined;
  const retry = session.retry;
  const regenerate = session.regenerate;
  const listen = session.onCustomEvent;
  const readView = stateReader(session.stateType);
  const read = (): AgUiAgentSnapshot => {
    const native = session.getSnapshot();
    if (native !== seen || !current) {
      current = project(native, !!retry, readView(native.state), current);
      seen = native;
    }
    return current;
  };
  // The declaration is the only evidence of TState, as for any typed session.
  const getSnapshot = read as () => AgUiAgentSnapshot<TState>;
  return {
    getSnapshot,
    subscribe(notify) {
      let last = getSnapshot();
      return session.subscribe(() => {
        const next = getSnapshot();
        if (next === last) return;
        last = next;
        notify();
      });
    },
    // Events are not state, so they pass straight through to the native owner.
    ...(listen && {
      onCustomEvent: (listener: (event: AgentSessionCustomEvent) => void) =>
        listen.call(session, listener),
    }),
    submit: (input, options) =>
      session.submit(input as SubmitInput<TState>, options),
    stop: () => session.stop(),
    dispose: () => session.dispose(),
    // The native owner rejects what it cannot regenerate, as the core
    // contract asks, so the command passes straight through.
    ...(regenerate && {
      regenerate: (messageId: string, options?: AgentSubmitOptions) =>
        regenerate.call(session, messageId, options),
    }),
    ...(retry && {
      async retry() {
        const snapshot = getSnapshot();
        // Nothing failed or a run is going: nothing runs, as for an ignored submit.
        if (snapshot.status !== 'error') return 'aborted' as const;
        if (snapshot.error?.recovery !== 'retry')
          throw new Error(
            'This failure cannot be retried: the backend may already have done the work.'
          );
        return retry.call(session);
      },
    }),
  };
}
