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
  captureTurn,
  confirmCanonicalHistory,
  type OwnedTurn,
} from './canonical-history';

export interface DeploymentSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly interrupts: readonly unknown[];
  };
}
export interface DeploymentSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly activity: 'idle' | 'creating' | 'running' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}

/** Owns one confirmed conversation; only the exact current canonical result permits continuation. */
export function createDeploymentApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => DeploymentSession;
}) {
  type Primary = {
    session: DeploymentSession;
    closed: boolean;
    release?: () => void;
    content: ReturnType<typeof createMessageContent>;
    unsafe: boolean;
    confirmed: readonly Message[];
    turn?: OwnedTurn;
    previousGenerations: ReadonlySet<string>;
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Primary | undefined;
  let operation: AbortController | undefined,
    disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: DeploymentSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<DeploymentSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
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
  function close(selected: Primary) {
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
  function detach() {
    const old = primary;
    primary = undefined;
    return old ? close(old) : Promise.resolve();
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
    const rows = selected.content.project({ ...state, messages });
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
  function admit(activity: DeploymentSnapshot['activity'], execution: boolean) {
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
  async function execute(text: string) {
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
    }
    const { admitted, valid } = admit(primary ? 'running' : 'creating', true);
    try {
      if (!valid()) return;
      if (!primary) {
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
      selected.previousGenerations = new Set(
        state.messages.map((message) => message.delivery.generation)
      );
      if (!ownedValid()) return;
      const pending = selected.session.submit(text, {
        signal: admitted.signal,
      });
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
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const { admitted, valid } = admit('replacing', false);
    const cleanup = detach();
    try {
      if (!valid()) return;
      publish({
        threadId: null,
        rows: Object.freeze([]),
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
    newConversation,
    stop,
    dispose,
  };
}
