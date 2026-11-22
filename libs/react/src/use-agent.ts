'use client';

import type { AgentSnapshot } from '@threadplane/core';
import { useCallback, useSyncExternalStore } from 'react';
import { useOptionalAgentSession } from './agent-provider.js';

interface ObservableSession<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}

/** Observe the session of the nearest `AgentProvider`. */
export function useAgent<TSnapshot = AgentSnapshot>(): TSnapshot;
/** Observe an app-owned session. Unmount releases only this subscription. */
export function useAgent<TSnapshot>(
  session: ObservableSession<TSnapshot>
): TSnapshot;
export function useAgent<TSnapshot>(
  session?: ObservableSession<TSnapshot>
): TSnapshot {
  // Always read, so the hook order is the same with or without a session.
  const provided = useOptionalAgentSession() as unknown as
    | ObservableSession<TSnapshot>
    | null;
  const target = session ?? provided;
  if (!target)
    throw new Error(
      'useAgent() needs a session, or an <AgentProvider> above it.'
    );
  const getSnapshot = useCallback(() => target.getSnapshot(), [target]);
  const subscribe = useCallback(
    (notify: () => void) => target.subscribe(notify),
    [target]
  );
  // A session does no I/O until it is used, so its current snapshot is also the server snapshot.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
