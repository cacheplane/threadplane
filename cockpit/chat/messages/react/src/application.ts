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

export interface MessagesSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly unknown[];
    readonly subgraphs: readonly unknown[];
    readonly history:
      | readonly { readonly next: readonly string[] }[]
      | undefined;
  };
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface MessagesSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
const equal = (a: Message, b: Message) =>
  a.id === b.id && a.role === b.role && a.content === b.content;
const complete = (m: Message) =>
  m.delivery.phase === 'complete' && m.delivery.outcome === 'success';

/** One local conversation owner; streaming completion alone grants no continuation. */
export function createMessagesApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => MessagesSession;
}) {
  type Owner = {
    session: MessagesSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    confirmed: readonly Message[];
    generations: Set<string>;
    loading?: boolean;
    turn?: { text: string; human?: Message; answer?: Message };
  };
  let owner: Owner | undefined, operation: AbortController | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let snapshot: MessagesSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<MessagesSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function close(selected: Owner) {
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
    const previous = owner;
    owner = undefined;
    return previous ? close(previous) : Promise.resolve();
  }
  function unsafe(state: ReturnType<MessagesSession['getSnapshot']>) {
    return (
      !state ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs) ||
      !!state.error ||
      state.status === 'error' ||
      !!state.toolCalls.length ||
      !!state.interrupts.length ||
      !!state.subgraphs.length ||
      new Set(state.messages.map((m) => m.id)).size !== state.messages.length ||
      state.messages.some(
        (m) =>
          m.role === 'tool' ||
          m.toolCallId !== undefined ||
          !!m.toolCallIds?.length
      )
    );
  }
  function capture(
    selected: Owner,
    state: ReturnType<MessagesSession['getSnapshot']>
  ) {
    const prefix = selected.confirmed,
      messages = state.messages;
    if (
      messages.length < prefix.length ||
      prefix.some((m, i) => !equal(m, messages[i]))
    )
      selected.unsafe = true;
    const turn = selected.turn;
    if (!turn || selected.unsafe) return;
    if (snapshot.activity === 'confirming') {
      const expected = [turn.human, turn.answer];
      const suffix = messages.slice(prefix.length);
      if (
        suffix.length !== 2 ||
        expected.some(
          (message, index) =>
            !message ||
            !equal(message, suffix[index]) ||
            !complete(suffix[index]) ||
            (suffix[index].delivery.generation !==
              message.delivery.generation &&
              (!selected.loading ||
                suffix[index].delivery.generation !== suffix[index].id))
        )
      )
        selected.unsafe = true;
      return;
    }
    if (snapshot.activity !== 'running') return;
    const suffix = messages.slice(prefix.length);
    if (!suffix.length) return;
    const human = suffix[0];
    if (
      human.role !== 'user' ||
      human.content !== turn.text ||
      !complete(human) ||
      selected.generations.has(human.delivery.generation) ||
      prefix.some((m) => m.id === human.id) ||
      (turn.human &&
        (!equal(turn.human, human) ||
          turn.human.delivery.generation !== human.delivery.generation))
    ) {
      selected.unsafe = true;
      return;
    }
    turn.human ??= human;
    if (suffix.length > 2) {
      selected.unsafe = true;
      return;
    }
    const answer = suffix[1];
    if (!answer) return;
    if (
      answer.role !== 'assistant' ||
      answer.id === human.id ||
      prefix.some((m) => m.id === answer.id) ||
      answer.delivery.generation !== human.delivery.generation ||
      (turn.answer && turn.answer.id !== answer.id)
    ) {
      selected.unsafe = true;
      return;
    }
    turn.answer = answer;
  }
  function read(selected: Owner, valid: () => boolean) {
    if (!valid()) return;
    const state = selected.session.getSnapshot();
    if (!valid()) return;
    selected.unsafe ||= unsafe(state);
    if (!selected.unsafe) capture(selected, state);
    if (!valid()) return;
    if (Array.isArray(state?.messages) && Array.isArray(state?.toolCalls)) {
      const rows = selected.content.project(state);
      if (!valid()) return;
      publish({ rows, ...(selected.unsafe ? { canSubmit: false } : {}) });
    }
    if (!valid()) return;
    const latest = selected.session.getSnapshot();
    if (!valid()) return;
    // Subscribers may replace the observation while rows are being published.
    if (latest !== state) {
      selected.unsafe = true;
      return;
    }
    return state;
  }
  function blocked() {
    publish({
      canSubmit: false,
      outcome: 'paused',
      error: 'Start a new conversation to continue.',
    });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity: owner ? 'running' : 'creating',
      outcome: null,
      error: null,
    });
    try {
      if (!current()) return;
      if (!owner) {
        const id = await options.createThread(admitted.signal);
        if (!current()) return;
        if (!id || typeof id !== 'string')
          throw new Error('Unconfirmed conversation');
        const session = options.sessionFactory(id);
        const selected: Owner = {
          session,
          content: createMessageContent(),
          closed: false,
          unsafe: false,
          confirmed: [],
          generations: new Set(),
        };
        if (!current()) {
          void close(selected);
          return;
        }
        owner = selected;
        const release = session.subscribe(() =>
          read(
            selected,
            () =>
              !disposed &&
              owner === selected &&
              !selected.closed &&
              !operation?.signal.aborted
          )
        );
        selected.release = release;
        if (selected.closed) release();
        if (!current()) return;
        publish({ threadId: id, activity: 'running' });
      }
      const selected = owner;
      const valid = () => current() && owner === selected && !selected.closed;
      const before = read(selected, valid);
      if (!valid()) return;
      if (
        !before ||
        selected.unsafe ||
        before.messages.length !== selected.confirmed.length
      ) {
        blocked();
        return;
      }
      selected.turn = { text };
      const result = await selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!valid()) return;
      const live = read(selected, valid),
        turn = selected.turn;
      if (!valid()) return;
      if (
        result !== 'success' ||
        !live ||
        live.status !== 'idle' ||
        selected.unsafe ||
        !turn?.human ||
        !turn.answer ||
        !complete(turn.answer) ||
        live.messages.length !== selected.confirmed.length + 2
      ) {
        blocked();
        return;
      }
      const expected = Object.freeze([
        ...selected.confirmed,
        turn.human,
        turn.answer,
      ]);
      publish({ activity: 'confirming' });
      if (!valid()) return;
      if (!read(selected, valid) || selected.unsafe) {
        if (valid()) blocked();
        return;
      }
      selected.loading = true;
      await selected.session.load({ signal: admitted.signal });
      if (!valid()) return;
      const saved = read(selected, valid);
      if (!valid()) return;
      if (
        !saved ||
        selected.unsafe ||
        saved.status !== 'idle' ||
        !saved.history?.length ||
        !Array.isArray(saved.history[0].next) ||
        saved.history[0].next.length ||
        saved.messages.length !== expected.length ||
        expected.some(
          (m, i) =>
            !equal(m, saved.messages[i]) ||
            !complete(saved.messages[i]) ||
            saved.messages[i].delivery.generation !== saved.messages[i].id
        )
      ) {
        blocked();
        return;
      }
      selected.confirmed = Object.freeze([...saved.messages]);
      selected.generations.add(turn.human.delivery.generation);
      selected.loading = false;
      selected.turn = undefined;
      publish({ outcome: 'success', canSubmit: true });
    } catch {
      if (current())
        publish({
          canSubmit: false,
          outcome: 'error',
          error:
            'The conversation could not be confirmed. Start a new conversation.',
        });
    } finally {
      if (current()) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    const selected = owner;
    const cleanup = detach();
    publish({
      busy: false,
      activity: 'idle',
      canSubmit: false,
      outcome: 'aborted',
      error: null,
    });
    try {
      await selected?.session.stop();
    } catch {
      /* An uncertain request is never repeated. */
    }
    await cleanup;
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const cleanup = detach();
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({ busy: true, canSubmit: false, activity: 'replacing' });
    if (!current()) return;
    await cleanup;
    if (!current()) return;
    operation = undefined;
    publish({
      threadId: null,
      rows: Object.freeze([]),
      busy: false,
      canSubmit: true,
      activity: 'idle',
      outcome: null,
      error: null,
      viewGeneration: snapshot.viewGeneration + 1,
    });
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
    stop,
    newConversation,
    dispose,
  };
}
