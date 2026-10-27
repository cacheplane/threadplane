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

export interface ThemingSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly unknown[];
    readonly subgraphs: readonly unknown[];
    readonly history:
      | readonly {
          readonly next: readonly string[];
          readonly checkpoint: {
            readonly thread_id: string;
            readonly checkpoint_ns: string;
          };
        }[]
      | undefined;
  };
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface ThemingSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'replacing'
    | 'cleanup-failed';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
const equal = (a: Message, b: Message) =>
  !!b &&
  a.id === b.id &&
  a.role === b.role &&
  a.content === b.content &&
  a.reasoning === b.reasoning &&
  a.name === b.name &&
  JSON.stringify(a.citations) === JSON.stringify(b.citations);
const complete = (m: Message) =>
  m.delivery.phase === 'complete' && m.delivery.outcome === 'success';
type Methods = Pick<
  ThemingSession,
  'getSnapshot' | 'subscribe' | 'submit' | 'load' | 'stop' | 'dispose'
>;
type Owner = {
  threadId: string;
  session: ThemingSession;
  methods: Methods;
  content: ReturnType<typeof createMessageContent>;
  release?: () => void;
  closed: boolean;
  unsafe: boolean;
  confirmed: readonly Message[];
  generations: Set<string>;
  loading?: boolean;
  turn?: { text: string; human?: Message; answer?: Message };
};
// The application owns its frontend aggregate separately from the native session.
// Copy evidence before exposing rows so caller-owned mutation cannot rewrite history.
function ownSnapshot(state: ReturnType<ThemingSession['getSnapshot']>) {
  return Object.freeze({
    status: state.status,
    error: state.error,
    messages: Object.freeze(
      state.messages.map((m) =>
        Object.freeze({
          ...m,
          delivery: Object.freeze({ ...m.delivery }),
          ...(m.toolCallIds
            ? { toolCallIds: Object.freeze([...m.toolCallIds]) }
            : {}),
          ...(m.citations
            ? {
                citations: Object.freeze(
                  m.citations.map((c) => Object.freeze(structuredClone(c)))
                ),
              }
            : {}),
        })
      )
    ),
    toolCalls: Object.freeze([...state.toolCalls]),
    interrupts: Object.freeze([...state.interrupts]),
    subgraphs: Object.freeze([...state.subgraphs]),
    history:
      state.history === undefined
        ? undefined
        : Object.freeze(
            state.history.map((entry) =>
              Object.freeze({
                next: Object.freeze([...entry.next]),
                checkpoint: Object.freeze({ ...entry.checkpoint }),
              })
            )
          ),
  });
}

/** One local conversation owner; only a saved, terminal transcript grants continuation. */
export function createThemingApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (
    id: string
  ) => ThemingSession | Promise<ThemingSession>;
}) {
  let owner: Owner | undefined, operation: AbortController | undefined;
  let disposed = false,
    revoking = false,
    cleanupFailed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let snapshot: ThemingSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<ThemingSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      ...(cleanupFailed
        ? {
            canSubmit: false,
            activity: 'cleanup-failed' as const,
            outcome: 'error' as const,
            error:
              'The conversation could not close safely. Reload the preview to continue.',
          }
        : {}),
    });
    for (const notify of [...listeners]) {
      try {
        notify();
      } catch {
        /* Observers cannot prevent teardown. */
      }
    }
  }
  function failCleanup() {
    cleanupFailed = true;
    publish({ canSubmit: false });
  }
  function track(promise: Promise<unknown>) {
    const done = promise.then(
      () => undefined,
      () => undefined
    );
    cleanups.add(done);
    void done.then(() => cleanups.delete(done));
    return done;
  }
  async function drain() {
    while (cleanups.size) await Promise.all([...cleanups]);
  }
  // Register settlement before calling potentially reentrant user/native code.
  function owned<T>(work: () => T | Promise<T>): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void,
      reject!: (error: unknown) => void;
    const pending = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    track(pending);
    try {
      resolve(work());
    } catch (error) {
      reject(error);
    }
    return pending;
  }
  function cleanupCandidate(
    candidate: unknown,
    methods: Partial<Methods> = {},
    release?: () => void,
    content?: Owner['content'],
    stopping = false
  ) {
    const done = track(
      Promise.resolve()
        .then(async () => {
          let dispose = methods.dispose,
            stop = methods.stop;
          try {
            dispose ??= (candidate as ThemingSession)?.dispose;
          } catch {
            failCleanup();
          }
          try {
            stop ??= (candidate as ThemingSession)?.stop;
          } catch {
            failCleanup();
          }
          if (stopping && typeof stop === 'function') {
            try {
              await stop.call(candidate);
            } catch {
              failCleanup();
            }
          }
          if (typeof dispose === 'function') {
            try {
              await dispose.call(candidate);
              return;
            } catch {
              failCleanup();
            }
          }
          if (typeof stop === 'function') {
            try {
              await stop.call(candidate);
            } catch {
              failCleanup();
            }
          } else failCleanup();
        })
        .catch(() => {
          failCleanup();
        })
    );
    try {
      release?.();
    } catch {
      failCleanup();
    }
    try {
      content?.dispose();
    } catch {
      failCleanup();
    }
    return done;
  }
  function close(selected: Owner, stopping = false) {
    selected.closed = true;
    const release = selected.release;
    selected.release = undefined;
    return cleanupCandidate(
      selected.session,
      selected.methods,
      release,
      selected.content,
      stopping
    );
  }
  async function install(signal: AbortSignal, valid: () => boolean) {
    const createThread = options.createThread;
    if (!valid()) return;
    const id = await createThread(signal);
    if (!valid()) return;
    if (typeof id !== 'string' || !id || id.length > 500)
      throw Error('Unconfirmed conversation');
    const factory = options.sessionFactory;
    if (!valid()) return;
    const candidate = await factory(id);
    if (!valid()) {
      await cleanupCandidate(candidate);
      return;
    }
    const methods: Partial<Methods> = {};
    let selected: Owner | undefined, release: (() => void) | undefined;
    try {
      for (const name of [
        'dispose',
        'stop',
        'getSnapshot',
        'subscribe',
        'submit',
        'load',
      ] as const) {
        let method;
        try {
          method = candidate[name];
        } catch (error) {
          if (name === 'dispose' || name === 'stop') failCleanup();
          throw error;
        }
        if (typeof method !== 'function')
          throw Error('Runtime session is unavailable.');
        Object.defineProperty(methods, name, {
          value: method,
          enumerable: true,
        });
        if (!valid()) {
          await cleanupCandidate(candidate, methods);
          return;
        }
      }
      const native = (methods as Methods).getSnapshot.call(candidate);
      if (!valid()) {
        await cleanupCandidate(candidate, methods);
        return;
      }
      const initial = ownSnapshot(native);
      if (!valid()) {
        await cleanupCandidate(candidate, methods);
        return;
      }
      if (
        unsafe(initial, id) ||
        initial.status !== 'idle' ||
        initial.messages.length
      )
        throw Error('Runtime session is unavailable.');
      selected = {
        threadId: id,
        session: candidate,
        methods: methods as Methods,
        content: createMessageContent(),
        closed: false,
        unsafe: false,
        confirmed: [],
        generations: new Set(),
      };
      const p = selected;
      const subscribed = p.methods.subscribe.call(candidate, () => {
        const current = () =>
          !disposed && !cleanupFailed && owner === p && !p.closed;
        if (!current()) return;
        try {
          read(p, current);
        } catch {
          if (current()) {
            p.unsafe = true;
            blocked();
          }
        }
      });
      if (typeof subscribed !== 'function')
        throw Error('A callable release is required.');
      release = subscribed;
      if (!valid()) {
        selected.closed = true;
        await cleanupCandidate(candidate, methods, release, selected.content);
        return;
      }
      selected.release = release;
      owner = selected;
      publish({ threadId: id, activity: 'running' });
      return selected;
    } catch (error) {
      if (selected) selected.closed = true;
      await cleanupCandidate(candidate, methods, release, selected?.content);
      throw error;
    }
  }
  function unsafe(
    state: ReturnType<ThemingSession['getSnapshot']>,
    threadId: string,
    historyRequired = false
  ) {
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
      (historyRequired && !state.history?.length) ||
      (!!state.history?.length &&
        (state.history[0].checkpoint?.thread_id !== threadId ||
          state.history[0].checkpoint?.checkpoint_ns !== '' ||
          state.history[0].next.length !== 0)) ||
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
    state: ReturnType<ThemingSession['getSnapshot']>
  ) {
    const prefix = selected.confirmed,
      messages = state.messages;
    if (
      messages.length < prefix.length ||
      prefix.some(
        (m, i) =>
          !equal(m, messages[i]) ||
          !complete(messages[i]) ||
          m.delivery.generation !== messages[i].delivery.generation
      )
    )
      selected.unsafe = true;
    const turn = selected.turn;
    if (!turn) {
      // Without an admitted turn, only the exact confirmed transcript at idle is owned.
      selected.unsafe ||=
        state.status !== 'idle' || messages.length !== prefix.length;
      return;
    }
    if (selected.unsafe) return;
    const expected = [turn.human, turn.answer];
    const suffix = messages.slice(prefix.length);
    // Observed members retain their positions and terminal success; content may be revised.
    if (
      suffix.some(
        (message) => message.delivery.phase === 'complete' && !complete(message)
      ) ||
      expected.some(
        (message, index) =>
          message &&
          (suffix[index]?.id !== message.id ||
            (message.delivery.phase === 'complete' && !complete(suffix[index])))
      )
    ) {
      selected.unsafe = true;
      return;
    }
    if (snapshot.activity === 'confirming') {
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
    const native = selected.methods.getSnapshot.call(selected.session);
    if (!valid()) return;
    const state = ownSnapshot(native);
    if (!valid()) return;
    // The native session retains its last explicit history page during a run.
    // Once confirmed, losing terminal history revokes this owner's continuation.
    selected.unsafe ||= unsafe(
      state,
      selected.threadId,
      selected.confirmed.length > 0
    );
    if (!selected.unsafe) capture(selected, state);
    if (!valid()) return;
    if (Array.isArray(state?.messages) && Array.isArray(state?.toolCalls)) {
      const rows = selected.content.project(state);
      if (!valid()) return;
      publish({ rows, ...(selected.unsafe ? { canSubmit: false } : {}) });
    }
    if (!valid()) return;
    const latest = selected.methods.getSnapshot.call(selected.session);
    if (!valid()) return;
    // Subscribers may replace the observation while rows are being published.
    const changed =
      latest !== native ||
      JSON.stringify(ownSnapshot(latest)) !== JSON.stringify(state);
    if (!valid()) return;
    if (changed) {
      selected.unsafe = true;
      publish({ canSubmit: false });
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
  async function submit(text: string, generation = snapshot.viewGeneration) {
    if (
      disposed ||
      cleanupFailed ||
      revoking ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      generation !== snapshot.viewGeneration ||
      typeof text !== 'string' ||
      !text.trim()
    )
      return;
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed &&
      !cleanupFailed &&
      operation === admitted &&
      !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity: owner ? 'running' : 'creating',
      outcome: null,
      error: null,
    });
    try {
      if (!current()) return;
      const selected =
        owner ?? (await owned(() => install(admitted.signal, current)));
      if (!selected || !current()) return;
      const valid = () => current() && owner === selected && !selected.closed;
      const before = read(selected, valid);
      if (!valid()) return;
      if (
        !before ||
        before.status !== 'idle' ||
        selected.unsafe ||
        before.messages.length !== selected.confirmed.length
      ) {
        blocked();
        return;
      }
      selected.turn = { text };
      const result = await selected.methods.submit.call(
        selected.session,
        text,
        { signal: admitted.signal }
      );
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
      await selected.methods.load.call(selected.session, {
        signal: admitted.signal,
      });
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
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function revoke(replacing: boolean) {
    if (disposed || cleanupFailed || revoking) return;
    revoking = true;
    const previous = operation,
      selected = owner;
    operation = undefined;
    owner = undefined;
    if (selected) selected.closed = true;
    // Keep reentrant disposal pending until cleanup has been registered.
    let prepared!: () => void;
    track(
      new Promise<void>((resolve) => {
        prepared = resolve;
      })
    );
    const admitted = new AbortController();
    operation = admitted;
    publish({
      viewGeneration: snapshot.viewGeneration + 1,
      busy: true,
      canSubmit: false,
      activity: replacing ? 'replacing' : 'idle',
      outcome: replacing ? null : 'aborted',
      error: null,
      ...(replacing ? { threadId: null, rows: Object.freeze([]) } : {}),
    });
    try {
      previous?.abort();
      if (selected) void close(selected, !replacing);
    } finally {
      prepared();
    }
    try {
      await drain();
      if (!disposed && operation === admitted)
        publish({ canSubmit: replacing && !cleanupFailed });
    } finally {
      revoking = false;
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    let settled!: () => void;
    disposal = new Promise<void>((resolve) => {
      settled = resolve;
    });
    disposed = true;
    const previous = operation,
      selected = owner;
    operation = undefined;
    owner = undefined;
    if (selected) selected.closed = true;
    snapshot = Object.freeze({
      ...snapshot,
      viewGeneration: snapshot.viewGeneration + 1,
      busy: false,
      canSubmit: false,
    });
    listeners.clear();
    previous?.abort();
    if (selected) void close(selected);
    void drain().then(settled);
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
    stop: () => revoke(false),
    newConversation: () => revoke(true),
    dispose,
  };
}
