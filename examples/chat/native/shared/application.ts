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
import { orderActiveThreads } from './projection.js';

export type ApplicationSession = LangGraphSession<ApplicationToolContracts>;

interface Decision extends Approval {
  readonly token: symbol;
  readonly canRespond: boolean;
}

export interface ApplicationSnapshot<
  TRow extends MessageContent = MessageContent
> {
  readonly deletion: Readonly<{
    status: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
    id: string | null;
    title: string | null;
    intent: number;
    checking: boolean;
  }>;
  readonly ordering: Readonly<{
    status: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
    id: string | null;
    beforeId: string | null;
    intent: number;
  }>;
  readonly projectMoves: Readonly<
    Record<
      string,
      Readonly<{
        status: 'pending' | 'confirmed' | 'failed';
        projectId: string | null;
      }>
    >
  >;
  readonly archives: Readonly<
    Record<
      string,
      Readonly<{
        status: 'pending' | 'confirmed' | 'failed';
        archived: boolean;
      }>
    >
  >;
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
    deletion: Object.freeze({
      status: 'idle',
      id: null,
      title: null,
      intent: 0,
      checking: false,
    }),
    ordering: Object.freeze({
      status: 'idle',
      id: null,
      beforeId: null,
      intent: 0,
    }),
    projectMoves: Object.freeze({}),
    archives: Object.freeze({}),
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
  const retiredIds = new Set<string>();
  let deletionIntent = 0;
  let deleting:
    | {
        id: string;
        title: string;
        intent: number;
        controller: AbortController;
        inspection?: AbortController;
      }
    | undefined;
  const blocksTarget = (id: string) =>
    retiredIds.has(id) || deleting?.id === id;
  let writeVersion = 0;
  let readOrder = 0;
  let orderingIntent = 0;
  let ordering: AbortController | undefined;
  const rankEvidence = new Map<
    string,
    { version: number; pinnedOrder: number | undefined; readOrder: number }
  >();
  const confirmedTitles = new Map<
    string,
    { version: number; title: string; readOrder: number }
  >();
  const projectMoving = new Map<string, AbortController>();
  const projectEvidence = new Map<
    string,
    {
      version: number;
      projectId: string | undefined;
      readOrder: number;
    }
  >();
  function replaceProject(
    row: ThreadRow,
    projectId: string | undefined
  ): ThreadRow {
    if (
      row.projectId === projectId &&
      (projectId !== undefined || !Object.hasOwn(row, 'projectId'))
    )
      return row;
    const { projectId: _previous, ...rest } = row;
    return Object.freeze(
      projectId === undefined ? rest : { ...rest, projectId }
    );
  }
  const renaming = new Map<string, AbortController>();
  const archiving = new Map<string, AbortController>();
  const confirmedArchives = new Map<
    string,
    { version: number; archived: boolean | undefined; readOrder: number }
  >();
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
    const project = projectEvidence.get(row.id);
    if (project) {
      if (project.version > readVersion || project.readOrder > order)
        row = replaceProject(row, project.projectId);
      else
        projectEvidence.set(row.id, {
          ...project,
          projectId: row.projectId,
          readOrder: order,
        });
    }
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
    const archive = confirmedArchives.get(row.id);
    if (archive) {
      if (archive.version > readVersion || archive.readOrder > order)
        row =
          row.archived !== archive.archived
            ? Object.freeze({ ...row, archived: archive.archived })
            : row;
      else
        confirmedArchives.set(row.id, {
          ...archive,
          archived: row.archived,
          readOrder: order,
        });
    }
    const rank = rankEvidence.get(row.id);
    if (rank) {
      if (rank.version > readVersion || rank.readOrder > order)
        row =
          row.pinnedOrder !== rank.pinnedOrder
            ? Object.freeze({ ...row, pinnedOrder: rank.pinnedOrder })
            : row;
      else
        rankEvidence.set(row.id, {
          ...rank,
          pinnedOrder: row.pinnedOrder,
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
    const previous = snapshot;
    // Install the immutable operation state before invoking the live runtime
    // projection. Reentrant navigation must inherit completed retirements.
    const supplied = Object.freeze(next);
    snapshot = supplied;
    const decision = projectDecision(supplied);
    if (disposed || snapshot !== supplied) return;
    next = { ...supplied, decision };
    if (
      next.deletion === previous.deletion &&
      next.ordering === previous.ordering &&
      next.renames === previous.renames &&
      next.archives === previous.archives &&
      next.pins === previous.pins &&
      next.projectMoves === previous.projectMoves &&
      next.list === previous.list &&
      next.decision === previous.decision &&
      next.submissionKind === previous.submissionKind &&
      next.selection === previous.selection &&
      next.creation === previous.creation &&
      next.submission === previous.submission &&
      next.messages === previous.messages &&
      next.runtime === previous.runtime
    ) {
      snapshot = previous;
      return;
    }
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
      !retiredIds.has(current.id) &&
      selectionIntent === current.intent &&
      !current.controller.signal.aborted
    );
  }

  function readyToOperate(
    current: Admission,
    session: ApplicationSession,
    next = snapshot
  ) {
    return !!(
      started &&
      owns(current) &&
      current.session === session &&
      next.selection.status === 'ready' &&
      next.selection.id === current.id &&
      !blocksTarget(current.id) &&
      !submitting
    );
  }

  function canOperate(next = snapshot) {
    const current = admission;
    const session = current?.session;
    if (!current || !session || !readyToOperate(current, session, next))
      return false;
    const runtime = session.getSnapshot();
    // A live runtime getter is a callback boundary, not a reservation.
    return (
      runtime.history !== undefined && readyToOperate(current, session, next)
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
    const current = occurrence;
    const selected = admission;
    const canRespond =
      !current.consumed && canOperate(next) && next.runtime?.status === 'idle';
    if (
      occurrence !== current ||
      admission !== selected ||
      !selected ||
      !owns(selected)
    )
      return null;
    if (!current.card || current.card.canRespond !== canRespond)
      current.card = Object.freeze({
        ...current.approval,
        token: current.token,
        canRespond,
      });
    return current.card;
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
        if (!owns(current) || current.session !== session) return;
        content.update(runtime.messages, runtime.toolCalls);
        if (!owns(current) || current.session !== session) return;
        const messages = content.getSnapshot();
        if (!owns(current) || current.session !== session) return;
        publish({ ...snapshot, runtime, messages });
      };
      const release = session.subscribe(observe);
      if (!owns(current) || current.session !== session) {
        release();
        return;
      }
      current.release = release;
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
    if (push) {
      const url = options.history.currentUrl();
      if (disposed || selectionIntent !== intent) return;
      options.history.push(threadUrl(url, id));
      if (disposed || selectionIntent !== intent) return;
    }
    publish({
      ...snapshot,
      creation,
      submission: Object.freeze({ active: false, outcome: null }),
      submissionKind: null,
      selection: Object.freeze({
        status:
          id === null ? 'empty' : retiredIds.has(id) ? 'missing' : 'pending',
        id,
      }),
      runtime: null,
      messages: Object.freeze([]),
    });
    if (current && retiredIds.has(current.id) && admission === current)
      admission = undefined;
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
            result.kind === 'ready' && !retiredIds.has(result.value.id)
              ? { status: 'confirmed', id: result.value.id }
              : { status: 'unconfirmed', id: null }
          ),
        });
        // Confirmation observers may navigate, dispose, or explicitly start
        // another creation. Only the still-current intent can adopt this ID.
        if (
          result.kind === 'ready' &&
          !retiredIds.has(result.value.id) &&
          interested()
        )
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
    // Only admission after uncertain settlement can reconcile its barrier.
    const barrier =
      snapshot.ordering.status === 'unconfirmed'
        ? snapshot.ordering
        : undefined;
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
                result.value
                  .filter((row) => !retiredIds.has(row.id))
                  .map((row) => reconcile(row, readVersion, order))
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
            row.pinned !== selection.row?.pinned ||
            row.archived !== selection.row?.archived ||
            row.projectId !== selection.row?.projectId ||
            row.pinnedOrder !== selection.row?.pinnedOrder)
        )
          selection = Object.freeze({ ...selection, row });
        publish({
          ...snapshot,
          selection,
          ordering:
            result.kind === 'ready' && barrier && snapshot.ordering === barrier
              ? Object.freeze({
                  status: 'idle',
                  id: null,
                  beforeId: null,
                  intent: barrier.intent,
                })
              : snapshot.ordering,
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

  function canRemove(id: string) {
    if (
      !started ||
      disposed ||
      deleting ||
      ordering ||
      retiredIds.has(id) ||
      typeof id !== 'string' ||
      !id ||
      id === '.' ||
      id === '..' ||
      typeof options.directory.remove !== 'function' ||
      typeof options.directory.inspectRemoval !== 'function' ||
      renaming.has(id) ||
      pinning.has(id) ||
      archiving.has(id) ||
      projectMoving.has(id)
    )
      return false;
    const row =
      snapshot.list.rows.find((item) => item.id === id) ??
      (snapshot.selection.id === id ? snapshot.selection.row : undefined);
    if (!row) return false;
    if (snapshot.selection.id === id) {
      const selected = admission;
      if (
        !selected ||
        !owns(selected) ||
        snapshot.selection.status !== 'ready' ||
        !selected.session ||
        submitting
      )
        return false;
      const runtime = selected.session.getSnapshot();
      if (
        !owns(selected) ||
        submitting ||
        snapshot.selection.status !== 'ready' ||
        snapshot.selection.id !== id ||
        deleting ||
        runtime.status === 'running' ||
        runtime.reconnect?.runId
      )
        return false;
    }
    return (
      !disposed &&
      !deleting &&
      !ordering &&
      !renaming.has(id) &&
      !pinning.has(id) &&
      !archiving.has(id) &&
      !projectMoving.has(id)
    );
  }

  function deletionState(
    current: NonNullable<typeof deleting>,
    status: ApplicationSnapshot['deletion']['status'],
    checking = false
  ) {
    return Object.freeze({
      status,
      id: current.id,
      title: current.title,
      intent: current.intent,
      checking,
    });
  }

  function confirmRemoval(current: NonNullable<typeof deleting>) {
    // Lifetime retirement is installed before any observer, disposal or history callback.
    retiredIds.add(current.id);
    projectEvidence.delete(current.id);
    const previous = admission?.id === current.id ? admission : undefined;
    const selected = snapshot.selection.id === current.id;
    const intent = selected ? ++selectionIntent : selectionIntent;
    if (previous) admission = undefined;
    if (selected) {
      occurrence = undefined;
      retireSubmission();
    }
    deleting = undefined;
    publish({
      ...snapshot,
      deletion: deletionState(current, 'confirmed'),
      list: Object.freeze({
        ...snapshot.list,
        rows: Object.freeze(
          snapshot.list.rows.filter((row) => row.id !== current.id)
        ),
      }),
      ...(selected
        ? {
            selection: Object.freeze({ status: 'empty' as const, id: null }),
            runtime: null,
            messages: Object.freeze([]),
            submissionKind: null,
            submission: Object.freeze({ active: false, outcome: null }),
          }
        : {}),
    });
    // Reentry from publication/history must not clear a newer admission or route.
    if (
      selected &&
      !disposed &&
      selectionIntent === intent &&
      !admission &&
      snapshot.selection.id === null
    ) {
      const url = options.history.currentUrl();
      if (
        !disposed &&
        selectionIntent === intent &&
        !admission &&
        snapshot.selection.id === null
      )
        options.history.push(threadUrl(url, null));
    }
    retire(previous);
  }

  async function remove(id: string): Promise<boolean> {
    if (!canRemove(id)) return false;
    const row =
      snapshot.list.rows.find((item) => item.id === id) ??
      snapshot.selection.row!;
    const current = {
      id,
      title: row.title,
      intent: ++deletionIntent,
      controller: new AbortController(),
    };
    deleting = current;
    const owned = () =>
      !disposed && deleting === current && !current.controller.signal.aborted;
    publish({ ...snapshot, deletion: deletionState(current, 'pending') });
    if (!owned()) return false;
    let confirmed = false;
    try {
      const result = await options.directory.remove!(
        id,
        current.controller.signal
      );
      if (!owned()) return false;
      confirmed = result.kind === 'ready' && result.value.id === id;
    } catch {
      if (!owned()) return false;
    }
    if (confirmed) confirmRemoval(current);
    else
      publish({ ...snapshot, deletion: deletionState(current, 'unconfirmed') });
    return confirmed;
  }

  async function checkRemoval(id: string, intent: number): Promise<boolean> {
    const current = deleting;
    if (
      !started ||
      disposed ||
      !current ||
      current.id !== id ||
      current.intent !== intent ||
      snapshot.deletion.status !== 'unconfirmed' ||
      current.inspection
    )
      return false;
    const controller = new AbortController();
    current.inspection = controller;
    const readVersion = writeVersion,
      order = ++readOrder;
    const owned = () =>
      !disposed &&
      deleting === current &&
      current.inspection === controller &&
      !controller.signal.aborted;
    publish({
      ...snapshot,
      deletion: deletionState(current, 'unconfirmed', true),
    });
    if (!owned()) return false;
    try {
      const result = await options.directory.inspectRemoval!(
        id,
        controller.signal
      );
      if (!owned()) return false;
      if (result.kind === 'missing' && result.id === id) {
        confirmRemoval(current);
        return true;
      }
      if (result.kind === 'ready' && result.value.id === id) {
        const row = reconcile(result.value, readVersion, order);
        // Read evidence uses the same independent clocks as ordinary metadata reads.
        for (const [map, value] of [
          [confirmedTitles, { title: row.title }],
          [confirmedPins, { pinned: row.pinned }],
          [confirmedArchives, { archived: row.archived }],
          [rankEvidence, { pinnedOrder: row.pinnedOrder }],
          [projectEvidence, { projectId: row.projectId }],
        ] as const) {
          // Each field has already passed its own reconciliation above.
          const previous = map.get(id);
          (map as Map<string, object>).set(id, {
            ...value,
            version: previous?.version ?? readVersion,
            readOrder: Math.max(previous?.readOrder ?? 0, order),
          });
        }
        deleting = undefined;
        publish({
          ...snapshot,
          deletion: Object.freeze({
            status: 'idle',
            id: null,
            title: null,
            intent: current.intent,
            checking: false,
          }),
          list: Object.freeze({
            ...snapshot.list,
            rows: Object.freeze(
              snapshot.list.rows.map((item) => (item.id === id ? row : item))
            ),
          }),
          selection:
            snapshot.selection.id === id && snapshot.selection.row
              ? Object.freeze({ ...snapshot.selection, row })
              : snapshot.selection,
        });
        return true;
      }
    } catch {
      if (!owned()) return false;
    }
    current.inspection = undefined;
    publish({ ...snapshot, deletion: deletionState(current, 'unconfirmed') });
    return false;
  }

  function canReorderPinned() {
    return (
      started &&
      !disposed &&
      !ordering &&
      !deleting &&
      snapshot.ordering.status !== 'unconfirmed' &&
      typeof options.directory.setPinnedOrder === 'function'
    );
  }

  async function reorderPinned(
    id: string,
    beforeId: string | null
  ): Promise<boolean> {
    if (!canReorderPinned()) return false;
    const captured = orderActiveThreads(snapshot.list.rows).filter(
      (row) => row.pinned === true
    );
    const source = captured.find((row) => row.id === id);
    if (
      !source ||
      captured.length > 50 ||
      id === beforeId ||
      (beforeId !== null && !captured.some((row) => row.id === beforeId))
    )
      return false;
    const desired = captured.filter((row) => row.id !== id);
    desired.splice(
      beforeId === null
        ? desired.length
        : desired.findIndex((row) => row.id === beforeId),
      0,
      source
    );
    // Detect semantic no-ops before normalizing legacy/missing ranks.
    if (desired.every((row, index) => row.id === captured[index].id))
      return false;
    const writes = desired
      .map((row, rank) => ({ row, rank }))
      .filter(({ row, rank }) => row.pinnedOrder !== rank);
    const controller = new AbortController();
    const intent = ++orderingIntent;
    ordering = controller;
    const ownsOrdering = () =>
      !disposed && ordering === controller && !controller.signal.aborted;
    const state = (status: 'pending' | 'confirmed' | 'unconfirmed') =>
      Object.freeze({ status, id, beforeId, intent });
    publish({ ...snapshot, ordering: state('pending') });
    if (!ownsOrdering()) return false;
    let confirmed = true;
    // Serialize this bounded restamp. Every dispatched write is awaited, even
    // after an earlier failure, and disposal prevents the next dispatch.
    for (const { row, rank } of writes) {
      if (!ownsOrdering()) return false;
      try {
        const result = await options.directory.setPinnedOrder!(
          row.id,
          rank,
          controller.signal
        );
        if (!ownsOrdering()) return false;
        if (
          result.kind !== 'ready' ||
          result.value.id !== row.id ||
          result.value.pinnedOrder !== rank
        )
          confirmed = false;
      } catch {
        if (!ownsOrdering()) return false;
        confirmed = false;
      }
    }
    if (!ownsOrdering()) return false;
    const version = ++writeVersion;
    const ranks = new Map<string, number | undefined>();
    for (const [rank, row] of desired.entries()) {
      const displayed =
        snapshot.list.rows.find((item) => item.id === row.id) ??
        (snapshot.selection.id === row.id
          ? snapshot.selection.row
          : undefined) ??
        row;
      const pinnedOrder = confirmed ? rank : displayed.pinnedOrder;
      ranks.set(row.id, pinnedOrder);
      // Absence is evidence too. Fence every captured ID, including unchanged
      // ranks and members independently unpinned/archived during this request.
      rankEvidence.set(row.id, { version, pinnedOrder, readOrder: 0 });
    }
    const replaceRank = (row: ThreadRow) =>
      ranks.has(row.id) && row.pinnedOrder !== ranks.get(row.id)
        ? Object.freeze({ ...row, pinnedOrder: ranks.get(row.id) })
        : row;
    const selectedRow = snapshot.selection.row;
    const rankedSelection =
      confirmed && selectedRow ? replaceRank(selectedRow) : selectedRow;
    const selection =
      rankedSelection !== selectedRow
        ? Object.freeze({ ...snapshot.selection, row: rankedSelection })
        : snapshot.selection;
    ordering = undefined;
    publish({
      ...snapshot,
      selection,
      list: confirmed
        ? Object.freeze({
            ...snapshot.list,
            rows: Object.freeze(snapshot.list.rows.map(replaceRank)),
          })
        : snapshot.list,
      ordering: state(confirmed ? 'confirmed' : 'unconfirmed'),
    });
    return confirmed;
  }

  function canRename() {
    return (
      started && !disposed && typeof options.directory.rename === 'function'
    );
  }

  function canSetProject() {
    return (
      started && !disposed && typeof options.directory.setProject === 'function'
    );
  }

  async function setProject(
    id: string,
    projectId: string | null
  ): Promise<boolean> {
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      id === '.' ||
      id === '..' ||
      (projectId !== null &&
        (typeof projectId !== 'string' || !projectId.trim()))
    )
      return false;
    const existing =
      snapshot.list.rows.find((row) => row.id === id) ??
      (snapshot.selection.id === id ? snapshot.selection.row : undefined);
    if (
      !canSetProject() ||
      !existing ||
      blocksTarget(id) ||
      projectMoving.has(id) ||
      (existing.projectId ?? null) === projectId
    )
      return false;
    const controller = new AbortController();
    projectMoving.set(id, controller);
    const owned = () =>
      !disposed &&
      projectMoving.get(id) === controller &&
      !controller.signal.aborted;
    const state = (status: 'pending' | 'confirmed' | 'failed') =>
      Object.freeze({
        ...snapshot.projectMoves,
        [id]: Object.freeze({ status, projectId }),
      });
    publish({ ...snapshot, projectMoves: state('pending') });
    if (!owned()) return false;
    let confirmed = false;
    try {
      const result = await options.directory.setProject!(
        id,
        projectId,
        controller.signal
      );
      if (!owned()) return false;
      confirmed =
        result.kind === 'ready' &&
        result.value?.id === id &&
        result.value.projectId === projectId;
    } catch {
      if (!owned()) return false;
    }
    projectMoving.delete(id);
    if (!confirmed) {
      publish({ ...snapshot, projectMoves: state('failed') });
      return false;
    }
    projectEvidence.set(id, {
      version: ++writeVersion,
      projectId: projectId ?? undefined,
      readOrder: 0,
    });
    const replace = (row: ThreadRow) =>
      row.id === id ? replaceProject(row, projectId ?? undefined) : row;
    publish({
      ...snapshot,
      projectMoves: state('confirmed'),
      list: Object.freeze({
        ...snapshot.list,
        rows: Object.freeze(snapshot.list.rows.map(replace)),
      }),
      selection:
        snapshot.selection.id === id && snapshot.selection.row
          ? Object.freeze({
              ...snapshot.selection,
              row: replace(snapshot.selection.row),
            })
          : snapshot.selection,
    });
    return true;
  }

  function canSetArchived() {
    return (
      started &&
      !disposed &&
      typeof options.directory.setArchived === 'function'
    );
  }

  async function setArchived(id: string, archived: boolean): Promise<boolean> {
    const existing =
      snapshot.list.rows.find((row) => row.id === id) ??
      (snapshot.selection.id === id ? snapshot.selection.row : undefined);
    if (
      !canSetArchived() ||
      blocksTarget(id) ||
      typeof archived !== 'boolean' ||
      archiving.has(id) ||
      (existing && (existing.archived === true) === archived)
    )
      return false;
    const controller = new AbortController();
    archiving.set(id, controller);
    const ownsArchive = () =>
      !disposed &&
      archiving.get(id) === controller &&
      !controller.signal.aborted;
    const state = (status: 'pending' | 'confirmed' | 'failed') =>
      Object.freeze({
        ...snapshot.archives,
        [id]: Object.freeze({ status, archived }),
      });
    publish({ ...snapshot, archives: state('pending') });
    if (!ownsArchive()) return false;
    let confirmed = false;
    try {
      const result = await options.directory.setArchived!(
        id,
        archived,
        controller.signal
      );
      if (!ownsArchive()) return false;
      confirmed =
        result.kind === 'ready' &&
        result.value.id === id &&
        result.value.archived === archived;
    } catch {
      if (!ownsArchive()) return false;
    }
    archiving.delete(id);
    if (!confirmed) {
      publish({ ...snapshot, archives: state('failed') });
      return false;
    }
    confirmedArchives.set(id, {
      version: ++writeVersion,
      archived,
      readOrder: 0,
    });
    const replaceArchive = (row: ThreadRow) =>
      row.id === id && row.archived !== archived
        ? Object.freeze({ ...row, archived })
        : row;
    const selection =
      snapshot.selection.id === id && snapshot.selection.row
        ? Object.freeze({
            ...snapshot.selection,
            row: replaceArchive(snapshot.selection.row),
          })
        : snapshot.selection;
    publish({
      ...snapshot,
      selection,
      list: Object.freeze({
        ...snapshot.list,
        rows: Object.freeze(snapshot.list.rows.map(replaceArchive)),
      }),
      archives: state('confirmed'),
    });
    return true;
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
      blocksTarget(id) ||
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
      blocksTarget(id) ||
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
    const current = admission;
    const session = current?.session;
    if (!current || !session || !canOperate()) return false;
    const runtime = session.getSnapshot();
    return (
      readyToOperate(current, session) &&
      runtime.history !== undefined &&
      !runtime.interrupts.length
    );
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
    const current = admission;
    const session = current?.session;
    const decision = occurrence;
    if (
      (action !== 'approve' && action !== 'decline') ||
      !current ||
      !session ||
      !decision ||
      !canOperate()
    )
      return false;
    const runtime = session.getSnapshot();
    if (
      !readyToOperate(current, session) ||
      occurrence !== decision ||
      decision.consumed ||
      decision.admission !== current ||
      decision.token !== token ||
      snapshot.decision?.token !== token ||
      !snapshot.decision.canRespond ||
      runtime.history === undefined ||
      runtime.interrupts !== decision.evidence
    )
      return false;
    const response = {
      [decision.approval.id]: action === 'approve' ? 'approved' : 'denied',
    };
    return execute('decision', (runtimeSession, signal) =>
      runtimeSession.resume(response, { signal })
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
    canRemove,
    remove,
    checkRemoval,
    canReorderPinned,
    reorderPinned,
    canSetProject,
    setProject,
    canSetArchived,
    setArchived,
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
      deleting?.controller.abort();
      deleting?.inspection?.abort();
      deleting = undefined;
      ordering?.abort();
      ordering = undefined;
      for (const controller of projectMoving.values()) controller.abort();
      projectMoving.clear();
      for (const controller of archiving.values()) controller.abort();
      archiving.clear();
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
