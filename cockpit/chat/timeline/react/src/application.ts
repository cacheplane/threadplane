import type { CompleteOutcome, Message } from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  captureTurn,
  confirmCanonicalHistory,
  type OwnedTurn,
} from './authority';
import {
  captureHistoryPage,
  copyData,
  type CheckpointRow,
  type ForkSource,
} from './checkpoints';
import { capturePreview, type Preview } from './preview';
import type {
  TimelineClient,
  TimelineSession,
  TimelineState,
} from './connection';
export interface TimelineSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly previewRows: readonly MessageRow[];
  readonly historyPage: readonly CheckpointRow[] | undefined;
  readonly selectedSource: ForkSource | null;
  readonly draft: string;
  readonly activity: 'idle' | 'creating' | 'running' | 'replacing';
  readonly busy: boolean;
  readonly readingHistory: boolean;
  readonly readingPreview: boolean;
  readonly canSubmit: boolean;
  readonly canRefresh: boolean;
  readonly canFork: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly historyError: string | null;
  readonly previewError: string | null;
  readonly viewGeneration: number;
}
/** Execution, metadata reads and checkpoint previews have independent lifetimes. */
export function createTimelineApplication(options: TimelineClient) {
  type Owner = {
    session: TimelineSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    confirmed: readonly Message[];
    proof?: OwnedTurn;
    admission?: {
      input: string;
      prefix: readonly Message[];
      generations: Set<string>;
      turn?: OwnedTurn;
    };
  };
  type Read = { controller: AbortController; owner?: Owner };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Owner | undefined,
    execution: AbortController | undefined,
    historyRead: Read | undefined,
    previewRead: Read | undefined;
  let preview: Preview | null = null,
    previewContent: ReturnType<typeof createMessageContent> | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: TimelineSnapshot = Object.freeze({
    threadId: null,
    rows: [],
    previewRows: [],
    historyPage: undefined,
    selectedSource: null,
    draft: '',
    activity: 'idle',
    busy: false,
    readingHistory: false,
    readingPreview: false,
    canSubmit: true,
    canRefresh: false,
    canFork: false,
    outcome: null,
    error: null,
    historyError: null,
    previewError: null,
    viewGeneration: 0,
  });
  function publish(
    update: Partial<TimelineSnapshot> = {},
    notifyListeners = true
  ) {
    if (disposed) return;
    const next = { ...snapshot, ...update };
    snapshot = Object.freeze({
      ...next,
      canRefresh: !!next.threadId && !next.busy && next.canSubmit,
      canFork:
        !!preview && !next.busy && next.canSubmit && !next.readingPreview,
    });
    if (!notifyListeners) return;
    for (const notify of [...listeners]) {
      if (disposed) break;
      notify();
    }
  }
  function bounded(work: () => void | Promise<void>): Promise<void> {
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
  function close(owner: Owner) {
    if (owner.closed) return Promise.resolve();
    owner.closed = true;
    // Register retirement before unsubscribe/content cleanup can call back into commands.
    const pending = track(() => owner.session.dispose());
    try {
      owner.release?.();
    } catch {
      /* Ownership is already revoked. */
    }
    try {
      owner.content.dispose();
    } catch {
      /* Session cleanup still runs. */
    }
    return pending;
  }
  function track(work: () => void | Promise<void>) {
    const pending = bounded(work);
    cleanups.add(pending);
    void pending.then(() => cleanups.delete(pending));
    return pending;
  }
  function cancelHistory(notifyListeners = true) {
    const read = historyRead;
    historyRead = undefined;
    read?.controller.abort();
    if (read?.owner) void close(read.owner);
    publish({ readingHistory: false }, notifyListeners);
  }
  function clearPreview() {
    preview = null;
    previewContent?.dispose();
    previewContent = undefined;
  }
  function cancelPreview(notifyListeners = true) {
    const read = previewRead;
    previewRead = undefined;
    read?.controller.abort();
    clearPreview();
    publish(
      {
        readingPreview: false,
        selectedSource: null,
        previewRows: [],
        previewError: null,
      },
      notifyListeners
    );
  }
  function unsafe(state: TimelineState) {
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
      !!state.subgraphs.length
    );
  }
  function block(owner?: Owner) {
    if (owner) owner.unsafe = true;
    publish({
      canSubmit: false,
      outcome: 'error',
      error:
        'The current conversation could not be confirmed. Start a new conversation.',
    });
  }
  function observe(owner: Owner): TimelineState | undefined {
    if (disposed || primary !== owner || owner.closed) return;
    try {
      const raw = owner.session.getSnapshot(),
        state = copyData(raw) as TimelineState;
      if (unsafe(state)) throw new Error('Unsafe session');
      const admission = owner.admission;
      if (admission && !admission.turn)
        admission.turn = captureTurn(
          state.messages,
          admission.generations,
          admission.prefix,
          admission.input
        );
      const visible = admission
        ? [
            ...admission.prefix,
            ...(admission.turn
              ? state.messages.filter(
                  (message) =>
                    message.delivery.generation === admission.turn!.generation
                )
              : []),
          ]
        : owner.confirmed;
      const rows = owner.content.project({ ...state, messages: visible });
      if (disposed || primary !== owner || owner.closed) return;
      publish({ rows });
      if (disposed || primary !== owner || owner.closed) return;
      if (owner.session.getSnapshot() !== raw)
        throw new Error('Snapshot changed during observation');
      return state;
    } catch {
      if (!disposed && primary === owner && !owner.closed) block(owner);
      return;
    }
  }
  function makeOwner(id: string): Owner {
    return {
      session: options.sessionFactory(id),
      content: createMessageContent(),
      closed: false,
      unsafe: false,
      confirmed: [],
    };
  }
  async function execute(input: string, selected: Preview | null) {
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      typeof input !== 'string' ||
      !input.trim()
    )
      return;
    const controller = new AbortController();
    execution = controller;
    const current = () =>
      !disposed && execution === controller && !controller.signal.aborted;
    // Capture authority before publication can synchronously trigger another command.
    const prefix = selected?.messages ?? primary?.confirmed ?? [],
      source = selected?.source;
    publish({
      busy: true,
      activity: primary ? 'running' : 'creating',
      draft: '',
      error: null,
      outcome: null,
    });
    if (!current()) return;
    cancelHistory(false);
    // A completed preview survives Send; a pending preview has no validated authority.
    if (previewRead) cancelPreview(false);
    try {
      if (!current()) return;
      if (!primary) {
        const id = await options.createThread(controller.signal);
        if (!current()) return;
        const owner = makeOwner(id);
        if (!current()) {
          void close(owner);
          return;
        }
        primary = owner;
        owner.release = owner.session.subscribe(() => observe(owner));
        if (owner.closed) owner.release();
        if (!current()) return;
        publish({ threadId: id, activity: 'running' });
      }
      const owner = primary;
      if (!owner || !current()) return;
      const valid = () => current() && primary === owner && !owner.closed;
      const before = observe(owner);
      if (!valid()) return;
      if (
        !before ||
        (!owner.proof && before.messages.length > 0) ||
        owner.unsafe ||
        before.status !== 'idle' ||
        (owner.proof &&
          !confirmCanonicalHistory(before.messages, before.values, owner.proof))
      ) {
        block(owner);
        return;
      }
      owner.admission = {
        input,
        prefix,
        generations: new Set(before.messages.map((m) => m.delivery.generation)),
      };
      const pending = source
        ? owner.session.fork(source, input, { signal: controller.signal })
        : owner.session.submit(input, { signal: controller.signal });
      void pending.catch(() => undefined);
      if (valid()) observe(owner);
      const outcome = await pending;
      if (!valid()) return;
      const terminal = observe(owner);
      if (!valid()) return;
      const turn = owner.admission?.turn;
      const canonical =
        terminal && terminal.status === 'idle' && !unsafe(terminal) && turn
          ? confirmCanonicalHistory(terminal.messages, terminal.values, turn)
          : undefined;
      if (outcome !== 'success' || owner.unsafe || !canonical) {
        block(owner);
        return;
      }
      owner.confirmed = canonical;
      owner.proof = turn;
      owner.admission = undefined;
      const rows = owner.content.project({ ...terminal!, messages: canonical });
      if (source) cancelPreview(false);
      if (valid())
        publish({ rows, canSubmit: true, outcome: 'success', error: null });
    } catch {
      if (current()) block(primary);
    } finally {
      if (current()) {
        execution = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function refreshHistory() {
    if (disposed || !snapshot.canRefresh || !snapshot.threadId) return;
    cancelHistory(false);
    cancelPreview(false);
    const id = snapshot.threadId,
      read: Read = { controller: new AbortController() };
    historyRead = read;
    const current = () =>
      !disposed &&
      historyRead === read &&
      !read.controller.signal.aborted &&
      snapshot.threadId === id;
    publish({
      readingHistory: true,
      historyError: null,
      historyPage: undefined,
    });
    try {
      if (!current()) return;
      const owner = makeOwner(id);
      read.owner = owner;
      if (!current()) {
        void close(owner);
        return;
      }
      await owner.session.load({ signal: read.controller.signal });
      if (!current()) return;
      const state = copyData(owner.session.getSnapshot()) as TimelineState;
      const page = captureHistoryPage(state.history, id);
      if (!current()) return;
      if (!page) throw new Error('Unavailable history');
      publish({ historyPage: page });
    } catch {
      if (current())
        publish({ historyError: 'Checkpoint history is unavailable.' });
    } finally {
      if (read.owner) void close(read.owner);
      if (current()) {
        historyRead = undefined;
        publish({ readingHistory: false });
      }
    }
  }
  async function selectCheckpoint(index: number) {
    if (
      disposed ||
      snapshot.busy ||
      snapshot.readingHistory ||
      !snapshot.canSubmit
    )
      return;
    const source = snapshot.historyPage?.[index]?.source;
    if (!source) return;
    cancelPreview(false);
    const read: Read = { controller: new AbortController() };
    previewRead = read;
    const current = () =>
      !disposed &&
      previewRead === read &&
      !read.controller.signal.aborted &&
      snapshot.threadId === source.thread_id;
    publish({
      selectedSource: source,
      readingPreview: true,
      previewError: null,
    });
    try {
      if (!current()) return;
      const raw = await options.readCheckpoint(source, read.controller.signal);
      if (!current()) return;
      const captured = capturePreview(raw, source);
      if (!captured) throw new Error('Unavailable preview');
      const content = createMessageContent();
      const rows = content.project({
        status: 'idle',
        messages: captured.messages,
        toolCalls: [],
      });
      if (!current()) {
        content.dispose();
        return;
      }
      preview = captured;
      previewContent = content;
      publish({ previewRows: rows });
    } catch {
      if (current())
        publish({ previewError: 'Checkpoint preview is unavailable.' });
    } finally {
      if (current()) {
        previewRead = undefined;
        publish({ readingPreview: false });
      }
    }
  }
  async function newConversation() {
    if (disposed) return;
    const previous = execution,
      controller = new AbortController();
    execution = controller;
    const owner = primary;
    primary = undefined;
    publish({ busy: true, activity: 'replacing', canSubmit: false }, false);
    if (owner) void close(owner);
    previous?.abort();
    if (disposed || execution !== controller) return;
    cancelHistory(false);
    cancelPreview(false);
    if (disposed || execution !== controller) return;
    publish();
    await Promise.all([...cleanups]);
    if (disposed || execution !== controller) return;
    execution = undefined;
    publish({
      threadId: null,
      rows: [],
      draft: '',
      historyPage: undefined,
      historyError: null,
      error: null,
      outcome: null,
      canSubmit: true,
      busy: false,
      activity: 'idle',
      viewGeneration: snapshot.viewGeneration + 1,
    });
  }
  async function stop() {
    if (disposed || !execution || snapshot.activity === 'replacing') return;
    const previous = execution,
      controller = new AbortController();
    execution = controller;
    const owner = primary;
    primary = undefined;
    publish(
      {
        busy: true,
        activity: 'replacing',
        canSubmit: false,
        outcome: 'aborted',
        error: 'Execution stopped. Start a new conversation.',
      },
      false
    );
    // Both asynchronous retirement operations belong to New/dispose's cleanup barrier.
    const stopping = track(() => owner?.session.stop());
    const closing = owner ? close(owner) : Promise.resolve();
    previous.abort();
    if (disposed || execution !== controller) return;
    cancelHistory(false);
    cancelPreview(false);
    if (disposed || execution !== controller) return;
    publish();
    await Promise.all([closing, stopping]);
    if (!disposed && execution === controller) {
      execution = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    execution?.abort();
    execution = undefined;
    cancelHistory(false);
    cancelPreview(false);
    const owner = primary;
    primary = undefined;
    if (owner) void close(owner);
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
    setDraft(text: string) {
      if (
        !disposed &&
        !snapshot.busy &&
        snapshot.canSubmit &&
        typeof text === 'string'
      )
        publish({ draft: text });
    },
    submit: (text = snapshot.draft) => execute(text, null),
    forkSelected: (text = snapshot.draft) =>
      preview ? execute(text, preview) : Promise.resolve(),
    refreshHistory,
    selectCheckpoint,
    cancelPreview: () => cancelPreview(),
    clearSelection: () => cancelPreview(),
    newConversation,
    stop,
    dispose,
  };
}
