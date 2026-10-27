import {
  projectTextTranscript,
  type Session,
  type TextTranscriptRow,
} from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import {
  captureTurn,
  captureApproval,
  confirmResume,
  type RefundApproval,
  type NativeSnapshot,
  type OwnedTurn,
} from './approval-policy';

export interface InterruptsSnapshot {
  readonly threadId: string | null;
  readonly native: NativeSnapshot | undefined;
  readonly rows: readonly TextTranscriptRow[];
  readonly busy: boolean;
  readonly approval: RefundApproval | undefined;
  readonly canRespond: boolean;
  readonly canSubmit: boolean;
  readonly activity: 'idle' | 'running' | 'replacing';
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}

/** Owns lifetime and admission; the native session owns all protocol execution. */
export function createInterruptsApplication(options: {
  readonly sessionFactory: (threadId: string) => Session;
}) {
  type Primary = {
    session: Session;
    threadId: string;
    closed: boolean;
    release?: () => void;
    unsafe: boolean;
    confirmed: readonly TextTranscriptRow[];
    previousRunId?: string;
    turn?: OwnedTurn;
    approval?: RefundApproval;
    intent?: 'submit' | 'resume';
    resumeRunId?: string;
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Primary | undefined;
  let operation: AbortController | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: InterruptsSnapshot = Object.freeze({
    threadId: null,
    native: undefined,
    rows: Object.freeze([]),
    busy: false,
    approval: undefined,
    canRespond: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<InterruptsSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) {
      try {
        notify();
      } catch {
        /* A view cannot interrupt native execution or cleanup. */
      }
    }
  }
  function current(selected: Primary) {
    return (
      !disposed &&
      primary === selected &&
      !selected.closed &&
      !operation?.signal.aborted
    );
  }
  function close(selected: Primary) {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    try {
      selected.release?.();
    } catch {
      /* Revoked observation cannot prevent native cleanup. */
    }
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
    const previous = primary;
    primary = undefined;
    return previous ? close(previous) : Promise.resolve();
  }
  function read(selected: Primary, valid: () => boolean) {
    if (!valid()) return;
    const root = selected.session.getSnapshot();
    if (!valid()) return;
    const transcript = root.transcript;
    if (!valid()) return;
    const subagents = root.subagents;
    if (!valid()) return;
    const decision = root.decision;
    if (!valid()) return;
    const run = root.run;
    if (!valid()) return;
    const status = root.status;
    if (!valid()) return;
    const blocked =
      status === 'error' ||
      (decision !== undefined &&
        (decision.kind !== 'native' || decision.interrupts.length !== 1)) ||
      !!subagents.length ||
      !!run?.legacyInterrupt ||
      (run?.terminal?.type === 'RUN_FINISHED' &&
        run.terminal.outcome?.type === 'success' &&
        !!run.terminal.outcome.pendingToolCallIds?.length) ||
      transcript.some(
        (message) =>
          (message.role !== 'user' && message.role !== 'assistant') ||
          typeof message.subagentRunId === 'string' ||
          (message.role === 'assistant' && !!message.toolCalls?.length)
      );
    return valid() ? { root, blocked } : undefined;
  }
  function capture(selected: Primary, valid: () => boolean) {
    const state = read(selected, valid);
    if (!state || !valid()) return;
    selected.unsafe ||= state.blocked;
    if (!selected.turn && selected.intent === 'submit') {
      const turn = captureTurn(
        state.root,
        selected.threadId,
        selected.previousRunId,
        selected.confirmed,
        valid
      );
      if (!valid()) return;
      if (turn) selected.turn = turn;
    }
    const approval =
      selected.intent === 'submit' && selected.turn && !selected.unsafe
        ? captureApproval(state.root, selected.turn, valid)
        : undefined;
    if (
      selected.intent === 'resume' &&
      selected.approval &&
      state.root.status === 'running' &&
      state.root.run?.id &&
      state.root.run.id !== selected.approval.sourceRunId &&
      state.root.decision?.kind === 'native' &&
      state.root.decision.id === selected.approval.pause &&
      state.root.decision.sourceRunId === selected.approval.sourceRunId &&
      state.root.decision.attempt?.runId === state.root.run.id &&
      valid()
    )
      selected.resumeRunId ??= state.root.run.id;
    const confirmed =
      selected.intent === 'resume' &&
      selected.approval &&
      selected.resumeRunId &&
      !selected.unsafe
        ? confirmResume(
            state.root,
            selected.approval,
            selected.resumeRunId,
            valid
          )
        : undefined;
    if (!valid()) return;
    const rows = projectTextTranscript(state.root.transcript, snapshot.rows);
    return valid()
      ? { native: state.root, rows, approval, confirmed }
      : undefined;
  }
  function observe(selected: Primary) {
    const valid = () => current(selected);
    try {
      const result = capture(selected, valid);
      if (!result || !valid()) return;
      publish({
        native: result.native,
        rows: result.rows,
        ...(selected.unsafe
          ? { canSubmit: false, canRespond: false, approval: undefined }
          : {}),
      });
    } catch {
      if (valid()) {
        selected.unsafe = true;
        publish({
          canSubmit: false,
          canRespond: false,
          approval: undefined,
          error:
            'The refund result could not be confirmed. Start a new conversation.',
        });
      }
    }
  }
  function install(valid: () => boolean) {
    const threadId = crypto.randomUUID();
    const session = options.sessionFactory(threadId);
    const selected: Primary = {
      session,
      threadId,
      closed: false,
      unsafe: false,
      confirmed: [],
    };
    if (!valid()) {
      void close(selected);
      return;
    }
    primary = selected;
    const release = session.subscribe(() => observe(selected));
    selected.release = release;
    if (selected.closed) release();
    if (!valid() || primary !== selected) {
      void close(selected);
      return;
    }
    return selected;
  }
  function admit(activity: InterruptsSnapshot['activity'], execution: boolean) {
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      canRespond: false,
      activity,
      ...(execution ? { outcome: null, error: null } : {}),
    });
    return { admitted, valid };
  }
  function finish(admitted: AbortController) {
    if (!disposed && operation === admitted) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  async function execute(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    const before = primary;
    const initialValid = () =>
      !disposed &&
      !snapshot.busy &&
      snapshot.canSubmit &&
      primary === before &&
      !before?.closed;
    let state: ReturnType<typeof read>;
    try {
      state = before && read(before, initialValid);
    } catch {
      if (initialValid())
        publish({
          canSubmit: false,
          error: 'The refund session is unavailable. Start a new conversation.',
        });
      return;
    }
    if (!initialValid()) return;
    if (before && (before.unsafe || state?.blocked || state?.root.decision)) {
      publish({ canSubmit: false });
      return;
    }
    const { admitted, valid } = admit('running', true);
    try {
      if (!valid()) return;
      const selected = primary ?? install(valid);
      if (!selected || !valid()) return;
      publish({ threadId: selected.threadId });
      const ownedValid = () => valid() && current(selected);
      const root = read(selected, ownedValid);
      if (!root || !ownedValid()) return;
      if (root.blocked || selected.unsafe) {
        selected.unsafe = true;
        publish({ canSubmit: false });
        return;
      }
      selected.previousRunId = root.root.run?.id;
      selected.turn = undefined;
      selected.intent = 'submit';
      if (!ownedValid()) return;
      const pending = selected.session.submit(text, {
        signal: admitted.signal,
      });
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      observe(selected);
      const outcome = await pending;
      if (!ownedValid()) return;
      const result = capture(selected, ownedValid);
      if (!result || !ownedValid()) return;
      const safe =
        outcome === 'paused' && !!result.approval && !selected.unsafe;
      selected.approval = safe ? result.approval : undefined;
      publish({
        native: result.native,
        rows: result.rows,
        outcome,
        canSubmit: false,
        canRespond: safe,
        approval: selected.approval,
        error: safe
          ? null
          : 'The current refund outcome could not be confirmed. Start a new conversation.',
      });
    } catch {
      if (valid())
        publish({
          canSubmit: false,
          outcome: 'error',
          error: 'The AG-UI request failed. Start a new conversation.',
        });
    } finally {
      finish(admitted);
    }
  }
  async function respond(
    approval: RefundApproval,
    action: 'approve' | 'edit' | 'cancel',
    amount?: number
  ) {
    const selected = primary;
    if (
      disposed ||
      snapshot.busy ||
      !snapshot.canRespond ||
      !selected ||
      selected.closed ||
      selected.unsafe ||
      snapshot.approval !== approval ||
      selected.approval !== approval ||
      !selected.turn ||
      !['approve', 'edit', 'cancel'].includes(action) ||
      (action === 'edit' &&
        (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0))
    )
      return;
    const initialValid = () =>
      !disposed &&
      !snapshot.busy &&
      snapshot.canRespond &&
      primary === selected &&
      !selected.closed &&
      snapshot.approval === approval;
    function matches(valid: () => boolean) {
      if (!valid()) return false;
      const root = selected!.session.getSnapshot();
      if (!valid()) return false;
      const fresh = captureApproval(root, selected!.turn!, valid);
      return (
        !!fresh &&
        fresh.pause === approval.pause &&
        fresh.interruptId === approval.interruptId &&
        fresh.sourceRunId === approval.sourceRunId &&
        fresh.amount === approval.amount &&
        fresh.customerId === approval.customerId &&
        fresh.reason === approval.reason &&
        fresh.rows.length === approval.rows.length &&
        fresh.rows.every(
          (row, index) =>
            row.id === approval.rows[index].id &&
            row.role === approval.rows[index].role &&
            row.content === approval.rows[index].content
        ) &&
        valid()
      );
    }
    try {
      if (!matches(initialValid)) {
        if (initialValid()) {
          selected.unsafe = true;
          publish({
            canRespond: false,
            approval: undefined,
            error:
              'This approval is no longer current. Start a new conversation.',
          });
        }
        return;
      }
    } catch {
      if (initialValid()) {
        selected.unsafe = true;
        publish({
          canRespond: false,
          approval: undefined,
          error:
            'The approval could not be confirmed. Start a new conversation.',
        });
      }
      return;
    }
    if (!initialValid()) return;
    const { admitted, valid } = admit('running', true);
    const ownedValid = () => valid() && current(selected);
    try {
      if (!matches(ownedValid) || selected.unsafe || !ownedValid()) {
        if (ownedValid()) {
          selected.unsafe = true;
          publish({
            approval: undefined,
            canRespond: false,
            error:
              'This approval is no longer current. Start a new conversation.',
          });
        }
        return;
      }
      selected.intent = 'resume';
      selected.resumeRunId = undefined;
      const payload =
        action === 'cancel'
          ? { approved: false }
          : action === 'edit'
          ? { approved: true, amount: amount! }
          : { approved: true };
      if (selected.unsafe || !ownedValid()) return;
      const pending = selected.session.resume(
        approval.pause,
        [{ interruptId: approval.interruptId, status: 'resolved', payload }],
        { signal: admitted.signal }
      );
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      observe(selected);
      const outcome = await pending;
      if (!ownedValid()) return;
      const result = capture(selected, ownedValid);
      if (!result || !ownedValid()) return;
      const safe =
        outcome === 'success' && !!result.confirmed && !selected.unsafe;
      if (safe) selected.confirmed = result.confirmed!;
      else selected.unsafe = true;
      selected.approval = undefined;
      publish({
        native: result.native,
        rows: result.rows,
        approval: undefined,
        canRespond: false,
        outcome,
        canSubmit: safe,
        error: safe
          ? null
          : 'The refund result could not be confirmed. Start a new conversation.',
      });
    } catch {
      if (ownedValid()) {
        selected.unsafe = true;
        selected.approval = undefined;
        publish({
          canRespond: false,
          approval: undefined,
          outcome: 'error',
          error: 'The refund request failed. Start a new conversation.',
        });
      }
    } finally {
      finish(admitted);
    }
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const { admitted, valid } = admit('replacing', false);
    const cleanup = detach();
    try {
      if (!valid()) return;
      publish({
        threadId: null,
        native: undefined,
        approval: undefined,
        canRespond: false,
        rows: Object.freeze([]),
        outcome: null,
        error: null,
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
    const selected = primary,
      cleanup = detach();
    publish({
      busy: false,
      activity: 'idle',
      canSubmit: false,
      canRespond: false,
      approval: undefined,
      outcome: 'aborted',
      error: 'The operation stopped. Start a new conversation.',
    });
    try {
      await selected?.session.stop();
    } catch {
      /* Detached work has no publication authority. */
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
    disposal = (async () => {
      do {
        await Promise.resolve();
        await Promise.all([...cleanups]);
      } while (cleanups.size);
    })();
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
    submit: execute,
    respond,
    newConversation,
    stop,
    dispose,
  };
}
