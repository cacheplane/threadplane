import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
  Message,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  captureHistoryPage,
  type CheckpointRow,
  type ForkSource,
} from './checkpoint-history';
import {
  captureTurn,
  confirmCanonicalHistory,
  type OwnedTurn,
} from './canonical-history';

export interface TimeTravelSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly interrupts: readonly unknown[];
    readonly history?: unknown;
  };
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
  fork(
    source: ForkSource,
    text: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
}
export interface TimeTravelSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly historyPage: readonly CheckpointRow[] | undefined;
  readonly historyError: string | null;
  readonly selectedSource: ForkSource | null;
  readonly activity: 'idle' | 'creating' | 'running' | 'reading' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly canRefresh: boolean;
  readonly canFork: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}

/** Selection is inert; only the retained primary session owns execution routing. */
export function createTimeTravelApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => TimeTravelSession;
}) {
  type Owned = {
    session: TimeTravelSession;
    closed: boolean;
    release?: () => void;
    content?: ReturnType<typeof createMessageContent>;
  };
  type Primary = Owned & {
    unsafe: boolean;
    confirmed: readonly Message[];
    turn?: OwnedTurn;
    previousGenerations: ReadonlySet<string>;
    fork: boolean;
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Primary | undefined, reader: Owned | undefined;
  let operation: AbortController | undefined,
    disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: TimeTravelSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    historyPage: undefined,
    historyError: null,
    selectedSource: null,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    canRefresh: false,
    canFork: false,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<TimeTravelSnapshot>) {
    if (disposed) return;
    const next = { ...snapshot, ...update };
    snapshot = Object.freeze({
      ...next,
      canRefresh: !next.busy && next.canSubmit && next.threadId !== null,
      canFork: !next.busy && next.canSubmit && next.selectedSource !== null,
    });
    for (const notify of listeners) notify();
  }
  function current(selected: Primary) {
    return (
      !disposed &&
      primary === selected &&
      !selected.closed &&
      !operation?.signal.aborted
    );
  }
  function close(selected: Owned) {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    selected.release?.();
    selected.content?.dispose();
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
  function detach() {
    const old = primary,
      oldReader = reader;
    primary = undefined;
    reader = undefined;
    return Promise.all([old && close(old), oldReader && close(oldReader)]).then(
      () => undefined
    );
  }
  function read(selected: Primary, valid: () => boolean) {
    if (!valid()) return;
    const root = selected.session.getSnapshot();
    if (!valid()) return;
    const status = root.status;
    if (!valid()) return;
    const error = root.error;
    if (!valid()) return;
    const messages = root.messages;
    if (!valid()) return;
    const toolCalls = root.toolCalls;
    if (!valid()) return;
    const interrupts = root.interrupts;
    if (!valid()) return;
    const values = root.values;
    if (!valid()) return;
    if (
      !Array.isArray(messages) ||
      !Array.isArray(toolCalls) ||
      !Array.isArray(interrupts)
    )
      throw new Error('The execution snapshot is unavailable.');
    const blocked =
      !!error ||
      !!toolCalls.length ||
      !!interrupts.length ||
      messages.some(
        (message) =>
          message.role === 'tool' ||
          message.toolCallId !== undefined ||
          !!message.toolCallIds?.length
      );
    if (!valid()) return;
    return { status, error, messages, toolCalls, interrupts, values, blocked };
  }
  function capture(selected: Primary, valid: () => boolean) {
    const state = read(selected, valid);
    if (!state || !valid()) return;
    selected.unsafe ||= state.blocked;
    if (!selected.turn && snapshot.activity === 'running') {
      const turn = captureTurn(
        state.messages,
        selected.previousGenerations,
        selected.fork,
        selected.confirmed,
        valid
      );
      if (!valid()) return;
      if (turn) selected.turn = turn;
    }
    const turn = selected.turn;
    const canonical =
      turn && !selected.unsafe && state.status === 'idle'
        ? confirmCanonicalHistory(state.messages, state.values, turn, valid)
        : undefined;
    if (!valid()) return;
    const messages =
      canonical ??
      (turn
        ? [
            ...turn.prefix,
            ...state.messages.filter(
              (message) => message.delivery.generation === turn.generation
            ),
          ]
        : selected.confirmed);
    if (!valid()) return;
    const rows = selected.content!.project({ ...state, messages });
    if (!valid()) return;
    return { rows, canonical };
  }
  function observe(selected: Primary) {
    const valid = () => current(selected);
    try {
      const result = capture(selected, valid);
      if (!result || !valid()) return;
      publish({
        rows: result.rows,
        ...(selected.unsafe ? { canSubmit: false } : {}),
      });
    } catch {
      if (valid()) {
        selected.unsafe = true;
        publish({
          canSubmit: false,
          error: 'The execution snapshot could not be confirmed.',
        });
      }
    }
  }
  function install(id: string, valid: () => boolean) {
    const session = options.sessionFactory(id);
    const selected: Primary = {
      session,
      closed: false,
      content: createMessageContent(),
      unsafe: false,
      confirmed: [],
      previousGenerations: new Set(),
      fork: false,
    };
    if (!valid()) {
      void close(selected);
      return;
    }
    primary = selected;
    const release = session.subscribe(() => observe(selected));
    selected.release = release;
    if (selected.closed) release();
    if (!valid() || primary !== selected) {
      void close(selected);
      return;
    }
    return selected;
  }
  function admit(activity: TimeTravelSnapshot['activity'], execution: boolean) {
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity,
      ...(execution ? { outcome: null, error: null } : {}),
    });
    return { admitted, valid };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  async function execute(text: string, source?: ForkSource) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const previous = primary;
    const initialValid = () =>
      !disposed &&
      !snapshot.busy &&
      snapshot.canSubmit &&
      primary === previous &&
      !previous?.closed;
    let before: ReturnType<typeof read>;
    try {
      before = previous && read(previous, initialValid);
    } catch {
      if (initialValid())
        publish({
          canSubmit: false,
          error: 'The execution snapshot is unavailable.',
        });
      return;
    }
    if (!initialValid()) return;
    if (previous && (previous.unsafe || before?.blocked)) {
      publish({ canSubmit: false });
      return;
    }
    const generations = new Set(
      before?.messages.map((message) => message.delivery.generation)
    );
    if (!initialValid()) return;
    if (previous) {
      previous.turn = undefined;
      previous.previousGenerations = generations;
      previous.fork = !!source;
    }
    const { admitted, valid } = admit(primary ? 'running' : 'creating', true);
    try {
      if (!valid()) return;
      if (!primary) {
        if (source) throw new Error('No owned primary conversation.');
        const id = await options.createThread(admitted.signal);
        if (!valid()) return;
        const selected = install(id, valid);
        if (!selected || !valid()) return;
        publish({ threadId: id, activity: 'running' });
      }
      if (!valid() || !primary) return;
      const selected = primary,
        ownedValid = () => valid() && current(selected);
      const state = read(selected, ownedValid);
      if (!state || !ownedValid()) return;
      if (state.blocked || selected.unsafe) {
        selected.unsafe = true;
        publish({ canSubmit: false });
        return;
      }
      selected.turn = undefined;
      selected.fork = !!source;
      selected.previousGenerations = new Set(
        state.messages.map((message) => message.delivery.generation)
      );
      if (!ownedValid()) return;
      const pending = source
        ? selected.session.fork(source, text, { signal: admitted.signal })
        : selected.session.submit(text, { signal: admitted.signal });
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      observe(selected);
      const outcome = await pending;
      if (!ownedValid()) return;
      const result = capture(selected, ownedValid);
      if (!result || !ownedValid()) return;
      const safe =
        outcome === 'success' && !!result.canonical && !selected.unsafe;
      if (safe) selected.confirmed = result.canonical!;
      publish({
        rows: result.rows,
        outcome,
        canSubmit: safe,
        error: safe
          ? null
          : 'The current conversation history could not be confirmed. Start a new conversation.',
      });
    } catch {
      if (valid())
        publish({
          canSubmit: false,
          outcome: 'error',
          error: 'The LangGraph request failed. Start a new conversation.',
        });
    } finally {
      finish(admitted);
    }
  }
  function selectCheckpoint(index: number) {
    if (disposed || snapshot.busy || !snapshot.canSubmit) return;
    const source = snapshot.historyPage?.[index]?.source;
    if (source) publish({ selectedSource: source });
  }
  function forkSelected(text: string) {
    const source = snapshot.selectedSource;
    if (!source || !snapshot.canFork) return Promise.resolve();
    return execute(text, source);
  }
  async function refreshHistory() {
    if (disposed || !snapshot.canRefresh || !primary || !snapshot.threadId)
      return;
    const selected = primary,
      id = snapshot.threadId;
    const initialValid = () =>
      !disposed &&
      primary === selected &&
      !selected.closed &&
      !snapshot.busy &&
      snapshot.canRefresh;
    try {
      const state = read(selected, initialValid);
      if (!state || !initialValid()) return;
      if (state.blocked || selected.unsafe) {
        publish({ canSubmit: false });
        return;
      }
    } catch {
      if (initialValid())
        publish({
          canSubmit: false,
          error: 'The execution snapshot is unavailable.',
        });
      return;
    }
    const { admitted, valid } = admit('reading', false);
    const ownedValid = () => valid() && current(selected);
    let ownedReader: Owned | undefined;
    try {
      if (!ownedValid()) return;
      publish({ selectedSource: null, historyError: null });
      if (!ownedValid()) return;
      const session = options.sessionFactory(id);
      ownedReader = { session, closed: false };
      if (!ownedValid()) {
        await close(ownedReader);
        return;
      }
      reader = ownedReader;
      const pending = session.load({ signal: admitted.signal });
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      await pending;
      if (!ownedValid()) return;
      const state = session.getSnapshot();
      if (!ownedValid()) return;
      const history = state.history;
      if (!ownedValid()) return;
      const page = captureHistoryPage(history, id, ownedValid);
      if (!ownedValid()) return;
      if (!page) throw new Error('The loaded checkpoint page is unavailable.');
      await close(ownedReader);
      if (!ownedValid()) return;
      publish({
        historyPage: page,
        historyError: null,
        canSubmit: !selected.unsafe,
      });
    } catch {
      if (ownedReader) await close(ownedReader);
      if (ownedValid())
        publish({
          historyError: 'The checkpoint page was not refreshed.',
          selectedSource: null,
          canSubmit: !selected.unsafe,
        });
    } finally {
      if (ownedReader) await close(ownedReader);
      if (reader === ownedReader) reader = undefined;
      finish(admitted);
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const { admitted, valid } = admit('replacing', false);
    const cleanup = detach();
    try {
      if (!valid()) return;
      publish({
        threadId: null,
        rows: Object.freeze([]),
        historyPage: undefined,
        historyError: null,
        selectedSource: null,
        outcome: null,
        error: null,
        viewGeneration: snapshot.viewGeneration + 1,
      });
      if (!valid()) return;
      await cleanup;
      if (valid()) publish({ canSubmit: true });
    } finally {
      finish(admitted);
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    const selected = primary,
      cleanup = detach();
    publish({
      busy: false,
      activity: 'idle',
      canSubmit: false,
      selectedSource: null,
      outcome: 'aborted',
      error: 'The operation stopped. Start a new conversation.',
    });
    try {
      await selected?.session.stop();
    } catch {
      /* Detached work cannot grant authority. */
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
    disposal = (async () => {
      do {
        await Promise.resolve();
        await Promise.all([...cleanups]);
      } while (cleanups.size);
    })();
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
    submit: (text: string) => execute(text),
    selectCheckpoint,
    forkSelected,
    refreshHistory,
    newConversation,
    stop,
    dispose,
  };
}
