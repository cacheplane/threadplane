'use client';
import { createContext, useContext, useSyncExternalStore } from 'react';

/** Readiness and composer submissions of one `Chat`. */
export interface ChatLifecycle {
  /** True once the `Chat` has mounted. */
  readonly componentReady: boolean;
  /**
   * True after the first message sent from the composer, or once a run is seen
   * running, which covers a message the app sent itself, such as a welcome
   * suggestion. It stays true for the life of the `Chat`, across sessions.
   */
  readonly firstMessageSent: boolean;
  /** Messages sent from the composer. Starts again at 0 when `session` changes. */
  readonly messageCount: number;
  /** Epoch milliseconds of the latest composer submit. Null again when `session` changes. */
  readonly inputSubmittedAt: number | null;
}

export interface ChatLifecycleStore {
  readonly getSnapshot: () => ChatLifecycle;
  readonly subscribe: (notify: () => void) => () => void;
  /** Publishes only when a value differs. */
  readonly set: (next: Partial<ChatLifecycle>) => void;
}

/** Holds the values outside React state, so only components that read them render again. */
export function createChatLifecycleStore(
  onChange: (lifecycle: ChatLifecycle) => void
): ChatLifecycleStore {
  let snapshot: ChatLifecycle = Object.freeze({
    componentReady: false,
    firstMessageSent: false,
    messageCount: 0,
    inputSubmittedAt: null,
  });
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    set(next) {
      const keys = Object.keys(next) as (keyof ChatLifecycle)[];
      if (keys.every((key) => next[key] === snapshot[key])) return;
      snapshot = Object.freeze({ ...snapshot, ...next });
      for (const notify of [...listeners]) notify();
      onChange(snapshot);
    },
  };
}

export const ChatLifecycleContext = createContext<ChatLifecycleStore | null>(
  null
);

const nothing = () => () => undefined;
const absent = () => null;

/**
 * The lifecycle of the `Chat` this component is rendered inside, such as from
 * its `header`, `welcome` or composer slots. Null outside a `Chat`; there, use
 * the `onLifecycleChange` prop of `Chat` instead.
 */
export function useChatLifecycle(): ChatLifecycle | null {
  const store = useContext(ChatLifecycleContext);
  return useSyncExternalStore(
    store?.subscribe ?? nothing,
    store?.getSnapshot ?? absent,
    store?.getSnapshot ?? absent
  );
}
