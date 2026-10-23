import {
  projectTextTranscript,
  type Session,
  type TextTranscriptRow,
} from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import {
  ownSnapshot,
  captureTurn,
  captureApproval,
  confirmResume,
  type NativeSnapshot,
  type OwnedTurn,
  type ReservationApproval,
} from './approval-policy';
export interface MastraSnapshot {
  readonly threadId: string | null;
  readonly native: NativeSnapshot | undefined;
  readonly rows: readonly TextTranscriptRow[];
  readonly busy: boolean;
  readonly approval: ReservationApproval | undefined;
  readonly canRespond: boolean;
  readonly canSubmit: boolean;
  readonly activity: 'idle' | 'running' | 'replacing';
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
  readonly requiresNew: boolean;
  readonly reservation:
    | 'none'
    | 'pending'
    | 'approved'
    | 'declined'
    | 'unconfirmed';
  readonly result: string | null;
}
/** This application owns admission and lifetime; the native session executes the protocol. */
export function createMastraApplication(options: {
  readonly sessionFactory: (threadId: string) => Session;
}) {
  type Primary = {
    session: Session;
    threadId: string;
    closed: boolean;
    release?: () => void;
    turn?: OwnedTurn;
    approval?: ReservationApproval;
    transcript: NativeSnapshot['transcript'];
    previous?: string;
    intent?: 'submit' | 'resume';
    resumeRunId?: string;
    approved?: boolean;
    unsafe: boolean;
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Primary | undefined,
    operation: AbortController | undefined,
    disposed = false,
    revoking = false,
    disposal: Promise<void> | undefined;
  let snapshot: MastraSnapshot = Object.freeze({
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
    requiresNew: false,
    reservation: 'none',
    result: null,
  });
  function publish(update: Partial<MastraSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) {
      try {
        notify();
      } catch {
        /* Views cannot prevent revocation or execution. */
      }
    }
  }
  function current(p: Primary) {
    return !disposed && primary === p && !p.closed;
  }
  function close(p: Primary) {
    if (p.closed) return Promise.resolve();
    p.closed = true;
    try {
      p.release?.();
    } catch {
      /* Observation is already revoked. */
    }
    const cleanup = Promise.resolve()
      .then(() => {
        // Rejected candidates may only have one callable cleanup method.
        let dispose: Session['dispose'] | undefined;
        try {
          dispose = p.session?.dispose;
        } catch {
          /* Try the remaining cleanup surface without restoring authority. */
        }
        if (typeof dispose === 'function') return dispose.call(p.session);
        const stop = p.session?.stop;
        if (typeof stop === 'function') return stop.call(p.session);
        return undefined;
      })
      .then(
        () => undefined,
        () => undefined
      );
    cleanups.add(cleanup);
    void cleanup.then(() => cleanups.delete(cleanup));
    return cleanup;
  }
  function detach() {
    const p = primary;
    primary = undefined;
    return { p, cleanup: p ? close(p) : Promise.resolve() };
  }
  function fail(p?: Primary, outcome?: CompleteOutcome) {
    if (p && !current(p)) return;
    if (p) {
      p.unsafe = true;
      p.approval = undefined;
    }
    publish({
      canSubmit: false,
      canRespond: false,
      approval: undefined,
      requiresNew: true,
      reservation: 'unconfirmed',
      ...(outcome ? { outcome } : {}),
      error:
        'The reservation outcome could not be confirmed. Start a new conversation.',
    });
  }
  function read(p: Primary, valid: () => boolean) {
    if (!valid()) return;
    const method = p.session.getSnapshot;
    if (!valid()) return;
    const native = method.call(p.session);
    if (!valid()) return;
    return ownSnapshot(native, valid);
  }
  function capture(p: Primary, valid: () => boolean) {
    const s = read(p, valid);
    if (!s || !valid()) return;
    if (
      s.status === 'error' ||
      s.subagents.length ||
      s.transcript.some((m) => typeof m.subagentRunId === 'string')
    )
      p.unsafe = true;
    // The pinned bridge emits an informational unsupported notice before its native terminal.
    if (p.intent === 'submit' && !p.turn)
      p.turn = captureTurn(s, p.threadId, p.previous, p.transcript, valid);
    if (
      p.intent === 'resume' &&
      p.approval &&
      s.status === 'running' &&
      s.run?.id !== p.approval.sourceRunId &&
      s.decision?.kind === 'native' &&
      s.decision.id === p.approval.pause &&
      s.decision.sourceRunId === p.approval.sourceRunId &&
      s.decision.attempt?.runId === s.run?.id
    )
      p.resumeRunId ??= s.run?.id;
    const approval =
      p.intent === 'submit' && p.turn && !p.unsafe
        ? captureApproval(s, p.turn, valid)
        : undefined;
    const confirmed =
      p.intent === 'resume' &&
      p.approval &&
      p.resumeRunId &&
      typeof p.approved === 'boolean' &&
      !p.unsafe
        ? confirmResume(s, p.approval, p.resumeRunId, p.approved, valid)
        : undefined;
    return valid()
      ? {
          native: s,
          rows: projectTextTranscript(s.transcript, snapshot.rows),
          approval,
          confirmed,
        }
      : undefined;
  }
  function observe(p: Primary) {
    const valid = () => current(p) && !operation?.signal.aborted;
    try {
      const result = capture(p, valid);
      if (!valid()) return;
      if (!result) {
        fail(p);
        return;
      }
      if (
        snapshot.canRespond &&
        (!result.approval ||
          JSON.stringify(result.approval) !== JSON.stringify(p.approval))
      ) {
        fail(p);
        return;
      }
      publish({ native: result.native, rows: result.rows });
    } catch {
      if (valid()) fail(p);
    }
  }
  function admit(activity: MastraSnapshot['activity'], fresh = false) {
    const controller = new AbortController();
    operation = controller;
    const valid = () =>
      !disposed && operation === controller && !controller.signal.aborted;
    publish({
      busy: true,
      activity,
      canSubmit: false,
      canRespond: false,
      approval: undefined,
      error: null,
      outcome: null,
      ...(fresh ? { reservation: 'none' as const, result: null } : {}),
    });
    return { controller, valid };
  }
  function finish(controller: AbortController) {
    if (!disposed && operation === controller) {
      operation = undefined;
      publish({ busy: false, activity: 'idle' });
    }
  }
  function install(valid: () => boolean) {
    if (!valid()) return;
    const threadId = crypto.randomUUID();
    if (!valid()) return;
    const factory = options.sessionFactory;
    if (!valid()) return;
    const session = factory(threadId);
    const p: Primary = {
      session,
      threadId,
      closed: false,
      transcript: Object.freeze([]),
      unsafe: false,
    };
    if (!valid()) {
      void close(p);
      return;
    }
    try {
      if (
        session === null ||
        (typeof session !== 'object' && typeof session !== 'function')
      )
        throw new TypeError('A native session is required');
      for (const name of [
        'getSnapshot',
        'subscribe',
        'submit',
        'resume',
        'stop',
        'dispose',
      ] as const) {
        if (!valid()) {
          void close(p);
          return;
        }
        const method = session[name];
        if (!valid()) {
          void close(p);
          return;
        }
        if (typeof method !== 'function')
          throw new TypeError('A complete native session is required');
      }
      primary = p;
      const subscribe = session.subscribe;
      if (!valid() || !current(p)) {
        void close(p);
        return;
      }
      if (typeof subscribe !== 'function')
        throw new TypeError('A native subscription is required');
      const release = subscribe.call(session, () => observe(p));
      if (typeof release !== 'function')
        throw new TypeError('A callable subscription release is required');
      p.release = release;
      if (p.closed) {
        try {
          release();
        } catch {
          /* Revoked subscription. */
        }
      }
      if (!valid() || !current(p)) {
        void close(p);
        return;
      }
      return p;
    } catch (error) {
      if (primary === p) primary = undefined;
      void close(p);
      throw error;
    }
  }
  async function submit(text: string, generation = snapshot.viewGeneration) {
    if (
      disposed ||
      revoking ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      generation !== snapshot.viewGeneration ||
      typeof text !== 'string' ||
      !text.trim()
    )
      return;
    const { controller, valid } = admit('running', true);
    let p = primary;
    try {
      if (!valid()) return;
      p ??= install(valid);
      if (!p || !valid() || !current(p)) return;
      const selected = p;
      const ownedValid = () => valid() && current(selected);
      publish({ threadId: p.threadId });
      if (!ownedValid()) return;
      const initial = read(p, ownedValid);
      if (!ownedValid()) return;
      if (
        !initial ||
        initial.status !== 'idle' ||
        initial.decision ||
        p.unsafe ||
        initial.subagents.length
      ) {
        fail(p);
        return;
      }
      p.previous = initial.run?.id;
      p.turn = undefined;
      p.intent = 'submit';
      p.approval = undefined;
      const method = p.session.submit;
      if (!ownedValid()) return;
      const pending = method.call(p.session, text, {
        signal: controller.signal,
      });
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      observe(p);
      const outcome = await pending;
      if (!ownedValid()) return;
      const result = capture(p, ownedValid);
      if (!ownedValid()) return;
      if (outcome !== 'paused' || !result?.approval || p.unsafe) {
        fail(p, outcome);
        return;
      }
      p.approval = result.approval;
      publish({
        native: result.native,
        rows: result.rows,
        approval: p.approval,
        canRespond: true,
        canSubmit: false,
        reservation: 'pending',
        requiresNew: false,
        outcome,
      });
    } catch {
      if (valid()) {
        fail(p, 'error');
      }
    } finally {
      finish(controller);
    }
  }
  async function decide(
    approval: ReservationApproval,
    action: 'approve' | 'decline',
    generation = snapshot.viewGeneration
  ) {
    const p = primary;
    if (
      disposed ||
      revoking ||
      snapshot.busy ||
      !snapshot.canRespond ||
      generation !== snapshot.viewGeneration ||
      !p ||
      p.closed ||
      p.unsafe ||
      p.approval !== approval ||
      snapshot.approval !== approval ||
      !p.turn ||
      (action !== 'approve' && action !== 'decline')
    )
      return;
    // Claim before any caller-controlled methods/getters or synchronous view notification.
    const { controller, valid } = admit('running');
    const ownedValid = () => valid() && current(p);
    try {
      if (!ownedValid()) return;
      const native = read(p, ownedValid);
      if (!ownedValid()) return;
      const fresh = native && captureApproval(native, p.turn, ownedValid);
      if (!ownedValid()) return;
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(approval)) {
        fail(p);
        return;
      }
      p.intent = 'resume';
      p.resumeRunId = undefined;
      p.approved = action === 'approve';
      const method = p.session.resume;
      if (!ownedValid() || p.unsafe) return;
      const pending = method.call(
        p.session,
        approval.pause,
        [
          {
            interruptId: approval.interruptId,
            status: 'resolved',
            payload: { approved: p.approved },
          },
        ],
        { signal: controller.signal }
      );
      void pending.catch(() => undefined);
      if (!ownedValid()) return;
      observe(p);
      const outcome = await pending;
      if (!ownedValid()) return;
      const result = capture(p, ownedValid);
      if (!ownedValid()) return;
      if (outcome !== 'success' || !result?.confirmed || p.unsafe) {
        fail(p, outcome);
        return;
      }
      p.transcript = result.confirmed.transcript;
      p.approval = undefined;
      publish({
        native: result.native,
        rows: result.rows,
        approval: undefined,
        canRespond: false,
        canSubmit: true,
        requiresNew: false,
        reservation: p.approved ? 'approved' : 'declined',
        result: result.confirmed.result,
        outcome,
        error: null,
      });
    } catch {
      if (ownedValid()) {
        fail(p, 'error');
      }
    } finally {
      finish(controller);
    }
  }
  async function revoke(replacing: boolean) {
    if (disposed || revoking) return;
    revoking = true;
    const previousOperation = operation;
    operation = undefined;
    // Detach and mark closed before abort/release/stop/dispose can reenter.
    const { p, cleanup } = detach();
    previousOperation?.abort();
    const { controller, valid } = admit(replacing ? 'replacing' : 'running');
    publish({
      threadId: replacing ? null : snapshot.threadId,
      native: replacing ? undefined : snapshot.native,
      rows: replacing ? Object.freeze([]) : snapshot.rows,
      approval: undefined,
      canRespond: false,
      canSubmit: false,
      requiresNew: !replacing,
      reservation: replacing ? 'none' : 'unconfirmed',
      result: replacing ? null : snapshot.result,
      outcome: replacing ? null : 'aborted',
      error: replacing
        ? null
        : 'The operation stopped. Start a new conversation.',
      viewGeneration: snapshot.viewGeneration + 1,
    });
    try {
      if (p) {
        try {
          await p.session.stop();
        } catch {
          /* Detached execution cannot publish. */
        }
      }
      await cleanup;
      await Promise.all([...cleanups]);
      if (valid() && replacing) publish({ canSubmit: true });
    } finally {
      revoking = false;
      finish(controller);
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    const previous = operation;
    operation = undefined;
    void detach();
    previous?.abort();
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
    submit,
    decide,
    newConversation: () => revoke(true),
    stop: () => revoke(false),
    dispose,
  };
}
