import type { AgentError, AgentErrorKind } from '@threadplane/core';

/**
 * When a session first saw each milestone, in epoch milliseconds on this
 * clock. Every value is null until its milestone happens. A session serves one
 * thread, so nothing is ever reset: a later session starts again from null.
 * Nothing here is stored or sent.
 */
export interface LangGraphLifecycle {
  /** The first event to arrive on any run's stream. */
  readonly streamStartedAt: number | null;
  /** The most recent failure the session published, with its error kind. */
  readonly streamErrorAt: {
    readonly at: number;
    readonly kind: AgentErrorKind;
  } | null;
  /** The first time the session held a pending interrupt. */
  readonly interruptReceivedAt: number | null;
  /** The most recent `resume` the session accepted. */
  readonly interruptResolvedAt: number | null;
  /** The first history read that returned saved checkpoints for the thread. */
  readonly threadPersistedAt: number | null;
  /** The first time the session held a tool call, streamed or saved. */
  readonly toolCallStartedAt: number | null;
  /** The first time a tool call was complete or failed. */
  readonly toolCallCompletedAt: number | null;
}

/** An observable `LangGraphLifecycle`; `useAgent` and `useSyncExternalStore` accept it. */
export interface LangGraphLifecycleSource {
  getSnapshot(): LangGraphLifecycle;
  subscribe(notify: () => void): () => void;
}

type Mark = 'streamStartedAt' | 'interruptResolvedAt' | 'threadPersistedAt';

interface Published {
  readonly error?: AgentError;
  readonly interrupts: readonly unknown[];
  readonly toolCalls: readonly { readonly status: string }[];
}

/**
 * Records lifecycle milestones for one session. The session marks what only it
 * can know, then calls `observe` with each publication and `flush` after it.
 */
export function createLifecycleRecorder(now: () => number = () => Date.now()) {
  let snapshot: LangGraphLifecycle = Object.freeze({
    streamStartedAt: null,
    streamErrorAt: null,
    interruptReceivedAt: null,
    interruptResolvedAt: null,
    threadPersistedAt: null,
    toolCallStartedAt: null,
    toolCallCompletedAt: null,
  });
  const listeners = new Set<{ notify: () => void }>();
  let dirty = false;
  let failure: string | undefined;

  function set(next: Partial<LangGraphLifecycle>) {
    snapshot = Object.freeze({ ...snapshot, ...next });
    dirty = true;
  }

  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(notify: () => void) {
        const listener = { notify };
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } satisfies LangGraphLifecycleSource,
    /** `interruptResolvedAt` keeps the latest; the other two keep the first. */
    mark(milestone: Mark) {
      if (milestone !== 'interruptResolvedAt' && snapshot[milestone] !== null)
        return;
      set({ [milestone]: now() });
    },
    observe(published: Published) {
      const error = published.error;
      const key = error && `${error.kind}\n${error.message}`;
      // The same failure published again is not another failure.
      if (error && key !== failure)
        set({ streamErrorAt: Object.freeze({ at: now(), kind: error.kind }) });
      failure = key;
      if (snapshot.interruptReceivedAt === null && published.interrupts.length)
        set({ interruptReceivedAt: now() });
      if (snapshot.toolCallStartedAt === null && published.toolCalls.length)
        set({ toolCallStartedAt: now() });
      if (
        snapshot.toolCallCompletedAt === null &&
        published.toolCalls.some(
          (call) => call.status === 'complete' || call.status === 'error'
        )
      )
        set({ toolCallCompletedAt: now() });
    },
    /** Tells listeners once about everything recorded since the last call. */
    flush() {
      if (!dirty) return;
      dirty = false;
      for (const listener of [...listeners]) {
        // A listener can release another, or dispose the session, mid-pass.
        if (!listeners.has(listener)) continue;
        try {
          listener.notify();
        } catch {
          /* A listener failure never changes execution state. */
        }
      }
    },
    clearListeners: () => listeners.clear(),
  };
}
