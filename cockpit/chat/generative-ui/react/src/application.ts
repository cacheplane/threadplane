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
import { copyData, dataKey, type DashboardState } from './dashboard-data';
import {
  createObservation,
  messageKey,
  type GenerativeUiState,
} from './observation';
import {
  captureTerminal,
  checkpointSource,
  type Checkpoint,
  type Surface,
  type Notice,
} from './terminal';
export interface GenerativeUiSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): GenerativeUiState;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface GenerativeUiClient {
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(threadId: string): GenerativeUiSession;
  readCheckpoint(source: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
export interface GenerativeUiSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly dashboard: DashboardState;
  readonly surfaces: readonly Surface[];
  readonly notices: readonly Notice[];
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
const empty = (): GenerativeUiSnapshot =>
  Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    messages: Object.freeze([]),
    toolCalls: Object.freeze([]),
    dashboard: Object.freeze({}),
    surfaces: Object.freeze([]),
    notices: Object.freeze([]),
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
/** Own one lazy conversation and publish dashboard/layout authority atomically. */
export function createGenerativeUiApplication(options: GenerativeUiClient) {
  type Owner = {
    id: string;
    session: GenerativeUiSession;
    content: ReturnType<typeof createMessageContent>;
    closed: boolean;
    unsafe: boolean;
    release?: () => void;
    messages: readonly Message[];
    tools: readonly ToolCall[];
    observation?: ReturnType<typeof createObservation>;
    saving: boolean;
    generations: string[];
  };
  let snapshot = empty(),
    owner: Owner | undefined,
    operation: AbortController | undefined,
    disposed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  function publish(update: Partial<GenerativeUiSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of [...listeners]) notify();
  }
  function bounded(work: () => void | Promise<void>) {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]).finally(() => clearTimeout(timer));
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
        'This update could not be confirmed. The last confirmed dashboard is retained. Start a new conversation to continue.',
    });
  }
  function read(
    selected: Owner,
    valid: () => boolean
  ): GenerativeUiState | undefined {
    if (!valid()) return;
    const source = selected.session.getSnapshot();
    if (!valid()) return;
    let state: GenerativeUiState;
    try {
      state = copyData(source) as GenerativeUiState;
      if (selected.observation)
        state = selected.observation.observe(state, selected.saving);
      else if (
        !state ||
        state.error ||
        state.status !== 'idle' ||
        state.interrupts.length ||
        state.subgraphs.length ||
        state.messages.length !== selected.messages.length ||
        state.messages.some(
          (m, i) => messageKey(m) !== messageKey(selected.messages[i])
        ) ||
        dataKey(state.toolCalls) !== dataKey(selected.tools)
      )
        throw new Error('Changed confirmed state');
    } catch {
      selected.unsafe = true;
      if (valid()) blocked();
      return;
    }
    if (!valid()) return;
    const rows = selected.content.project(state);
    if (!valid()) return;
    publish({ rows, messages: state.messages, toolCalls: state.toolCalls });
    if (!valid()) return;
    if (selected.session.getSnapshot() !== source) {
      selected.unsafe = true;
      blocked();
      return;
    }
    return state;
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return false;
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
      if (!current()) return false;
      if (!owner) {
        const id = await options.createThread(admitted.signal);
        if (!current()) return false;
        if (typeof id !== 'string' || !id)
          throw new Error('Unconfirmed thread');
        const session = options.sessionFactory(id),
          selected: Owner = {
            id,
            session,
            content: createMessageContent(),
            closed: false,
            unsafe: false,
            messages: [],
            tools: [],
            saving: false,
            generations: [],
          };
        if (!current()) {
          void close(selected);
          return false;
        }
        owner = selected;
        const release = session.subscribe(() => {
          if (owner === selected && !selected.closed && !disposed)
            read(
              selected,
              () =>
                owner === selected &&
                !selected.closed &&
                !disposed &&
                !operation?.signal.aborted
            );
        });
        selected.release = release;
        if (selected.closed) release();
        if (!current()) return false;
        publish({ threadId: id, activity: 'running' });
      }
      const selected = owner,
        valid = () => current() && owner === selected && !selected.closed;
      if (!read(selected, valid) || !valid() || selected.unsafe) {
        if (valid()) blocked();
        return false;
      }
      selected.observation = createObservation(
        text,
        selected.messages,
        selected.tools,
        selected.generations
      );
      selected.saving = false;
      if (!read(selected, valid) || !valid() || selected.unsafe) return false;
      const outcome = await selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!valid()) return false;
      const live = read(selected, valid);
      if (!valid()) return false;
      if (
        !live ||
        selected.unsafe ||
        outcome !== 'success' ||
        live.status !== 'idle' ||
        !selected.observation.human ||
        live.messages.some((m) => m.delivery.phase !== 'complete')
      ) {
        blocked();
        return false;
      }
      publish({ activity: 'confirming' });
      if (!valid()) return false;
      selected.saving = true;
      await selected.session.load({ signal: admitted.signal });
      if (!valid()) return false;
      const saved = read(selected, valid);
      if (!valid()) return false;
      const checkpoint =
        saved && checkpointSource(saved.history?.[0]?.checkpoint, selected.id);
      if (!saved || selected.unsafe || !checkpoint) {
        blocked();
        return false;
      }
      const raw = await options.readCheckpoint(checkpoint, admitted.signal);
      if (!valid()) return false;
      const latest = read(selected, valid);
      if (!valid()) return false;
      const confirmed =
        latest &&
        captureTerminal(
          latest,
          raw,
          selected.id,
          selected.observation,
          snapshot.dashboard,
          snapshot.surfaces
        );
      if (!confirmed || selected.unsafe) {
        blocked();
        return false;
      }
      selected.messages = confirmed.messages;
      selected.tools = confirmed.tools;
      const generation = selected.observation.human?.delivery.generation;
      if (generation) selected.generations.push(generation);
      selected.observation = undefined;
      selected.saving = false;
      publish({
        dashboard: confirmed.dashboard,
        surfaces: confirmed.surfaces,
        notices: Object.freeze([...snapshot.notices, ...confirmed.notices]),
        outcome: 'success',
        canSubmit: true,
      });
      if (valid()) read(selected, valid);
      return true;
    } catch {
      if (current()) blocked();
      return false;
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
    const admitted = new AbortController();
    operation = admitted;
    const selected = owner,
      cleanup = detach();
    if (!disposed && operation === admitted)
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
    if (disposed) return;
    operation?.abort();
    const admitted = new AbortController();
    operation = admitted;
    const cleanup = detach();
    if (!disposed && operation === admitted)
      publish({
        ...empty(),
        viewGeneration: snapshot.viewGeneration + 1,
        busy: true,
        canSubmit: false,
        activity: 'replacing',
      });
    await cleanup;
    if (disposed || operation !== admitted) return;
    operation = undefined;
    publish({ busy: false, canSubmit: true, activity: 'idle' });
  }
  function dispose() {
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
