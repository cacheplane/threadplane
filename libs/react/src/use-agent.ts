'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { AgentSnapshot } from '@threadplane/core';

/** Observe an app-owned session. Unmount releases only this subscription. */
export function useAgent<TSnapshot extends AgentSnapshot>(session: {
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}): TSnapshot {
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const subscribe = useCallback(
    (notify: () => void) => session.subscribe(notify),
    [session]
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
