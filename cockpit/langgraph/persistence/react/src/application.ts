import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

export interface PersistenceSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly { readonly value?: unknown }[];
  };
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface ConversationEntry {
  readonly id: string;
  readonly label: string;
  readonly availability: 'available' | 'unavailable';
}
export interface PersistenceSnapshot {
  readonly selectedId: string | null;
  readonly conversations: readonly ConversationEntry[];
  readonly rows: readonly MessageRow[];
  readonly activity: 'idle' | 'creating' | 'loading' | 'running' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
/** Owns a page-local picker of confirmed threads and one selected session. */
export function createPersistenceApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => PersistenceSession;
}) {
  type Lifetime = {
    readonly session: PersistenceSession;
    readonly content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
  };
  const listeners = new Set<() => void>();
  const cleanups = new Set<Promise<void>>();
  let snapshot: PersistenceSnapshot = Object.freeze({
    selectedId: null,
    conversations: Object.freeze([]),
    rows: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  let lifetime: Lifetime | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  function publish(update: Partial<PersistenceSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function unavailable(id = snapshot.selectedId) {
    return Object.freeze(
      snapshot.conversations.map((entry) =>
        entry.id === id && entry.availability !== 'unavailable'
          ? Object.freeze({ ...entry, availability: 'unavailable' as const })
          : entry
      )
    );
  }
  function unsafe(state: ReturnType<PersistenceSession['getSnapshot']>) {
    return (
      !!state.error ||
      !!state.interrupts.length ||
      !!state.toolCalls.length ||
      state.messages.some((message) => !!message.toolCallIds?.length)
    );
  }
  function close(selected: Lifetime): Promise<void> {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    selected.release?.();
    selected.content.dispose();
    const cleanup = Promise.resolve()
      .then(() => selected.session.dispose())
      .then(
        () => undefined,
        () => undefined
      );
    cleanups.add(cleanup);
    void cleanup.then(() => cleanups.delete(cleanup));
    return cleanup;
  }
  function detach(): Promise<void> {
    const previous = lifetime;
    lifetime = undefined;
    return previous ? close(previous) : Promise.resolve();
  }
  function observe(selected: Lifetime) {
    const current = () =>
      !disposed &&
      lifetime === selected &&
      !selected.closed &&
      !operation?.signal.aborted;
    if (!current()) return;
    const state = selected.session.getSnapshot();
    if (!current()) return;
    const blocked = unsafe(state);
    if (!current()) return;
    const rows = selected.content.project(state);
    if (!current()) return;
    publish({
      rows,
      ...(blocked ? { canSubmit: false, conversations: unavailable() } : {}),
    });
  }
  function install(id: string, current: () => boolean): Lifetime | undefined {
    const session = options.sessionFactory(id);
    const selected: Lifetime = {
      session,
      content: createMessageContent(),
      closed: false,
    };
    if (!current()) {
      void close(selected);
      return;
    }
    lifetime = selected;
    const release = session.subscribe(() => observe(selected));
    selected.release = release;
    if (selected.closed) release();
    if (!current() || lifetime !== selected) {
      if (!selected.closed) void close(selected);
      return;
    }
    return selected;
  }
  function admit(activity: PersistenceSnapshot['activity']) {
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity,
      outcome: null,
      error: null,
    });
    return { admitted, current };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  function fail() {
    publish({
      canSubmit: false,
      conversations: unavailable(),
      outcome: 'error',
      error: 'The LangGraph request failed.',
    });
  }
  function block() {
    publish({
      canSubmit: false,
      conversations: unavailable(),
      outcome: 'paused',
    });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const previous = lifetime;
    const initiallyBlocked = previous
      ? unsafe(previous.session.getSnapshot())
      : false;
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      lifetime !== previous ||
      previous?.closed
    )
      return;
    if (initiallyBlocked) {
      block();
      return;
    }
    const { admitted, current } = admit(lifetime ? 'running' : 'creating');
    try {
      if (!current()) return;
      if (!lifetime) {
        const id = await options.createThread(admitted.signal);
        if (!current()) return;
        const selected = install(id, current);
        if (!selected || !current()) return;
        const entry = Object.freeze({
          id,
          label: `Conversation ${snapshot.conversations.length + 1}`,
          availability: 'available' as const,
        });
        publish({
          selectedId: id,
          conversations: Object.freeze([...snapshot.conversations, entry]),
          activity: 'running',
        });
      }
      if (!current() || !lifetime) return;
      const selected = lifetime;
      const beforeRun = selected.session.getSnapshot();
      if (!current() || lifetime !== selected) return;
      const blocked = unsafe(beforeRun);
      if (!current() || lifetime !== selected) return;
      if (blocked) {
        block();
        return;
      }
      const outcome = await selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!current() || lifetime !== selected) return;
      const state = selected.session.getSnapshot();
      if (!current() || lifetime !== selected) return;
      const safe =
        outcome === 'success' &&
        !unsafe(state) &&
        snapshot.conversations.some(
          (entry) =>
            entry.id === snapshot.selectedId &&
            entry.availability === 'available'
        );
      if (!current() || lifetime !== selected) return;
      const rows = selected.content.project(state);
      if (!current() || lifetime !== selected) return;
      publish({
        rows,
        outcome,
        canSubmit: safe,
        ...(safe ? {} : { conversations: unavailable() }),
        error: outcome === 'error' ? 'The LangGraph request failed.' : null,
      });
    } catch {
      if (current()) fail();
    } finally {
      finish(admitted);
    }
  }
  async function select(entry: ConversationEntry) {
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.conversations.includes(entry) ||
      entry.id === snapshot.selectedId ||
      entry.availability !== 'available'
    )
      return;
    // Detach before publishing the new selection so old observers cannot mix rows.
    const cleanup = detach();
    const { admitted, current } = admit('loading');
    try {
      if (!current()) return;
      publish({
        selectedId: entry.id,
        rows: Object.freeze([]),
        viewGeneration: snapshot.viewGeneration + 1,
      });
      if (!current()) return;
      await cleanup;
      if (!current()) return;
      const selected = install(entry.id, current);
      if (!selected || !current()) return;
      await selected.session.load({ signal: admitted.signal });
      // Detached or aborted SDK reads may fulfill. Fulfillment grants no authority.
      if (!current() || lifetime !== selected) return;
      const state = selected.session.getSnapshot();
      if (!current() || lifetime !== selected) return;
      const blocked =
        unsafe(state) ||
        !snapshot.conversations.some(
          (item) => item.id === entry.id && item.availability === 'available'
        );
      if (!current() || lifetime !== selected) return;
      if (blocked) {
        block();
        return;
      }
      const rows = selected.content.project(state);
      if (!current() || lifetime !== selected) return;
      publish({ rows, canSubmit: true });
    } catch {
      if (current()) fail();
    } finally {
      finish(admitted);
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const cleanup = detach();
    const { admitted, current } = admit('replacing');
    try {
      if (!current()) return;
      publish({
        selectedId: null,
        rows: Object.freeze([]),
        viewGeneration: snapshot.viewGeneration + 1,
      });
      if (!current()) return;
      await cleanup;
      if (current()) publish({ canSubmit: true });
    } finally {
      finish(admitted);
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    const selected = lifetime;
    const cleanup = detach();
    publish({
      busy: false,
      activity: 'idle',
      canSubmit: false,
      outcome: 'aborted',
      conversations: unavailable(),
    });
    try {
      await selected?.session.stop();
    } catch {
      /* No command reuse after uncertainty. */
    }
    await cleanup;
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    void detach();
    listeners.clear();
    disposal = Promise.all([...cleanups]).then(() => undefined);
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
    select,
    newConversation,
    stop,
    dispose,
  };
}
