'use client';

import type { AgentSession } from '@threadplane/core';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createSessionHost,
  type AgentSessionFactoryContext,
  type HostedSession,
} from './session-host.js';

export type { AgentSessionFactoryContext } from './session-host.js';

/** What `AgentProvider` takes. */
export interface AgentProviderProps<TSession extends HostedSession> {
  /**
   * Creates the session for one thread, asynchronously, so the backend package
   * can load on demand:
   * `(context) => import('@threadplane/langgraph').then((m) => m.createSession({ ...options, ...context }))`.
   * Called when the provider mounts and again for each `threadId` change. The
   * latest function is used, so an inline arrow is fine.
   */
  readonly createSession: (
    context: AgentSessionFactoryContext
  ) => Promise<TSession>;
  /** The thread to show. A change switches threads. */
  readonly threadId?: string | null;
  /** Called with the id of a thread a session created. */
  readonly onThreadId?: (threadId: string) => void;
  readonly children?: ReactNode;
}

const AgentSessionContext = createContext<AgentSession | null>(null);

/**
 * Owns the agent sessions of its subtree. `useAgentSession()`, `useAgent()`
 * and `<Chat />` inside it read the current session from it.
 *
 * Until the first session resolves, the session shows an empty idle
 * conversation. On a `threadId` change it keeps the current session until the
 * new one resolves, and adopts only the latest change. Commands called
 * meanwhile wait for the new session and run on it; `stop` goes to the current
 * session at once. When the factory rejects, the provider keeps its current
 * session and the waiting commands reject with the same error. Unmounting
 * disposes every session.
 *
 * @example
 * ```tsx
 * <AgentProvider
 *   createSession={(context) =>
 *     import('@threadplane/langgraph').then(({ createSession }) =>
 *       createSession({ apiUrl: '/api', assistantId: 'chat', ...context })
 *     )
 *   }
 * >
 *   <Chat />
 * </AgentProvider>
 * ```
 */
export function AgentProvider<TSession extends HostedSession = AgentSession>(
  props: AgentProviderProps<TSession>
) {
  const latest = useRef(props);
  latest.current = props;
  const [host] = useState(() =>
    createSessionHost<TSession>({
      createSession: () => latest.current.createSession,
      onThreadId: () => latest.current.onThreadId,
    })
  );
  const threadId = props.threadId ?? null;
  // Connected in an effect, not during render, and again after a development
  // remount, so no session is created for a render React discards.
  useEffect(() => {
    host.connect(latest.current.threadId ?? null);
    return () => host.disconnect();
  }, [host]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    host.switchThread(threadId);
  }, [host, threadId]);
  return (
    <AgentSessionContext.Provider
      value={host.session as unknown as AgentSession}
    >
      {props.children}
    </AgentSessionContext.Provider>
  );
}

/**
 * The session of the nearest `AgentProvider`: one stable object that behaves
 * as whichever session is current. Pass it anywhere a session is taken.
 */
export function useAgentSession<
  TSession extends object = AgentSession,
>(): TSession {
  const session = useContext(AgentSessionContext);
  if (!session)
    throw new Error(
      'useAgentSession() needs an <AgentProvider> above it, or pass a session explicitly.'
    );
  return session as unknown as TSession;
}

/** The provider's session, or null outside one. */
export function useOptionalAgentSession(): AgentSession | null {
  return useContext(AgentSessionContext);
}
