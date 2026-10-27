import type {
  AgentSession,
  CompleteOutcome,
  Message,
  ToolCall,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  captureTerminal,
  messageKey,
  toolsKey,
  copyData,
  validToolArgs,
  type ToolCallsState,
} from './authority';
import { projectToolObservations, type ToolCard } from './projection';

export interface ToolCallsSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): ToolCallsState;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface ToolCallsSnapshot {
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
  readonly observations: ReadonlyMap<string, readonly ToolCard[]>;
  readonly error: string | null;
  readonly viewGeneration: number;
}
const completed = (message: Message) => message.delivery.phase === 'complete';
const same = (left: Message, right: Message | undefined) =>
  !!right && messageKey(left) === messageKey(right);

/** Owns one conversation. Only a matching saved terminal transcript grants a follow-up. */
export function createToolCallsApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (id: string) => ToolCallsSession;
}) {
  type Turn = {
    text?: string;
    human?: Message;
    generation?: string;
    base: readonly Message[];
    positions: string[];
    completed: Map<string, string>;
    tools: Map<string, ToolCall>;
    expected?: { messages: readonly Message[]; tools: readonly ToolCall[] };
  };
  type Owner = {
    id: string;
    session: ToolCallsSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    confirmed: readonly Message[];
    confirmedTools: readonly ToolCall[];
    generations: Set<string>;
    turn?: Turn;
  };
  let owner: Owner | undefined, operation: AbortController | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let snapshot: ToolCallsSnapshot = Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    observations: new Map(),
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<ToolCallsSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function bounded(work: () => void | Promise<void>) {
    let timeout: ReturnType<typeof setTimeout>;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 2000);
      }),
    ]).finally(() => clearTimeout(timeout));
  }
  function close(selected: Owner) {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    selected.release?.();
    selected.content.dispose();
    const cleanup = bounded(() => selected.session.dispose());
    cleanups.add(cleanup);
    void cleanup.then(() => cleanups.delete(cleanup));
    return cleanup;
  }
  function detach() {
    const previous = owner;
    owner = undefined;
    return previous ? close(previous) : Promise.resolve();
  }
  function blocked() {
    publish({
      canSubmit: false,
      outcome: 'error',
      error:
        'This conversation could not be confirmed. Start a new conversation to continue.',
    });
  }
  function observe(selected: Owner, state: ToolCallsState) {
    state = copyData(state) as ToolCallsState;
    if (
      !state ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs) ||
      state.error ||
      state.status === 'error' ||
      state.subgraphs.length ||
      state.interrupts.length ||
      new Set(state.messages.map((m) => m.id)).size !== state.messages.length ||
      new Set(state.toolCalls.map((t) => t.id)).size !== state.toolCalls.length
    )
      throw new Error('Unconfirmed state');
    for (const message of state.messages) {
      if (
        !['user', 'assistant', 'tool'].includes(message.role) ||
        (message.role !== 'tool' && message.toolCallId !== undefined) ||
        (message.role !== 'assistant' && message.toolCallIds?.length) ||
        (message.role === 'tool' && !message.toolCallId) ||
        !['streaming', 'complete'].includes(message.delivery.phase) ||
        (completed(message) && message.delivery.outcome !== 'success')
      )
        throw new Error('Invalid observed message');
    }
    for (const tool of selected.confirmedTools) {
      const current = state.toolCalls.find(
        (candidate) => candidate.id === tool.id
      );
      if (
        !current ||
        current.name !== tool.name ||
        toolsKey([{ ...tool, args: current.args }]) !== toolsKey([tool]) ||
        (tool.status === 'complete' && toolsKey([current]) !== toolsKey([tool]))
      )
        throw new Error('Changed saved tool');
    }
    const turn = selected.turn,
      prefix = turn?.base ?? selected.confirmed;
    for (const tool of state.toolCalls) {
      if (
        !validToolArgs(tool) ||
        !['pending', 'complete'].includes(tool.status)
      )
        throw new Error('Unsupported tool');
      const previous = turn?.tools.get(tool.id);
      if (
        previous &&
        (toolsKey([{ ...previous, name: tool.name, args: tool.args }]) !==
          toolsKey([previous]) ||
          (previous.status === 'complete' &&
            toolsKey([previous]) !== toolsKey([tool])))
      )
        throw new Error('Changed tool identity');
      turn?.tools.set(tool.id, copyData(tool) as ToolCall);
    }
    if (
      turn &&
      [...turn.tools.keys()].some(
        (id) => !state.toolCalls.some((tool) => tool.id === id)
      )
    )
      throw new Error('Missing observed tool');
    if (
      state.messages.length < prefix.length ||
      prefix.some((message, index) => !same(message, state.messages[index]))
    )
      throw new Error('Changed prefix');
    if (!turn) {
      if (state.messages.length !== prefix.length)
        throw new Error('Unowned turn');
      return;
    }
    if (turn.expected) {
      if (
        state.messages.length !== turn.expected.messages.length ||
        turn.expected.messages.some((message, index) => {
          const current = state.messages[index];
          return (
            !same(message, current) ||
            current.delivery.phase !== 'complete' ||
            (current.delivery.generation !== message.delivery.generation &&
              current.delivery.generation !== current.id)
          );
        }) ||
        toolsKey(state.toolCalls) !== toolsKey(turn.expected.tools)
      )
        throw new Error('Changed saved evidence');
      return;
    }
    if (
      state.messages.length < turn.positions.length ||
      turn.positions.some((id, index) => state.messages[index].id !== id)
    )
      throw new Error('Changed message identity');
    turn.positions = state.messages.map((message) => message.id);
    for (const message of state.messages) {
      if (completed(message) && message.delivery.outcome !== 'success')
        throw new Error('Failed message');
      const identity = messageKey(message),
        previous = turn.completed.get(message.id);
      if (previous !== undefined && previous !== identity)
        throw new Error('Changed completed message');
      if (completed(message)) turn.completed.set(message.id, identity);
    }
    const suffix = state.messages.slice(prefix.length);
    if (suffix.length) {
      turn.generation ??= suffix[0].delivery.generation;
      if (
        !turn.generation ||
        suffix.some(
          (message) => message.delivery.generation !== turn.generation
        )
      )
        throw new Error('Foreign run generation');
    }
    if (turn.text !== undefined && suffix.length) {
      const human = suffix[0];
      if (
        human.role !== 'user' ||
        human.content !== turn.text ||
        !completed(human) ||
        human.delivery.outcome !== 'success' ||
        selected.generations.has(human.delivery.generation) ||
        (turn.human &&
          (!same(turn.human, human) ||
            turn.human.delivery.generation !== human.delivery.generation)) ||
        suffix.slice(1).some((message) => message.role === 'user')
      )
        throw new Error('Unowned human turn');
      turn.human ??= human;
    } else if (
      turn.text === undefined &&
      suffix.some((message) => message.role === 'user')
    )
      throw new Error('Unowned resumed turn');
  }
  function read(selected: Owner, valid: () => boolean) {
    if (!valid()) return;
    const state = selected.session.getSnapshot();
    if (!valid()) return;
    try {
      observe(selected, state);
    } catch {
      selected.unsafe = true;
    }
    if (!valid()) return;
    if (Array.isArray(state?.messages) && Array.isArray(state?.toolCalls)) {
      let rows: readonly MessageRow[],
        observations: ReadonlyMap<string, readonly ToolCard[]>;
      try {
        const captured = copyData(state) as ToolCallsState;
        rows = selected.content.project(captured);
        observations = projectToolObservations(
          captured.messages,
          captured.toolCalls
        );
      } catch {
        selected.unsafe = true;
        return state;
      }
      if (!valid()) return;
      publish({
        rows,
        observations,
        ...(selected.unsafe
          ? {
              canSubmit: false,
              outcome: 'error' as const,
              error:
                'This conversation could not be confirmed. Start a new conversation to continue.',
            }
          : {}),
      });
    }
    if (!valid()) return;
    if (selected.session.getSnapshot() !== state) selected.unsafe = true;
    if (!valid()) return;
    return state;
  }
  async function execute(input: { text: string }) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !input.text.trim())
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
          id,
          session,
          content: createMessageContent(),
          closed: false,
          unsafe: false,
          confirmed: [],
          confirmedTools: [],
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
      const selected = owner,
        valid = () => current() && owner === selected && !selected.closed;
      const before = read(selected, valid);
      if (!valid()) return;
      if (!before || selected.unsafe) {
        blocked();
        return;
      }
      selected.turn = {
        text: input.text,
        base: selected.confirmed,
        positions: selected.confirmed.map((message) => message.id),
        completed: new Map(
          selected.confirmed.map((message) => [message.id, messageKey(message)])
        ),
        tools: new Map(selected.confirmedTools.map((tool) => [tool.id, tool])),
      };
      // Admission and row subscribers can replace observations; recheck directly before dispatch.
      if (!valid()) return;
      const dispatch = selected.session.getSnapshot();
      if (!valid()) return;
      try {
        observe(selected, dispatch);
      } catch {
        selected.unsafe = true;
      }
      if (!valid()) return;
      const currentDispatch = selected.session.getSnapshot();
      if (!valid()) return;
      if (selected.unsafe || currentDispatch !== dispatch) {
        selected.unsafe = true;
        blocked();
        return;
      }
      const outcome = await selected.session.submit(input.text, {
        signal: admitted.signal,
      });
      if (!valid()) return;
      const live = read(selected, valid),
        turn = selected.turn;
      if (!valid()) return;
      if (
        !live ||
        selected.unsafe ||
        outcome !== 'success' ||
        live.status !== 'idle' ||
        !turn ||
        !turn.human ||
        live.messages.length <= turn.base.length ||
        live.messages.some((message) => !completed(message))
      ) {
        blocked();
        return;
      }
      turn.expected = {
        messages: copyData(live.messages) as readonly Message[],
        tools: copyData(live.toolCalls) as readonly ToolCall[],
      };
      publish({ activity: 'confirming' });
      if (!valid()) return;
      if (!read(selected, valid) || selected.unsafe) {
        if (valid()) blocked();
        return;
      }
      await selected.session.load({ signal: admitted.signal });
      if (!valid()) return;
      const saved = read(selected, valid);
      if (!valid()) return;
      const authority = saved && captureTerminal(saved, selected.id);
      if (!valid()) return;
      const currentSaved = selected.session.getSnapshot();
      if (!valid()) return;
      if (!authority || selected.unsafe || currentSaved !== saved) {
        blocked();
        return;
      }
      selected.confirmed = authority.messages;
      selected.confirmedTools = authority.tools;
      if (turn.human) selected.generations.add(turn.human.delivery.generation);
      selected.turn = undefined;
      publish({
        outcome,
        canSubmit: true,
      });
      if (!valid()) return;
      const latest = read(selected, valid);
      if (valid() && (!latest || selected.unsafe)) blocked();
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
    if (disposed || !operation || snapshot.activity === 'replacing') return;
    operation.abort();
    const admitted = new AbortController();
    operation = admitted;
    const selected = owner,
      cleanup = detach();
    publish({
      busy: true,
      activity: 'replacing',
      canSubmit: false,
      outcome: 'aborted',
      error: null,
    });
    await Promise.all([cleanup, bounded(() => selected?.session.stop())]);
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const admitted = new AbortController();
    operation = admitted;
    const cleanup = detach();
    publish({
      busy: true,
      canSubmit: false,
      activity: 'replacing',
    });
    await cleanup;
    if (disposed || operation !== admitted || admitted.signal.aborted) return;
    operation = undefined;
    publish({
      threadId: null,
      rows: Object.freeze([]),
      observations: new Map(),
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
    submit: (text: string) => execute({ text }),
    stop,
    newConversation,
    dispose,
  };
}
