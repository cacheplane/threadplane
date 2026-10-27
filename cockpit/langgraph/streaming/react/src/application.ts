import type { AgentSession, CompleteOutcome } from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

export interface StreamingSnapshot {
  readonly creation: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
  readonly rows: readonly MessageRow[];
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
}

/** Owns one conversation. An uncertain operation is never replayed implicitly. */
export function createStreamingApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (threadId: string) => AgentSession;
}) {
  const content = createMessageContent();
  const listeners = new Set<() => void>();
  let snapshot: StreamingSnapshot = Object.freeze({
    creation: 'idle',
    rows: Object.freeze([]),
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
  });
  let session: AgentSession | undefined;
  let release: (() => void) | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;

  function publish(update: Partial<StreamingSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }

  async function submit(text: string) {
    if (disposed || !snapshot.canSubmit || snapshot.busy || !text.trim())
      return;
    const admitted = new AbortController();
    operation = admitted;
    publish({ busy: true, canSubmit: false, outcome: null, error: null });
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    try {
      if (!session) {
        publish({ creation: 'pending' });
        const threadId = await options.createThread(admitted.signal);
        if (!current()) return;
        session = options.sessionFactory(threadId);
        release = session.subscribe(() => {
          if (!disposed && session)
            publish({ rows: content.project(session.getSnapshot()) });
        });
        publish({
          creation: 'confirmed',
          rows: content.project(session.getSnapshot()),
        });
      }
      const outcome = await session.submit(text, { signal: admitted.signal });
      if (!current()) return;
      publish({
        rows: content.project(session.getSnapshot()),
        outcome,
        canSubmit: outcome === 'success',
        error: outcome === 'error' ? 'The LangGraph request failed.' : null,
      });
    } catch {
      if (!current()) return;
      publish({
        creation: session ? 'confirmed' : 'unconfirmed',
        canSubmit: false,
        outcome: 'error',
        error: 'The LangGraph request failed.',
      });
    } finally {
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false });
      }
    }
  }

  async function stop() {
    const admitted = operation;
    if (disposed || !admitted) return;
    admitted.abort();
    operation = undefined;
    publish({
      busy: false,
      canSubmit: false,
      outcome: 'aborted',
      creation: session ? 'confirmed' : 'unconfirmed',
    });
    await session?.stop();
  }

  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    release?.();
    content.dispose();
    listeners.clear();
    disposal = Promise.resolve(session?.dispose()).then(() => undefined);
    return disposal;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit,
    stop,
    dispose,
  };
}
