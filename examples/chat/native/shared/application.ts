import { createSession, type LangGraphSession } from '@threadplane/langgraph';
import type { CompleteOutcome } from '@threadplane/core';
import type { createMarkdown } from '@threadplane/content/markdown';
import {
  createMessageContent,
  type MessageContent,
} from './message-content.js';
import type { ThreadDirectory, ThreadRow } from './contracts.js';
import { selectedThread, threadUrl, type BrowserHistory } from './route.js';
import { projectApproval, type Approval } from './approval.js';

interface Decision extends Approval {
  readonly token: symbol;
  readonly canRespond: boolean;
}

export interface ApplicationSnapshot {
  readonly decision: Decision | null;
  // Retained after settlement so views can describe an uncertain decision.
  readonly submissionKind: 'text' | 'decision' | null;
  readonly messages: readonly MessageContent[];
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
  readonly runtime: ReturnType<LangGraphSession['getSnapshot']> | null;
}

export interface ApplicationOptions {
  readonly history: BrowserHistory;
  readonly directory: ThreadDirectory;
  readonly assistantId: string;
  readonly apiUrl: string;
  // Private composition seam; tests can delay actual runtime completions.
  readonly sessionFactory?: (id: string) => LangGraphSession;
  // Private composition seam around the installed Markdown owner.
  readonly markdownFactory?: typeof createMarkdown;
}

interface Admission {
  readonly intent: number;
  readonly id: string;
  readonly controller: AbortController;
  session?: LangGraphSession;
  release?: () => void;
  content?: ReturnType<typeof createMessageContent>;
}

interface Creation {
  readonly operation: number;
  readonly intent: number;
  readonly controller: AbortController;
}

interface Submission {
  readonly admission: Admission;
  readonly session: LangGraphSession;
  readonly controller: AbortController;
}

interface DecisionOccurrence {
  readonly admission: Admission;
  readonly evidence: NonNullable<ApplicationSnapshot['runtime']>['interrupts'];
  readonly approval: Approval;
  readonly token: symbol;
  consumed: boolean;
  card?: Decision;
}

export function createApplication(options: ApplicationOptions) {
  let snapshot: ApplicationSnapshot = Object.freeze({
    decision: null,
    submissionKind: null,
    messages: Object.freeze([]),
    submission: Object.freeze({ active: false, outcome: null }),
    creation: Object.freeze({ status: 'idle', id: null }),
    list: Object.freeze({ status: 'idle', rows: Object.freeze([]) }),
    selection: Object.freeze({ status: 'empty', id: null }),
    runtime: null,
  });
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
        assistantId: options.assistantId,
        apiUrl: options.apiUrl,
        threadId: id,
        clientOptions: { maxRetries: 0 },
      }));

  function publish(next: ApplicationSnapshot) {
    if (disposed) return;
    next = { ...next, decision: projectDecision(next) };
    if (
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

  function projectDecision(next: ApplicationSnapshot): Decision | null {
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
      const content = createMessageContent(options.markdownFactory);
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
      selectionStatus(current, 'ready', result.value);
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
        publish({
          ...snapshot,
          list: Object.freeze({
            status: result.kind === 'ready' ? 'ready' : 'error',
            rows: result.kind === 'ready' ? result.value : snapshot.list.rows,
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
      session: LangGraphSession,
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
