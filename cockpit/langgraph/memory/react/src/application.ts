import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

export interface MemorySession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly values?: unknown;
    readonly interrupts: readonly { readonly value?: unknown }[];
  };
}
export interface MemoryFact {
  readonly key: string;
  readonly value: string;
}
export interface MemorySnapshot {
  readonly creation: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
  readonly rows: readonly MessageRow[];
  readonly facts: readonly MemoryFact[];
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function projectFacts(
  values: unknown,
  previous: readonly MemoryFact[]
): readonly MemoryFact[] {
  const field =
    plainRecord(values) && Object.getOwnPropertyDescriptor(values, 'memory');
  const memory =
    field && Object.hasOwn(field, 'value') ? field.value : undefined;
  const facts: MemoryFact[] = [];
  if (plainRecord(memory)) {
    for (const key of Object.keys(memory)) {
      const entry = Object.getOwnPropertyDescriptor(memory, key);
      if (
        entry &&
        Object.hasOwn(entry, 'value') &&
        typeof entry.value === 'string'
      ) {
        facts.push(Object.freeze({ key, value: entry.value }));
      }
    }
  }
  if (
    facts.length === previous.length &&
    facts.every(
      (fact, index) =>
        fact.key === previous[index].key && fact.value === previous[index].value
    )
  )
    return previous;
  return Object.freeze(facts);
}

/** Owns one confirmed thread; facts reflect authoritative backend state. */
export function createMemoryApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (threadId: string) => MemorySession;
}) {
  const content = createMessageContent();
  const listeners = new Set<() => void>();
  let snapshot: MemorySnapshot = Object.freeze({
    creation: 'idle',
    rows: Object.freeze([]),
    facts: Object.freeze([]),
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
  });
  let session: MemorySession | undefined;
  let release: (() => void) | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  function publish(update: Partial<MemorySnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function projection() {
    if (!session) return {};
    const state = session.getSnapshot();
    return {
      rows: content.project(state),
      facts: projectFacts(state.values, snapshot.facts),
    };
  }
  function observe() {
    if (disposed || !session) return;
    publish({
      ...projection(),
      ...(session.getSnapshot().interrupts.length ? { canSubmit: false } : {}),
    });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    // Recheck the borrowed backend snapshot even if a notification was missed.
    if (session?.getSnapshot().interrupts.length) {
      observe();
      return;
    }
    const admitted = new AbortController();
    operation = admitted;
    publish({ busy: true, canSubmit: false, outcome: null, error: null });
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    try {
      if (!current()) return;
      if (!session) {
        publish({ creation: 'pending' });
        if (!current()) return;
        const threadId = await options.createThread(admitted.signal);
        if (!current()) return;
        session = options.sessionFactory(threadId);
        release = session.subscribe(observe);
        publish({ creation: 'confirmed', ...projection() });
      }
      if (!current()) return;
      if (session.getSnapshot().interrupts.length) {
        publish({ ...projection(), outcome: 'paused', canSubmit: false });
        return;
      }
      const outcome = await session.submit(text, { signal: admitted.signal });
      if (!current()) return;
      publish({
        ...projection(),
        outcome,
        canSubmit:
          outcome === 'success' &&
          session.getSnapshot().interrupts.length === 0,
        error: outcome === 'error' ? 'The LangGraph request failed.' : null,
      });
    } catch {
      if (!current()) return;
      publish({
        creation: session ? 'confirmed' : 'unconfirmed',
        outcome: 'error',
        canSubmit: false,
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
    try {
      await session?.stop();
    } catch {
      /* Recovery requires a new conversation. */
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    release?.();
    content.dispose();
    listeners.clear();
    disposal = Promise.resolve()
      .then(() => session?.dispose())
      .then(() => undefined);
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
