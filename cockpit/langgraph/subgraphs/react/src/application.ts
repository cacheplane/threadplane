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

interface Child {
  readonly namespace: readonly string[];
  readonly messages: readonly Message[];
  readonly values?: Readonly<Record<string, unknown>>;
  readonly interrupts: readonly { readonly value?: unknown }[];
  readonly error?: AgentSnapshot['error'];
}
export interface SubgraphsSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly interrupts: readonly { readonly value?: unknown }[];
    readonly subgraphs: readonly Child[];
  };
}
export interface SubgraphsSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly route: 'awaiting' | 'direct' | 'nested' | 'unconfirmed';
  readonly topic: string | null;
  readonly brief: string | null;
  readonly children: readonly { readonly namespace: readonly string[] }[];
  readonly activity: 'idle' | 'creating' | 'running' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
function own(
  values: Readonly<Record<string, unknown>> | undefined,
  key: string
) {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}
function unexpectedTool(message: Message) {
  return (
    message.role === 'tool' ||
    message.toolCallId !== undefined ||
    !!message.toolCallIds?.length
  );
}
/** Owns parent conversation commands. Child observations never confer commands. */
export function createSubgraphsApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => SubgraphsSession;
}) {
  type ObservedChild = {
    namespace: readonly string[];
    topic: unknown;
    brief: unknown;
  };
  type Lifetime = {
    session: SubgraphsSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    turn?: { id: string; generation: string };
    previousIds: ReadonlySet<string>;
    previousNamespaces: ReadonlySet<string>;
    children: Map<string, ObservedChild>;
    confirmed: readonly Message[];
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let snapshot: SubgraphsSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    route: 'awaiting',
    topic: null,
    brief: null,
    children: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  let lifetime: Lifetime | undefined, operation: AbortController | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  function publish(update: Partial<SubgraphsSnapshot>) {
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
  function read(selected: Lifetime, valid: () => boolean) {
    if (!valid()) return;
    const root = selected.session.getSnapshot();
    if (!valid()) return;
    // Capture external aggregate fields once before any application mutation.
    const state = {
      status: root.status,
      error: root.error,
      messages: root.messages,
      toolCalls: root.toolCalls,
      interrupts: root.interrupts,
      subgraphs: root.subgraphs,
      values: root.values,
    };
    if (!valid()) return;
    const children = state.subgraphs.map((child) => ({
      namespace: child.namespace,
      messages: child.messages,
      values: child.values,
      interrupts: child.interrupts,
      error: child.error,
    }));
    const blocked =
      !!state.error ||
      !!state.interrupts.length ||
      !!state.toolCalls.length ||
      state.messages.some(unexpectedTool) ||
      children.some(
        (child) =>
          !!child.error ||
          !!child.interrupts.length ||
          child.messages.some(unexpectedTool)
      );
    if (!valid()) return;
    return { ...state, subgraphs: children, blocked };
  }
  function capture(selected: Lifetime, valid: () => boolean) {
    const state = read(selected, valid);
    if (!state || !valid()) return;
    selected.unsafe ||= state.blocked;
    if (!selected.turn && snapshot.activity === 'running') {
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
    const turn = selected.turn;
    if (turn && snapshot.activity === 'running') {
      for (const child of state.subgraphs) {
        const namespace = child.namespace;
        const wellFormed =
          Array.isArray(namespace) &&
          namespace.length > 0 &&
          namespace.every(
            (segment) => typeof segment === 'string' && segment.length > 0
          );
        if (!valid()) return;
        if (!wellFormed) {
          selected.unsafe = true;
          continue;
        }
        const key = JSON.stringify(namespace);
        if (selected.previousNamespaces.has(key)) continue;
        const topic = own(child.values, 'research_topic'),
          brief = own(child.values, 'research_brief');
        if (!valid()) return;
        if (
          child.values !== undefined &&
          (typeof topic !== 'string' || typeof brief !== 'string')
        )
          selected.unsafe = true;
        selected.children.set(
          key,
          Object.freeze({
            namespace: Object.freeze([...namespace]),
            topic,
            brief,
          })
        );
      }
    }
    const humanId = own(state.values, 'completed_turn_id'),
      answerId = own(state.values, 'completed_answer_id');
    const topic = own(state.values, 'research_topic'),
      brief = own(state.values, 'research_brief');
    if (!valid()) return;
    let final: readonly Message[] | undefined,
      route: 'direct' | 'nested' | undefined;
    if (
      turn &&
      !selected.unsafe &&
      state.status === 'idle' &&
      humanId === turn.id &&
      typeof answerId === 'string' &&
      answerId.length > 0 &&
      answerId !== turn.id &&
      typeof topic === 'string' &&
      typeof brief === 'string'
    ) {
      const humans = state.messages.filter((message) => message.id === turn.id);
      const answers = state.messages.filter(
        (message) => message.id === answerId
      );
      if (
        humans.length === 1 &&
        answers.length === 1 &&
        humans[0].role === 'user' &&
        answers[0].role === 'assistant' &&
        [humans[0], answers[0]].every(
          (message) =>
            message.delivery.generation === turn.generation &&
            message.delivery.phase === 'complete' &&
            message.delivery.outcome === 'success'
        )
      ) {
        const children = [...selected.children.values()];
        if (topic === '' && brief === '' && children.length === 0)
          route = 'direct';
        else if (
          topic.length > 0 &&
          brief.length > 0 &&
          children.length > 0 &&
          children.every(
            (child) => child.topic === topic && child.brief === brief
          )
        )
          route = 'nested';
        if (route) final = [humans[0], answers[0]];
      }
    }
    if (!valid()) return;
    const confirmedIds = new Set(
      selected.confirmed.map((message) => message.id)
    );
    const active = turn
      ? state.messages.filter(
          (message) =>
            !confirmedIds.has(message.id) &&
            message.delivery.generation === turn.generation
        )
      : [];
    const finalIds = final && new Set(final.map((message) => message.id));
    const messages = final
      ? [
          ...selected.confirmed.filter((message) => !finalIds!.has(message.id)),
          ...final,
        ]
      : [...selected.confirmed, ...active];
    const rows = selected.content.project({ ...state, messages });
    if (!valid()) return;
    const children = Object.freeze(
      [...selected.children.values()].map((child) =>
        Object.freeze({ namespace: child.namespace })
      )
    );
    return {
      state,
      rows,
      route,
      topic: typeof topic === 'string' ? topic : null,
      brief: typeof brief === 'string' ? brief : null,
      messages,
      children,
    };
  }
  function observe(selected: Lifetime) {
    const valid = () => current(selected),
      captured = capture(selected, valid);
    if (!captured || !valid()) return;
    publish({
      rows: captured.rows,
      children: captured.children,
      ...(captured.route
        ? {
            route: captured.route,
            topic: captured.topic,
            brief: captured.brief,
          }
        : {}),
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
      previousNamespaces: new Set(),
      children: new Map(),
      confirmed: [],
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
  function admit(activity: SubgraphsSnapshot['activity']) {
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity,
      outcome: null,
      error: null,
      route: 'awaiting',
      topic: null,
      brief: null,
      children: Object.freeze([]),
    });
    return { admitted, valid };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const previous = lifetime;
    const initialValid = () =>
      !disposed &&
      !snapshot.busy &&
      snapshot.canSubmit &&
      lifetime === previous &&
      !previous?.closed;
    const before = previous && read(previous, initialValid);
    if (!initialValid()) return;
    if (previous && (previous.unsafe || before?.blocked)) {
      publish({ canSubmit: false });
      return;
    }
    if (previous && before) {
      const previousIds = new Set(
        before.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id)
      );
      const previousNamespaces = new Set(
        before.subgraphs.map((child) => JSON.stringify(child.namespace))
      );
      if (!initialValid()) return;
      // Reentrant observers of admission must not reuse the preceding turn.
      previous.turn = undefined;
      previous.previousIds = previousIds;
      previous.previousNamespaces = previousNamespaces;
      previous.children = new Map();
    }
    const { admitted, valid } = admit(lifetime ? 'running' : 'creating');
    try {
      if (!valid()) return;
      publish({
        route: 'awaiting',
        topic: null,
        brief: null,
        children: Object.freeze([]),
      });
      if (!valid()) return;
      if (!lifetime) {
        const id = await options.createThread(admitted.signal);
        if (!valid()) return;
        const selected = install(id, valid);
        if (!selected || !valid()) return;
        publish({ threadId: id, activity: 'running' });
      }
      if (!valid() || !lifetime) return;
      const selected = lifetime,
        ownedValid = () => valid() && current(selected);
      const state = read(selected, ownedValid);
      if (!state || !ownedValid()) return;
      if (state.blocked) {
        selected.unsafe = true;
        publish({ canSubmit: false });
        return;
      }
      selected.turn = undefined;
      selected.previousIds = new Set(
        state.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id)
      );
      selected.previousNamespaces = new Set(
        state.subgraphs.map((child) => JSON.stringify(child.namespace))
      );
      selected.children = new Map();
      if (!ownedValid()) return;
      const pending = selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!ownedValid()) return;
      observe(selected);
      const outcome = await pending;
      if (!ownedValid()) return;
      const captured = capture(selected, ownedValid);
      if (!captured || !ownedValid()) return;
      const safe =
        outcome === 'success' && !!captured.route && !selected.unsafe;
      if (safe) selected.confirmed = Object.freeze(captured.messages);
      publish({
        rows: captured.rows,
        children: captured.children,
        outcome,
        canSubmit: safe,
        route: safe ? captured.route! : 'unconfirmed',
        topic: safe ? captured.topic : null,
        brief: safe ? captured.brief : null,
        error: safe ? null : 'The current route could not be confirmed.',
      });
    } catch {
      if (valid())
        publish({
          canSubmit: false,
          route: 'unconfirmed',
          outcome: 'error',
          error: 'The LangGraph request failed.',
        });
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
        route: 'awaiting',
        topic: null,
        brief: null,
        children: Object.freeze([]),
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
      route: 'unconfirmed',
      outcome: 'aborted',
    });
    try {
      await selected?.session.stop();
    } catch {
      /* Detached observations cannot grant authority. */
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
    newConversation,
    stop,
    dispose,
  };
}
