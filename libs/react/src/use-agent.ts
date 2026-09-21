'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type {
  AgentSession,
  AgentSnapshot,
  ToolContract,
} from '@threadplane/core';

/** Observe an app-owned session. Unmount releases only this subscription. */
export function useAgent<TTools extends { [K in keyof TTools]: ToolContract }>(
  session: AgentSession<TTools>
): AgentSnapshot<TTools> {
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const subscribe = useCallback(
    (notify: () => void) => session.subscribe(notify),
    [session]
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
