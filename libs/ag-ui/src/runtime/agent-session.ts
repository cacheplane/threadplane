import type {
  AgentError,
  AgentSession,
  AgentSnapshot,
} from '@threadplane/core';
import type { Session } from './create-session.js';
import { projectMessages, projectToolCalls } from './message-projection.js';
import type { SessionSnapshot } from './session-observation.js';

/** The native owner, with or without a client-tool catalog. */
export type NativeSession = Pick<
  Session,
  'subscribe' | 'submit' | 'stop' | 'dispose'
> & { getSnapshot(): SessionSnapshot };

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
function failure(native: SessionSnapshot, previous?: AgentError): AgentError {
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
  if (
    previous &&
    previous.kind === kind &&
    previous.message === message &&
    previous.detail === detail &&
    previous.status === status
  )
    return previous;
  return Object.freeze({
    kind,
    message,
    ...(status !== undefined && { status }),
    // Nothing here proves the request never reached the backend, so sending it
    // again could repeat work. The native owner has no status check either.
    retryable: false,
    recovery: 'none',
    ...(detail !== undefined && { detail }),
  });
}

function project(
  native: SessionSnapshot,
  previous?: AgentSnapshot
): AgentSnapshot {
  const messages = projectMessages(native, previous?.messages);
  const toolCalls = projectToolCalls(native, previous?.toolCalls);
  const error =
    native.status === 'error' ? failure(native, previous?.error) : undefined;
  if (
    previous &&
    previous.status === native.status &&
    previous.messages === messages &&
    previous.toolCalls === toolCalls &&
    previous.error === error &&
    previous.plan === native.plan
  )
    return previous;
  return Object.freeze({
    status: native.status,
    messages,
    toolCalls,
    ...(error && { error }),
    ...(native.plan && { plan: native.plan }),
  });
}

/**
 * A core `AgentSession` view of a native AG-UI session, so components written
 * for core sessions can observe and drive it.
 *
 * It is a view, not a second owner. The snapshot is derived from the native
 * snapshot on read and keeps its reference until something a core observer can
 * see changes; subscribers are told about those changes only. `submit`, `stop`
 * and `dispose` go straight to the native session, so disposing the view
 * disposes the session. Application state, native resume and client-tool
 * evidence have no core equivalent: keep the native session for those.
 */
export function createAgentSession(session: NativeSession): AgentSession {
  let seen: SessionSnapshot | undefined;
  let current: AgentSnapshot | undefined;
  const getSnapshot = (): AgentSnapshot => {
    const native = session.getSnapshot();
    if (native !== seen || !current) {
      current = project(native, current);
      seen = native;
    }
    return current;
  };
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
    submit: (input, options) => session.submit(input, options),
    stop: () => session.stop(),
    dispose: () => session.dispose(),
  };
}
