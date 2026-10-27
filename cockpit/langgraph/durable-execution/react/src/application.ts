import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

export interface DurableSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly interrupts: readonly { readonly value?: unknown }[];
  };
}
type Step = 'analyze' | 'plan' | 'generate';
const orderedSteps: readonly Step[] = ['analyze', 'plan', 'generate'];
function checkpoints(latest: Step | null) {
  const completed = latest === null ? -1 : orderedSteps.indexOf(latest);
  return Object.freeze(
    orderedSteps.map((id, index) =>
      Object.freeze({
        id,
        label: { analyze: 'Analyze', plan: 'Plan', generate: 'Generate' }[id],
        status:
          index <= completed ? ('complete' as const) : ('pending' as const),
      })
    )
  );
}
export interface DurableSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly checkpoints: ReturnType<typeof checkpoints>;
  readonly latestCheckpoint: Step | null;
  readonly activity: 'idle' | 'creating' | 'running' | 'checking' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly canCheck: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
/** Owns one confirmed thread; status reads never dispatch or replay work. */
export function createDurableApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => DurableSession;
}) {
  type Lifetime = {
    session: DurableSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    turn?: { id: string; generation: string };
    previousIds: ReadonlySet<string>;
  };
  const listeners = new Set<() => void>();
  const cleanups = new Set<Promise<void>>();
  let snapshot: DurableSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    checkpoints: checkpoints(null),
    latestCheckpoint: null,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    canCheck: false,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  let lifetime: Lifetime | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  function publish(update: Partial<DurableSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function current(selected: Lifetime) {
    return (
      !disposed &&
      lifetime === selected &&
      !selected.closed &&
      !operation?.signal.aborted
    );
  }
  function unsafe(state: ReturnType<DurableSession['getSnapshot']>) {
    return (
      !!state.interrupts.length ||
      !!state.toolCalls.length ||
      state.messages.some(
        (message) =>
          message.role === 'tool' ||
          message.toolCallId !== undefined ||
          !!message.toolCallIds?.length
      )
    );
  }
  function terminal(
    selected: Lifetime,
    state: ReturnType<DurableSession['getSnapshot']>
  ) {
    const turn = selected.turn;
    if (
      !turn ||
      selected.unsafe ||
      unsafe(state) ||
      state.error ||
      state.status !== 'idle' ||
      ownValue(state, 'step') !== 'generate' ||
      ownValue(state, 'completed_turn_id') !== turn.id
    )
      return;
    const answerId = ownValue(state, 'completed_answer_id');
    if (typeof answerId !== 'string' || !answerId || answerId === turn.id)
      return;
    const humans = state.messages.filter((message) => message.id === turn.id);
    const answers = state.messages.filter((message) => message.id === answerId);
    if (humans.length !== 1 || answers.length !== 1) return;
    const human = humans[0],
      answer = answers[0];
    if (
      human.role !== 'user' ||
      answer.role !== 'assistant' ||
      [human, answer].some(
        (message) =>
          message.delivery.generation !== turn.generation ||
          message.delivery.phase !== 'complete' ||
          message.delivery.outcome !== 'success'
      )
    )
      return;
    return [human, answer];
  }
  function ownValue(
    state: ReturnType<DurableSession['getSnapshot']>,
    key: string
  ) {
    const values = state.values;
    return values && Object.hasOwn(values, key) ? values[key] : undefined;
  }
  function checkable(
    selected: Lifetime,
    state: ReturnType<DurableSession['getSnapshot']>
  ) {
    return (
      !!selected.turn &&
      !selected.unsafe &&
      !unsafe(state) &&
      state.error?.recovery === 'check' &&
      typeof selected.session.checkStatus === 'function'
    );
  }
  function capture(selected: Lifetime, valid: () => boolean) {
    if (!valid()) return;
    const state = selected.session.getSnapshot();
    if (!valid()) return;
    const blocked = unsafe(state);
    if (!valid()) return;
    selected.unsafe ||= blocked;
    if (!selected.turn && snapshot.activity === 'running') {
      // The SDK admits a user row with successful complete delivery before I/O.
      // Its new identity and generation identify this turn, not delivery phase.
      const human = [...state.messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'user' && !selected.previousIds.has(message.id)
        );
      if (!valid()) return;
      if (human)
        selected.turn = { id: human.id, generation: human.delivery.generation };
    }
    const finalMessages = terminal(selected, state);
    const complete = !!finalMessages;
    if (!valid()) return;
    const step = ownValue(state, 'step');
    if (!valid()) return;
    const latest: Step | null = complete
      ? 'generate'
      : selected.turn && (step === 'analyze' || step === 'plan')
      ? step
      : null;
    const rows = selected.content.project(
      finalMessages ? { ...state, messages: finalMessages } : state
    );
    if (!valid()) return;
    return { state, rows, complete, latest };
  }
  function observe(selected: Lifetime) {
    const valid = () => current(selected);
    const captured = capture(selected, valid);
    if (!captured || !valid()) return;
    const canCheck = !snapshot.busy && checkable(selected, captured.state);
    if (!valid()) return;
    publish({
      rows: captured.rows,
      latestCheckpoint: captured.latest,
      checkpoints: checkpoints(captured.latest),
      canCheck,
      ...(selected.unsafe ? { canSubmit: false } : {}),
    });
  }
  function close(selected: Lifetime) {
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
    const previous = lifetime;
    lifetime = undefined;
    return previous ? close(previous) : Promise.resolve();
  }
  function install(id: string, valid: () => boolean) {
    const session = options.sessionFactory(id);
    const selected: Lifetime = {
      session,
      content: createMessageContent(),
      closed: false,
      unsafe: false,
      previousIds: new Set(),
    };
    if (!valid()) {
      void close(selected);
      return;
    }
    lifetime = selected;
    const release = session.subscribe(() => observe(selected));
    selected.release = release;
    if (selected.closed) release();
    if (!valid() || lifetime !== selected) {
      if (!selected.closed) void close(selected);
      return;
    }
    return selected;
  }
  function admit(activity: DurableSnapshot['activity']) {
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      canCheck: false,
      activity,
      outcome: null,
      error: null,
    });
    return { admitted, valid };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  function settle(
    selected: Lifetime,
    valid: () => boolean,
    outcome?: CompleteOutcome
  ) {
    const captured = capture(selected, valid);
    if (!captured || !valid()) return;
    const safe =
      captured.complete && (outcome === undefined || outcome === 'success');
    const canCheck = !safe && checkable(selected, captured.state);
    if (!valid()) return;
    publish({
      rows: captured.rows,
      latestCheckpoint: captured.latest,
      checkpoints: checkpoints(captured.latest),
      canSubmit: safe,
      canCheck,
      outcome: safe ? 'success' : outcome ?? 'interrupted',
      error: safe ? null : 'The saved outcome could not be confirmed.',
    });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const previous = lifetime;
    const before = previous?.session.getSnapshot();
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      lifetime !== previous ||
      previous?.closed
    )
      return;
    const initiallyBlocked =
      previous && before && (previous.unsafe || unsafe(before) || before.error);
    // Safety fields are external reads too: replacement may occur in a getter.
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      lifetime !== previous ||
      previous?.closed
    )
      return;
    if (initiallyBlocked) {
      publish({ canSubmit: false });
      return;
    }
    const { admitted, valid } = admit(lifetime ? 'running' : 'creating');
    try {
      if (!valid()) return;
      publish({ checkpoints: checkpoints(null), latestCheckpoint: null });
      if (!valid()) return;
      if (!lifetime) {
        const id = await options.createThread(admitted.signal);
        if (!valid()) return;
        const selected = install(id, valid);
        if (!selected || !valid()) return;
        publish({ threadId: id, activity: 'running' });
      }
      if (!valid() || !lifetime) return;
      const selected = lifetime;
      const state = selected.session.getSnapshot();
      if (!valid() || lifetime !== selected) return;
      selected.turn = undefined;
      selected.previousIds = new Set(
        state.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id)
      );
      if (!valid() || lifetime !== selected) return;
      const pending = selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!valid() || lifetime !== selected) return;
      observe(selected);
      const outcome = await pending;
      if (!valid() || lifetime !== selected) return;
      settle(selected, () => valid() && current(selected), outcome);
    } catch {
      if (valid())
        publish({
          canSubmit: false,
          canCheck: false,
          outcome: 'error',
          error: 'The LangGraph request failed.',
        });
    } finally {
      finish(admitted);
    }
  }
  async function checkStatus() {
    if (disposed || snapshot.busy || !snapshot.canCheck || !lifetime) return;
    const selected = lifetime,
      state = selected.session.getSnapshot();
    if (!current(selected) || snapshot.busy || !snapshot.canCheck) return;
    const allowed = checkable(selected, state);
    if (!current(selected) || snapshot.busy || !snapshot.canCheck) return;
    if (!allowed) {
      publish({ canCheck: false });
      return;
    }
    const { admitted, valid } = admit('checking');
    try {
      if (!valid() || !current(selected)) return;
      await selected.session.checkStatus!();
      if (valid() && current(selected))
        settle(selected, () => valid() && current(selected));
    } catch {
      if (valid() && current(selected)) {
        const captured = capture(selected, () => valid() && current(selected));
        if (!captured || !valid() || !current(selected)) return;
        const canCheck = checkable(selected, captured.state);
        if (!valid() || !current(selected)) return;
        publish({
          canSubmit: false,
          canCheck,
          error: 'The saved outcome could not be confirmed.',
        });
      }
    } finally {
      finish(admitted);
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const cleanup = detach(),
      { admitted, valid } = admit('replacing');
    try {
      if (!valid()) return;
      publish({
        threadId: null,
        rows: Object.freeze([]),
        checkpoints: checkpoints(null),
        latestCheckpoint: null,
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
    const selected = lifetime,
      cleanup = detach();
    publish({
      busy: false,
      activity: 'idle',
      canSubmit: false,
      canCheck: false,
      outcome: 'aborted',
    });
    try {
      await selected?.session.stop();
    } catch {
      /* Detached commands cannot be reused. */
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
    checkStatus,
    newConversation,
    stop,
    dispose,
  };
}
