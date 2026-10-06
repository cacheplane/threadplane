import type { CompleteOutcome, Message } from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import type { ThreadsClient, ThreadsSession } from './connection';
import { ConversationRecords, type ConversationRecord } from './records';
export interface ThreadsSnapshot {
  readonly confirmation: 'saved' | 'loaded' | null;
  readonly selectedKey: string;
  readonly threadId: string | null;
  readonly conversations: readonly ConversationRecord[];
  readonly rows: readonly MessageRow[];
  readonly draft: string;
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'loading'
    | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
import {
  captureTerminal,
  copyData,
  messageKey,
  type ThreadsState,
} from './authority';
import { decodeTitle } from './titles';

/** Own page-local records and one selected session; only matching saved evidence permits continuation. */
export function createThreadsApplication(options: ThreadsClient) {
  type Turn = {
    text: string;
    base: readonly Message[];
    generation?: string;
    positions: string[];
    completed: Map<string, string>;
    expected?: readonly Message[];
  };
  type Owner = {
    key: string;
    session: ThreadsSession;
    content: ReturnType<typeof createMessageContent>;
    closed: boolean;
    unsafe: boolean;
    release?: () => void;
    selecting: boolean;
    turn?: Turn;
  };
  type TitleRead = {
    key: string;
    version: number;
    view: number;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  };
  const records = new ConversationRecords(),
    listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let key = records.create().key,
    owner: Owner | undefined,
    operation: AbortController | undefined,
    titleRead: TitleRead | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: ThreadsSnapshot = Object.freeze({
    selectedKey: key,
    threadId: null,
    conversations: Object.freeze([]),
    rows: Object.freeze([]),
    draft: '',
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
    confirmation: null,
  });
  function publish(update: Partial<ThreadsSnapshot> = {}) {
    if (disposed) return;
    const record = records.get(key);
    if (!record) return;
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      selectedKey: key,
      threadId: record.threadId,
      draft: record.draft,
      conversations: Object.freeze(
        records.list().filter((r) => r.threadId !== null)
      ),
    });
    for (const notify of [...listeners]) {
      if (disposed) break;
      notify();
    }
  }
  function bounded(work: () => void | Promise<void>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
  function close(selected: Owner): Promise<void> {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    try {
      selected.release?.();
    } catch {
      /* A failed unsubscribe cannot restore ownership. */
    }
    try {
      selected.content.dispose();
    } catch {
      /* Cleanup must still dispose the session. */
    }
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
  function cancelTitle() {
    const previous = titleRead;
    titleRead = undefined;
    if (records.get(key)) records.invalidate(key);
    if (previous) {
      clearTimeout(previous.timer);
      previous.controller.abort();
    }
  }
  function startTitle(selected: Owner) {
    const record = records.get(selected.key);
    if (
      disposed ||
      owner !== selected ||
      selected.closed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      !record?.threadId ||
      record.availability !== 'available'
    )
      return;
    const controller = new AbortController(),
      version = records.invalidate(selected.key),
      view = snapshot.viewGeneration;
    const pending: TitleRead = {
      key: selected.key,
      version,
      view,
      controller,
      timer: setTimeout(() => {
        if (titleRead === pending) {
          titleRead = undefined;
          controller.abort();
        }
      }, 5000),
    };
    titleRead = pending;
    const current = () =>
      !disposed &&
      titleRead === pending &&
      !controller.signal.aborted &&
      owner === selected &&
      !selected.closed &&
      key === pending.key &&
      snapshot.viewGeneration === view &&
      records.get(key)?.version === version;
    void Promise.resolve()
      .then(async () => {
        if (!current()) return;
        const raw = await options.readTitle(
          record.threadId as string,
          controller.signal
        );
        if (!current()) return;
        const title = decodeTitle(raw, record.threadId as string);
        if (!current()) return;
        if (title !== undefined && records.setTitle(key, title, version))
          publish();
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(pending.timer);
        if (titleRead === pending) titleRead = undefined;
      });
  }
  function block(selected?: Owner) {
    if (selected) selected.unsafe = true;
    records.markUnavailable(key);
    publish({
      canSubmit: false,
      outcome: 'error',
      confirmation: null,
      error:
        'This conversation could not be confirmed. Choose another conversation or start a new one.',
    });
  }
  const complete = (message: Message) =>
    message.delivery.phase === 'complete' &&
    message.delivery.outcome === 'success';
  const same = (left: Message, right: Message | undefined) =>
    !!right && messageKey(left) === messageKey(right);
  function inspect(selected: Owner, state: ThreadsState) {
    if (
      !state ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs) ||
      state.error ||
      state.status === 'error' ||
      state.toolCalls.length ||
      state.interrupts.length ||
      state.subgraphs.length ||
      new Set(state.messages.map((m) => m.id)).size !== state.messages.length
    )
      throw new Error('Unsupported conversation');
    for (const m of state.messages)
      if (
        typeof m.id !== 'string' ||
        !m.id.trim() ||
        typeof m.content !== 'string' ||
        !['user', 'assistant'].includes(m.role) ||
        m.toolCallId !== undefined ||
        (m.toolCallIds !== undefined &&
          (!Array.isArray(m.toolCallIds) || m.toolCallIds.length)) ||
        !['streaming', 'complete'].includes(m.delivery.phase) ||
        (m.delivery.phase === 'complete' && !complete(m))
      )
        throw new Error('Invalid message');
    const record = records.get(selected.key);
    if (!record) throw new Error('Unknown conversation');
    const prefix = record.canonical?.messages ?? [],
      turn = selected.turn;
    if (selected.selecting && state.messages.length === 0) return;
    if (
      state.messages.length < prefix.length ||
      prefix.some(
        (m, i) => !same(m, state.messages[i]) || !complete(state.messages[i])
      )
    )
      throw new Error('Changed saved prefix');
    if (!turn) {
      if (state.messages.length !== prefix.length)
        throw new Error('Unowned turn');
      if (!selected.selecting && record.canonical) {
        const canonical = captureTerminal(state, record.threadId ?? '');
        if (!canonical || canonical.signature !== record.canonical.signature)
          throw new Error('Changed idle saved authority');
      }
      return;
    }
    if (turn.expected) {
      if (
        state.messages.length !== turn.expected.length ||
        turn.expected.some(
          (m, i) =>
            !same(m, state.messages[i]) ||
            !complete(state.messages[i]) ||
            (state.messages[i].delivery.generation !== m.delivery.generation &&
              state.messages[i].delivery.generation !== state.messages[i].id)
        )
      )
        throw new Error('Changed saved response');
      return;
    }
    if (
      state.messages.length < turn.positions.length ||
      turn.positions.some((id, i) => state.messages[i].id !== id)
    )
      throw new Error('Changed message position');
    turn.positions = state.messages.map((m) => m.id);
    for (const m of state.messages) {
      const identity = messageKey(m),
        previous = turn.completed.get(m.id);
      if (previous !== undefined && previous !== identity)
        throw new Error('Changed completed message');
      if (complete(m)) turn.completed.set(m.id, identity);
    }
    const suffix = state.messages.slice(prefix.length);
    if (!suffix.length) return;
    const human = suffix[0];
    turn.generation ??= human.delivery.generation;
    if (
      suffix.length > 2 ||
      human.role !== 'user' ||
      human.content !== turn.text ||
      !complete(human) ||
      !turn.generation ||
      record.generations.includes(turn.generation) ||
      suffix.some((m) => m.delivery.generation !== turn.generation) ||
      suffix.some((m) => prefix.some((p) => p.id === m.id)) ||
      (suffix[1] && suffix[1].role !== 'assistant')
    )
      throw new Error('Foreign or changed live turn');
  }
  function read(
    selected: Owner,
    current: () => boolean
  ): ThreadsState | undefined {
    if (!current()) return;
    try {
      const raw = selected.session.getSnapshot();
      if (!current()) return;
      const state = copyData(raw) as ThreadsState;
      if (!current()) return;
      inspect(selected, state);
      if (!current()) return;
      const rows = selected.content.project(state);
      if (!current()) return;
      publish({ rows, ...(selected.unsafe ? { canSubmit: false } : {}) });
      if (!current()) return;
      const latest = selected.session.getSnapshot();
      if (!current()) return;
      if (latest !== raw) {
        block(selected);
        return;
      }
      return state;
    } catch {
      if (current()) block(selected);
      return;
    }
  }
  function install(
    id: string,
    selecting: boolean,
    current: () => boolean
  ): Owner | undefined {
    const session = options.sessionFactory(id),
      selected: Owner = {
        key,
        session,
        selecting,
        content: createMessageContent(),
        closed: false,
        unsafe: false,
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
          selected.key === key &&
          !operation?.signal.aborted
      )
    );
    selected.release = release;
    if (selected.closed) release();
    if (!current() || owner !== selected) {
      void close(selected);
      return;
    }
    return selected;
  }
  function admit(activity: ThreadsSnapshot['activity']) {
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      activity,
      busy: true,
      canSubmit: false,
      error: null,
      outcome: null,
      confirmation: null,
    });
    if (current()) cancelTitle();
    return { admitted, current };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ activity: 'idle', busy: false });
    }
  }
  async function submit(text: string) {
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      typeof text !== 'string' ||
      !text.trim()
    )
      return;
    records.setDraft(key, '');
    const { admitted, current } = admit(owner ? 'running' : 'creating');
    let succeeded: Owner | undefined;
    try {
      if (!current()) return;
      if (!owner) {
        const id = await options.createThread(admitted.signal);
        if (!current()) return;
        records.confirmThread(key, id);
        const selected = install(id, false, current);
        if (!selected || !current()) return;
        publish({ activity: 'running' });
      }
      const selected = owner;
      if (!selected || !current()) return;
      const valid = () =>
        current() &&
        owner === selected &&
        !selected.closed &&
        selected.key === key;
      const before = read(selected, valid);
      if (!valid()) return;
      if (!before || selected.unsafe || before.status !== 'idle') {
        block(selected);
        return;
      }
      selected.turn = {
        text,
        base: records.get(key)?.canonical?.messages ?? [],
        positions: before.messages.map((m) => m.id),
        completed: new Map(),
      };
      const result = await selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!valid()) return;
      const live = read(selected, valid);
      if (!valid()) return;
      const turn = selected.turn;
      if (
        result !== 'success' ||
        !live ||
        selected.unsafe ||
        live.status !== 'idle' ||
        !turn.generation ||
        live.messages.length !== turn.base.length + 2 ||
        live.messages.some((m) => !complete(m))
      ) {
        block(selected);
        return;
      }
      turn.expected = live.messages;
      publish({ activity: 'confirming' });
      if (!valid()) return;
      if (!read(selected, valid) || selected.unsafe) {
        if (valid()) block(selected);
        return;
      }
      if (!valid()) return;
      await selected.session.load({ signal: admitted.signal });
      if (!valid()) return;
      const saved = read(selected, valid);
      if (!valid()) return;
      const canonical = saved
        ? captureTerminal(saved, records.get(key)?.threadId ?? '')
        : null;
      if (!valid()) return;
      if (
        !canonical ||
        selected.unsafe ||
        canonical.messages.length !== turn.expected.length ||
        turn.expected.some((m, i) => !same(m, canonical.messages[i]))
      ) {
        block(selected);
        return;
      }
      records.confirm(key, canonical, turn.generation);
      selected.turn = undefined;
      publish({ canSubmit: true, outcome: 'success', confirmation: 'saved' });
      if (valid()) succeeded = selected;
    } catch {
      if (current()) block(owner);
    } finally {
      finish(admitted);
      if (succeeded) startTitle(succeeded);
    }
  }
  async function select(nextKey: string) {
    const next = records.get(nextKey);
    if (
      disposed ||
      snapshot.busy ||
      nextKey === key ||
      !next?.threadId ||
      !next.canonical ||
      next.availability !== 'available'
    )
      return;
    const { admitted, current } = admit('loading');
    let succeeded: Owner | undefined;
    try {
      if (!current()) return;
      const cleanup = detach();
      if (!current()) return;
      key = nextKey;
      publish({
        rows: Object.freeze([]),
        viewGeneration: snapshot.viewGeneration + 1,
      });
      if (!current()) return;
      await cleanup;
      if (!current()) return;
      const selected = install(next.threadId, true, current);
      if (!selected || !current()) return;
      const valid = () =>
        current() &&
        owner === selected &&
        !selected.closed &&
        key === selected.key;
      await selected.session.load({ signal: admitted.signal });
      if (!valid()) return;
      const state = read(selected, valid);
      if (!valid()) return;
      const canonical = state ? captureTerminal(state, next.threadId) : null;
      if (!valid()) return;
      if (
        !canonical ||
        selected.unsafe ||
        canonical.signature !== next.canonical.signature
      ) {
        block(selected);
        return;
      }
      selected.selecting = false;
      publish({ canSubmit: true, outcome: 'success', confirmation: 'loaded' });
      if (valid()) succeeded = selected;
    } catch {
      if (current()) block(owner);
    } finally {
      finish(admitted);
      if (succeeded) startTitle(succeeded);
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const { admitted, current } = admit('replacing');
    try {
      if (!current()) return;
      const cleanup = detach();
      if (!current()) return;
      await cleanup;
      if (!current()) return;
      key = records.create().key;
      publish({
        rows: Object.freeze([]),
        viewGeneration: snapshot.viewGeneration + 1,
        canSubmit: true,
        outcome: null,
        error: null,
        confirmation: null,
      });
    } finally {
      finish(admitted);
    }
  }
  async function stop() {
    if (disposed) return;
    const previous = operation;
    if (!previous) {
      cancelTitle();
      return;
    }
    const stopped = new AbortController();
    operation = stopped;
    previous.abort();
    cancelTitle();
    const selected = owner,
      cleanup = detach();
    records.markUnavailable(key);
    publish({
      busy: true,
      activity: 'replacing',
      canSubmit: false,
      outcome: 'aborted',
      error: null,
      confirmation: null,
    });
    await Promise.all([cleanup, bounded(() => selected?.session.stop())]);
    finish(stopped);
  }
  function setDraft(view: number, text: string) {
    if (
      disposed ||
      view !== snapshot.viewGeneration ||
      snapshot.activity === 'loading' ||
      snapshot.activity === 'replacing' ||
      records.get(key)?.availability !== 'available'
    )
      return;
    records.setDraft(key, text);
    publish();
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    const previous = operation;
    operation = undefined;
    previous?.abort();
    cancelTitle();
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
    setDraft,
    submit,
    select,
    newConversation,
    stop,
    dispose,
  };
}
