import { createSession, type LangGraphSession } from '@threadplane/langgraph';
import {
  applicationTools,
  type ApplicationToolContracts,
} from './trip-summary.js';
import type { CompleteOutcome } from '@threadplane/core';
import type { createMarkdown } from '@threadplane/content/markdown';
import {
  createMessageContent,
  type MessageContent,
} from './message-content.js';
import type { ThreadDirectory, ThreadRow } from './contracts.js';
import { selectedThread, threadUrl, type BrowserHistory } from './route.js';
import { projectApproval, type Approval } from './approval.js';

export type ApplicationSession = LangGraphSession<ApplicationToolContracts>;

interface Decision extends Approval {
  readonly token: symbol;
  readonly canRespond: boolean;
}

export interface ApplicationSnapshot<
  TRow extends MessageContent = MessageContent
> {
  readonly pins: Readonly<
    Record<
      string,
      Readonly<{
        status: 'pending' | 'confirmed' | 'failed';
        pinned: boolean;
      }>
    >
  >;
  readonly renames: Readonly<
    Record<
      string,
      Readonly<{ status: 'pending' | 'confirmed' | 'failed'; title: string }>
    >
  >;
  readonly decision: Decision | null;
  // Retained after settlement so views can describe an uncertain decision.
  readonly submissionKind: 'text' | 'decision' | null;
  readonly messages: readonly TRow[];
  readonly submission: Readonly<{
    active: boolean;
    outcome: CompleteOutcome | null;
  }>;
  readonly creation: Readonly<{
    status: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
    id: string | null;
  }>;
  readonly list: Readonly<{
    status: 'idle' | 'pending' | 'ready' | 'error';
    rows: readonly ThreadRow[];
  }>;
  readonly selection: Readonly<{
    status: 'empty' | 'pending' | 'ready' | 'missing' | 'error';
    id: string | null;
    row?: ThreadRow;
  }>;
  readonly runtime: ReturnType<ApplicationSession['getSnapshot']> | null;
}

export interface ApplicationContent<
  TRow extends MessageContent = MessageContent
> {
  getSnapshot(): readonly TRow[];
  update(
    messages: Parameters<ReturnType<typeof createMessageContent>['update']>[0],
    toolCalls: Parameters<ReturnType<typeof createMessageContent>['update']>[1]
  ): void;
  dispose(): void;
}

export interface ApplicationOptions<
  TRow extends MessageContent = MessageContent
> {
  readonly history: BrowserHistory;
  readonly directory: ThreadDirectory;
  readonly assistantId: string;
  readonly apiUrl: string;
  // Private composition seam; tests can delay actual runtime completions.
  readonly sessionFactory?: (id: string) => ApplicationSession;
  // Private composition seam around the installed Markdown owner.
  readonly markdownFactory?: typeof createMarkdown;
  // Private composition seam around the session's content owner.
  readonly contentFactory?: () => ApplicationContent<TRow>;
}

interface Creation {
  readonly operation: number;
  readonly intent: number;
  readonly controller: AbortController;
}

export function createApplication<TRow extends MessageContent>(
  options: ApplicationOptions<TRow> & {
    readonly contentFactory: () => ApplicationContent<TRow>;
  }
): ReturnType<typeof createApplicationOwner<TRow>>;
export function createApplication(
  options: ApplicationOptions
): ReturnType<typeof createApplicationOwner<MessageContent>>;
export function createApplication(options: ApplicationOptions) {
  return createApplicationOwner(
    options,
    options.contentFactory ??
      (() => createMessageContent(options.markdownFactory))
  );
}

function createApplicationOwner<TRow extends MessageContent>(
  options: ApplicationOptions,
  contentFactory: () => ApplicationContent<TRow>
) {
  interface Admission {
    readonly intent: number;
    readonly id: string;
    readonly controller: AbortController;
    session?: ApplicationSession;
    release?: () => void;
    content?: ApplicationContent<TRow>;
  }

  interface Submission {
    readonly admission: Admission;
    readonly session: ApplicationSession;
    readonly controller: AbortController;
  }

  interface DecisionOccurrence {
    readonly admission: Admission;
    readonly evidence: NonNullable<
      ApplicationSnapshot['runtime']
    >['interrupts'];
    readonly approval: Approval;
    readonly token: symbol;
    consumed: boolean;
    card?: Decision;
  }

  let snapshot: ApplicationSnapshot<TRow> = Object.freeze({
    pins: Object.freeze({}),
    renames: Object.freeze({}),
    decision: null,
    submissionKind: null,
    messages: Object.freeze([]),
    submission: Object.freeze({ active: false, outcome: null }),
    creation: Object.freeze({ status: 'idle', id: null }),
    list: Object.freeze({ status: 'idle', rows: Object.freeze([]) }),
    selection: Object.freeze({ status: 'empty', id: null }),
    runtime: null,
  });
  let writeVersion = 0;
  let readOrder = 0;
  const confirmedTitles = new Map<
    string,
    { version: number; title: string; readOrder: number }
  >();
  const renaming = new Map<string, AbortController>();
  const pinning = new Map<string, AbortController>();
  const confirmedPins = new Map<
    string,
    { version: number; pinned: boolean | undefined; readOrder: number }
  >();
  function reconcile(
    row: ThreadRow,
    readVersion: number,
    order: number
  ): ThreadRow {
    const confirmed = confirmedTitles.get(row.id);
    if (confirmed) {
      if (confirmed.version > readVersion || confirmed.readOrder > order)
        row =
          row.title !== confirmed.title
            ? Object.freeze({ ...row, title: confirmed.title })
            : row;
      // Accepted post-write reads supersede the overlay for older admissions.
      // Request order resolves reads sharing a mutation version; reads never
      // advance the mutation clock or supersede a concurrent newer write.
      else
        confirmedTitles.set(row.id, {
          ...confirmed,
          title: row.title,
          readOrder: order,
        });
    }
    const pin = confirmedPins.get(row.id);
    if (pin) {
      if (pin.version > readVersion || pin.readOrder > order)
        row =
          row.pinned !== pin.pinned
            ? Object.freeze({ ...row, pinned: pin.pinned })
            : row;
      else
        confirmedPins.set(row.id, {
          ...pin,
          pinned: row.pinned,
          readOrder: order,
        });
    }
    return row;
  }
  let started = false;
  let disposed = false;
  let selectionIntent = 0;
  let refreshIntent = 0;
  let creationIntent = 0;
  let creating: Creation | undefined;
  let admission: Admission | undefined;
  let submitting: Submission | undefined;
  let occurrence: DecisionOccurrence | undefined;
  let refreshing: AbortController | undefined;
  let releaseHistory: (() => void) | undefined;
  const listeners = new Set<{ notify: () => void }>();
  const sessionFactory =
    options.sessionFactory ??
    ((id: string) =>
      createSession({
        tools: applicationTools,
        assistantId: options.assistantId,
        apiUrl: options.apiUrl,
        threadId: id,
        clientOptions: { maxRetries: 0 },
      }));

  function publish(next: ApplicationSnapshot<TRow>) {
    if (disposed) return;
    next = { ...next, decision: projectDecision(next) };
    if (
      next.renames === snapshot.renames &&
      next.pins === snapshot.pins &&
      next.list === snapshot.list &&
      next.decision === snapshot.decision &&
      next.submissionKind === snapshot.submissionKind &&
      next.selection === snapshot.selection &&
      next.creation === snapshot.creation &&
      next.submission === snapshot.submission &&
      next.messages === snapshot.messages &&
      next.runtime === snapshot.runtime
    )
      return;
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      // Reentry may already have published the next selection to everyone.
      if (snapshot !== next || disposed) break;
      if (!listeners.has(listener)) continue;
      try {
        listener.notify();
      } catch {
        /* An observer does not own effects. */
      }
    }
  }

  function owns(current: Admission) {
    return (
      !disposed &&
      admission === current &&
      selectionIntent === current.intent &&
      !current.controller.signal.aborted
    );
  }

  function canOperate(next = snapshot) {
    return !!(
      started &&
      admission &&
      owns(admission) &&
      admission.session &&
      next.selection.status === 'ready' &&
      next.selection.id === admission.id &&
      admission.session.getSnapshot().history !== undefined &&
      !submitting
    );
  }

  function projectDecision(next: ApplicationSnapshot<TRow>): Decision | null {
    const evidence = next.runtime?.interrupts;
    if (!admission || !owns(admission) || !evidence?.length) {
      occurrence = undefined;
      return null;
    }
    // Runtime preserves equal root evidence across unrelated notifications and
    // clears it when an actual attempt begins. IDs alone cannot identify pauses.
    if (
      occurrence?.admission !== admission ||
      occurrence.evidence !== evidence
    ) {
      const approval = projectApproval(evidence);
      occurrence = approval
        ? {
            admission,
            evidence,
            approval,
            token: Symbol('approval occurrence'),
            consumed: false,
          }
        : undefined;
    }
    if (!occurrence) return null;
    const canRespond =
      !occurrence.consumed &&
      canOperate(next) &&
      next.runtime?.status === 'idle';
    if (!occurrence.card || occurrence.card.canRespond !== canRespond)
      occurrence.card = Object.freeze({
        ...occurrence.approval,
        token: occurrence.token,
        canRespond,
      });
    return occurrence.card;
  }

  function retire(previous: Admission | undefined) {
    if (!previous) return;
    previous.controller.abort();
    previous.release?.();
    previous.content?.dispose();
    // Runtime disposal cancels synchronously, but its completion may be late.
    // It must never delay or mutate the replacement selection.
    void previous.session?.dispose().catch(() => {});
  }

  function selectionStatus(
    current: Admission,
    status: 'ready' | 'missing' | 'error',
    row?: ThreadRow
  ) {
    if (!owns(current)) return;
    publish({
      ...snapshot,
      selection: Object.freeze({
        status,
        id: current.id,
        ...(row ? { row } : {}),
      }),
    });
  }

  async function admit(current: Admission) {
    const readVersion = writeVersion;
    const order = ++readOrder;
    try {
      const result = await options.directory.get(
        current.id,
        current.controller.signal
      );
      if (!owns(current)) return;
      if (result.kind !== 'ready') {
        selectionStatus(
          current,
          result.kind === 'missing' ? 'missing' : 'error'
        );
        return;
      }
      const session = sessionFactory(current.id);
      if (!owns(current)) {
        void session.dispose().catch(() => {});
        return;
      }
      current.session = session;
      const content = contentFactory();
      // Construction may synchronously select a replacement before attachment.
      if (!owns(current) || current.session !== session) {
        content.dispose();
        return;
      }
      current.content = content;
      const observe = () => {
        if (!owns(current) || current.session !== session) return;
        const runtime = session.getSnapshot();
        content.update(runtime.messages, runtime.toolCalls);
        publish({ ...snapshot, runtime, messages: content.getSnapshot() });
      };
      current.release = session.subscribe(observe);
      observe();
      // Publishing the initial runtime can synchronously select another thread.
      if (!owns(current) || current.session !== session) return;
      if (!session.load) throw new Error('History loading is unavailable');
      await session.load({ signal: current.controller.signal });
      if (!owns(current) || current.session !== session) return;
      // load() also resolves when aborted/disposed. A fresh session's accepted
      // history (including an empty page) is the successful-load evidence.
      if (session.getSnapshot().history === undefined) {
        selectionStatus(current, 'error');
        return;
      }
      observe();
      if (!owns(current) || current.session !== session) return;
      selectionStatus(
        current,
        'ready',
        reconcile(result.value, readVersion, order)
      );
    } catch {
      selectionStatus(current, 'error');
    }
  }

  function select(id: string | null, push: boolean, retry = false) {
    if (!started || disposed || (!retry && id === snapshot.selection.id))
      return;
    const intent = ++selectionIntent;
    const previous = admission;
    const current =
      id === null
        ? undefined
        : { intent, id, controller: new AbortController() };
    admission = current;
    occurrence = undefined;
    retireSubmission();
    const creation = cancelCreation();
    retire(previous);
    if (disposed || selectionIntent !== intent) return;
    if (push) options.history.push(threadUrl(options.history.currentUrl(), id));
    publish({
      ...snapshot,
      creation,
      submission: Object.freeze({ active: false, outcome: null }),
      submissionKind: null,
      selection: Object.freeze({
        status: id === null ? 'empty' : 'pending',
        id,
      }),
      runtime: null,
      messages: Object.freeze([]),
    });
    if (current && owns(current)) void admit(current);
  }

  function cancelCreation(): ApplicationSnapshot['creation'] {
    const previous = creating;
    if (!previous) return snapshot.creation;
    creating = undefined;
    previous.controller.abort();
    // Cancellation only ends local interest; the server may have accepted it.
    return Object.freeze({ status: 'unconfirmed', id: null });
  }

  function newConversation() {
    if (!started || disposed || creating) return;
    const current: Creation = {
      operation: ++creationIntent,
      intent: selectionIntent,
      controller: new AbortController(),
    };
    // Reserve before either observers or the SDK can synchronously reenter.
    creating = current;
    const interested = () =>
      !disposed &&
      creationIntent === current.operation &&
      selectionIntent === current.intent &&
      !current.controller.signal.aborted;
    const ownsCreation = () => creating === current && interested();
    publish({
      ...snapshot,
      creation: Object.freeze({ status: 'pending', id: null }),
    });
    if (!ownsCreation()) return;
    void (async () => {
      try {
        const result = await options.directory.create(
          current.controller.signal
        );
        if (!ownsCreation()) return;
        creating = undefined;
        publish({
          ...snapshot,
          creation: Object.freeze(
            result.kind === 'ready'
              ? { status: 'confirmed', id: result.value.id }
              : { status: 'unconfirmed', id: null }
          ),
        });
        // Confirmation observers may navigate, dispose, or explicitly start
        // another creation. Only the still-current intent can adopt this ID.
        if (result.kind === 'ready' && interested())
          select(result.value.id, true);
      } catch {
        if (!ownsCreation()) return;
        creating = undefined;
        publish({
          ...snapshot,
          creation: Object.freeze({ status: 'unconfirmed', id: null }),
        });
      }
    })();
  }

  function refresh() {
    if (!started || disposed) return;
    const readVersion = writeVersion;
    const order = ++readOrder;
    // Capture before abort/publication reentry can replace the admission.
    const selected =
      admission &&
      owns(admission) &&
      snapshot.selection.status === 'ready' &&
      snapshot.selection.id === admission.id
        ? admission
        : undefined;
    const intent = ++refreshIntent;
    const previous = refreshing;
    const controller = new AbortController();
    refreshing = controller;
    previous?.abort();
    const current = () =>
      !disposed &&
      intent === refreshIntent &&
      refreshing === controller &&
      !controller.signal.aborted;
    publish({
      ...snapshot,
      list: Object.freeze({ status: 'pending', rows: snapshot.list.rows }),
    });
    if (!current()) return;
    void (async () => {
      try {
        const result = await options.directory.list(controller.signal);
        if (!current()) return;
        const rows =
          result.kind === 'ready'
            ? Object.freeze(
                result.value.map((row) => reconcile(row, readVersion, order))
              )
            : snapshot.list.rows;
        // A matching row renames the same ready selection; omission is not deletion.
        let selection = snapshot.selection;
        const row =
          result.kind === 'ready' &&
          selected &&
          owns(selected) &&
          selection.status === 'ready' &&
          selection.id === selected.id
            ? rows.find((item) => item.id === selected.id)
            : undefined;
        if (
          row &&
          (row.title !== selection.row?.title ||
            row.pinned !== selection.row?.pinned)
        )
          selection = Object.freeze({ ...selection, row });
        publish({
          ...snapshot,
          selection,
          list: Object.freeze({
            status: result.kind === 'ready' ? 'ready' : 'error',
            rows,
          }),
        });
      } catch {
        if (current())
          publish({
            ...snapshot,
            list: Object.freeze({ status: 'error', rows: snapshot.list.rows }),
          });
      }
    })();
  }

  function canRename() {
    return (
      started && !disposed && typeof options.directory.rename === 'function'
    );
  }

  function canSetPinned() {
    return (
      started && !disposed && typeof options.directory.setPinned === 'function'
    );
  }

  async function setPinned(id: string, pinned: boolean): Promise<boolean> {
    const existing =
      snapshot.list.rows.find((row) => row.id === id) ??
      (snapshot.selection.id === id ? snapshot.selection.row : undefined);
    if (
      !canSetPinned() ||
      typeof pinned !== 'boolean' ||
      pinning.has(id) ||
      (existing && (existing.pinned === true) === pinned)
    )
      return false;
    const controller = new AbortController();
    pinning.set(id, controller);
    const ownsPin = () =>
      !disposed && pinning.get(id) === controller && !controller.signal.aborted;
    const state = (status: 'pending' | 'confirmed' | 'failed') =>
      Object.freeze({
        ...snapshot.pins,
        [id]: Object.freeze({ status, pinned }),
      });
    publish({ ...snapshot, pins: state('pending') });
    if (!ownsPin()) return false;
    let confirmed = false;
    try {
      const result = await options.directory.setPinned!(
        id,
        pinned,
        controller.signal
      );
      if (!ownsPin()) return false;
      confirmed =
        result.kind === 'ready' &&
        result.value.id === id &&
        result.value.pinned === pinned;
    } catch {
      if (!ownsPin()) return false;
    }
    pinning.delete(id);
    if (!confirmed) {
      publish({ ...snapshot, pins: state('failed') });
      return false;
    }
    confirmedPins.set(id, { version: ++writeVersion, pinned, readOrder: 0 });
    const replacePin = (row: ThreadRow) =>
      row.id === id && row.pinned !== pinned
        ? Object.freeze({ ...row, pinned })
        : row;
    const selection =
      snapshot.selection.id === id && snapshot.selection.row
        ? Object.freeze({
            ...snapshot.selection,
            row: replacePin(snapshot.selection.row),
          })
        : snapshot.selection;
    publish({
      ...snapshot,
      selection,
      list: Object.freeze({
        ...snapshot.list,
        rows: Object.freeze(snapshot.list.rows.map(replacePin)),
      }),
      pins: state('confirmed'),
    });
    return true;
  }

  async function rename(id: string, value: string): Promise<boolean> {
    const title = value.trim();
    const existing =
      snapshot.list.rows.find((row) => row.id === id) ??
      (snapshot.selection.id === id ? snapshot.selection.row : undefined);
    if (
      !canRename() ||
      !title ||
      title === existing?.title.trim() ||
      renaming.has(id)
    )
      return false;
    const controller = new AbortController();
    // A target is reserved before synchronous observer or transport reentry.
    renaming.set(id, controller);
    const ownsRename = () =>
      !disposed &&
      renaming.get(id) === controller &&
      !controller.signal.aborted;
    const state = (status: 'pending' | 'confirmed' | 'failed') =>
      Object.freeze({
        ...snapshot.renames,
        [id]: Object.freeze({ status, title }),
      });
    publish({ ...snapshot, renames: state('pending') });
    if (!ownsRename()) return false;
    let confirmed = false;
    try {
      const result = await options.directory.rename!(
        id,
        title,
        controller.signal
      );
      if (!ownsRename()) return false;
      confirmed =
        result.kind === 'ready' &&
        result.value.id === id &&
        result.value.title === title;
    } catch {
      if (!ownsRename()) return false;
    }
    renaming.delete(id);
    if (!confirmed) {
      publish({ ...snapshot, renames: state('failed') });
      return false;
    }
    confirmedTitles.set(id, { version: ++writeVersion, title, readOrder: 0 });
    const replaceTitle = (row: ThreadRow) =>
      row.id === id && row.title !== title
        ? Object.freeze({ ...row, title })
        : row;
    const rows = snapshot.list.rows.map(replaceTitle);
    const selection =
      snapshot.selection.id === id && snapshot.selection.row
        ? Object.freeze({
            ...snapshot.selection,
            row: replaceTitle(snapshot.selection.row),
          })
        : snapshot.selection;
    publish({
      ...snapshot,
      selection,
      list: Object.freeze({ ...snapshot.list, rows: Object.freeze(rows) }),
      renames: state('confirmed'),
    });
    return true;
  }

  function canSubmit() {
    return canOperate() && !admission!.session!.getSnapshot().interrupts.length;
  }

  function ownsSubmission(current: Submission) {
    return (
      submitting === current &&
      owns(current.admission) &&
      current.admission.session === current.session
    );
  }

  function retireSubmission() {
    const previous = submitting;
    submitting = undefined;
    previous?.controller.abort();
  }

  // Both commands reserve the same slot before notifying any observers.
  function execute(
    kind: 'text' | 'decision',
    dispatch: (
      session: ApplicationSession,
      signal: AbortSignal
    ) => Promise<CompleteOutcome>
  ) {
    const current: Submission = {
      admission: admission!,
      session: admission!.session!,
      controller: new AbortController(),
    };
    // The application owns admission before observers or runtime code can reenter.
    submitting = current;
    if (occurrence) occurrence.consumed = true;
    publish({
      ...snapshot,
      submission: Object.freeze({ active: true, outcome: null }),
      submissionKind: kind,
    });
    if (!ownsSubmission(current)) return false;
    void (async () => {
      let outcome: CompleteOutcome;
      try {
        // A Stop from the reservation notification aborts this signal before
        // the runtime starts. Accepted text is otherwise passed through intact.
        outcome = await dispatch(current.session, current.controller.signal);
      } catch {
        outcome = 'error';
      }
      if (!ownsSubmission(current)) return;
      // A stream can replace root metadata before failing. That is not fresh
      // permission to replay an uncertain response, even with another array.
      if (occurrence && outcome !== 'paused' && outcome !== 'success')
        occurrence.consumed = true;
      submitting = undefined;
      publish({
        ...snapshot,
        submission: Object.freeze({ active: false, outcome }),
      });
    })();
    return true;
  }

  // True means locally admitted, not that execution succeeded remotely.
  function submit(text: string) {
    if (!canSubmit() || !text.trim()) return false;
    return execute('text', (session, signal) =>
      session.submit(text, { signal })
    );
  }

  function respond(token: symbol, action: 'approve' | 'decline') {
    if (
      (action !== 'approve' && action !== 'decline') ||
      !canOperate() ||
      !occurrence ||
      occurrence.consumed ||
      occurrence.admission !== admission ||
      occurrence.token !== token ||
      !snapshot.decision?.canRespond ||
      admission!.session!.getSnapshot().interrupts !== occurrence.evidence
    )
      return false;
    const response = {
      [occurrence.approval.id]: action === 'approve' ? 'approved' : 'denied',
    };
    return execute('decision', (session, signal) =>
      session.resume(response, { signal })
    );
  }

  function stop() {
    const current = submitting;
    if (!current || !ownsSubmission(current)) return;
    current.controller.abort();
    try {
      void current.session.stop().catch(() => {});
    } catch {
      // Stop does not settle the submission or claim remote execution ceased.
    }
  }

  return Object.freeze({
    canSetPinned,
    setPinned,
    canRename,
    rename,
    canSubmit,
    submit,
    respond,
    stop,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      const listener = { notify };
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started || disposed) return;
      started = true;
      const id = selectedThread(options.history.currentUrl());
      releaseHistory = options.history.subscribe(() =>
        select(selectedThread(options.history.currentUrl()), false)
      );
      const intent = selectionIntent;
      refresh();
      if (selectionIntent === intent) select(id, false);
    },
    select: (id: string | null) => select(id, true),
    retry() {
      const { status, id } = snapshot.selection;
      if (status === 'missing' || status === 'error') select(id, false, true);
    },
    refresh,
    newConversation,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of pinning.values()) controller.abort();
      pinning.clear();
      for (const controller of renaming.values()) controller.abort();
      renaming.clear();
      selectionIntent++;
      refreshIntent++;
      cancelCreation();
      const previous = admission;
      admission = undefined;
      occurrence = undefined;
      retireSubmission();
      refreshing?.abort();
      releaseHistory?.();
      listeners.clear();
      retire(previous);
    },
  });
}
