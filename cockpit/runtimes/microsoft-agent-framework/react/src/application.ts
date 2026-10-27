import type { Session } from '@threadplane/ag-ui';
import {
  captureApproval,
  captureTurn,
  confirmResume,
  ownSnapshot,
  same,
  sameApproval,
  type ExpenseApproval,
  type NativeSnapshot,
  type OwnedTurn,
} from './approval-policy';
import { projectExpense, type ExpenseDraft } from './expense-projection';
export interface MafSnapshot {
  readonly generation: number;
  readonly threadId: string | null;
  readonly busy: boolean;
  readonly canSend: boolean;
  readonly canRespond: boolean;
  readonly rows: NativeSnapshot['transcript'];
  readonly draft: ExpenseDraft | undefined;
  readonly approval: ExpenseApproval | undefined;
  readonly result: string | null;
  readonly status:
    | 'ready'
    | 'running'
    | 'pending'
    | 'approved'
    | 'declined'
    | 'unconfirmed'
    | 'cleanup-failed'
    | 'replacing'
    | 'disposed';
  readonly error: string | null;
}
type Methods = { [K in keyof Session]: Session[K] };
type Owner = {
  readonly candidate: Session;
  readonly threadId: string;
  readonly methods: Methods;
  readonly seenRuns: Set<string>;
  closed: boolean;
  release?: () => void;
  turn?: OwnedTurn;
  approval?: ExpenseApproval;
  transcript: NativeSnapshot['transcript'];
  previous?: string;
  intent?: 'submit' | 'resume';
  resumeRunId?: string;
  approved?: boolean;
  unsafe: boolean;
};
/** Owns admission, observation and lifetime. Native Session alone executes the protocol. */
export function createMafApplication(options: {
  readonly sessionFactory: (threadId: string) => Session | Promise<Session>;
  readonly threadIdFactory?: () => string;
}) {
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Owner | undefined,
    operation: AbortController | undefined,
    disposed = false,
    cleanupFailed = false,
    revoking = false,
    disposal: Promise<void> | undefined;
  let snapshot: MafSnapshot = Object.freeze({
    generation: 0,
    threadId: null,
    busy: false,
    canSend: true,
    canRespond: false,
    rows: Object.freeze([]),
    draft: undefined,
    approval: undefined,
    result: null,
    status: 'ready',
    error: null,
  });
  const cleanupFailure: Partial<MafSnapshot> = Object.freeze({
    canSend: false,
    canRespond: false,
    approval: undefined,
    result: null,
    status: 'cleanup-failed',
    error:
      'The conversation could not close safely. Reload the preview to continue.',
  });
  function failCleanup() {
    // A successful fallback cannot erase an earlier owned cleanup failure.
    cleanupFailed = true;
    publish(cleanupFailure);
  }
  function publish(update: Partial<MafSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      ...(cleanupFailed ? cleanupFailure : {}),
    });
    for (const notify of [...listeners]) {
      try {
        notify();
      } catch {
        /* An observer cannot prevent revocation. */
      }
    }
  }
  function track(promise: Promise<unknown>) {
    const done = promise.then(
      () => undefined,
      () => undefined
    );
    cleanups.add(done);
    void done.then(() => cleanups.delete(done));
    return done;
  }
  async function drain() {
    while (cleanups.size) await Promise.all([...cleanups]);
  }
  function current(p: Owner) {
    return !disposed && !cleanupFailed && primary === p && !p.closed;
  }
  function cleanupCandidate(
    candidate: unknown,
    methods?: Partial<Methods>,
    release?: () => void
  ) {
    // Authority and the rendered controls have already been revoked by the caller.
    const done = track(
      Promise.resolve()
        .then(async () => {
          let dispose = methods?.dispose;
          try {
            dispose ??= (candidate as Session)?.dispose;
          } catch {
            failCleanup();
          }
          if (typeof dispose === 'function') {
            try {
              await dispose.call(candidate);
              return;
            } catch {
              failCleanup();
            }
          }
          let stop = methods?.stop;
          try {
            stop ??= (candidate as Session)?.stop;
          } catch {
            failCleanup();
          }
          if (typeof stop === 'function') {
            try {
              await stop.call(candidate);
            } catch {
              failCleanup();
            }
          } else failCleanup();
        })
        .catch(() => {
          // Preserve failure before the settlement-only tracking barrier.
          failCleanup();
        })
    );
    try {
      release?.();
    } catch {
      // The cleanup barrier is registered before publishing to reentrant observers.
      failCleanup();
    }
    return done;
  }
  function close(p: Owner) {
    p.closed = true;
    const release = p.release;
    p.release = undefined;
    return cleanupCandidate(p.candidate, p.methods, release);
  }
  function fail(p?: Owner, bootstrap = false) {
    if (p && !current(p)) return;
    let prepared: (() => void) | undefined;
    if (p) {
      p.unsafe = true;
      p.approval = undefined;
      if (bootstrap) {
        primary = undefined;
        p.closed = true;
        // Observers may dispose after detachment but before release. Keep every
        // disposal behind preparation until candidate cleanup is registered.
        track(
          new Promise<void>((resolve) => {
            prepared = resolve;
          })
        );
      }
    }
    publish({
      canSend: false,
      canRespond: false,
      approval: undefined,
      result: null,
      status: 'unconfirmed',
      error:
        'The expense outcome could not be confirmed. Start a new conversation.',
    });
    if (p && bootstrap) {
      try {
        void close(p);
      } finally {
        prepared?.();
      }
    }
  }
  function read(p: Owner, valid: () => boolean) {
    if (!valid()) return;
    const native = p.methods.getSnapshot.call(p.candidate);
    if (!valid()) return;
    return ownSnapshot(native, valid);
  }
  function capture(p: Owner, valid: () => boolean) {
    const native = read(p, valid);
    if (
      !native ||
      !valid() ||
      !Array.isArray(native.transcript) ||
      !Array.isArray(native.subagents)
    )
      return;
    if (native.status === 'error') p.unsafe = true;
    if (p.intent === 'submit' && !p.turn) {
      const turn = captureTurn(
        native,
        p.threadId,
        p.previous,
        p.transcript,
        valid
      );
      if (turn) {
        if (p.seenRuns.has(turn.runId)) p.unsafe = true;
        else {
          p.turn = turn;
          p.seenRuns.add(turn.runId);
        }
      }
    }
    if (
      p.intent === 'resume' &&
      !p.resumeRunId &&
      p.approval &&
      native.status === 'running' &&
      typeof native.run?.id === 'string' &&
      native.run.id !== p.approval.sourceRunId &&
      native.decision?.kind === 'native' &&
      native.decision.id === p.approval.pause &&
      native.decision.sourceRunId === p.approval.sourceRunId &&
      native.decision.attempt?.runId === native.run?.id
    ) {
      if (p.seenRuns.has(native.run.id)) p.unsafe = true;
      else {
        p.resumeRunId = native.run.id;
        p.seenRuns.add(native.run.id);
      }
    }
    const approval =
      p.intent === 'submit' && p.turn && !p.unsafe
        ? captureApproval(native, p.turn, valid)
        : undefined;
    const confirmed =
      p.intent === 'resume' &&
      p.approval &&
      p.resumeRunId &&
      typeof p.approved === 'boolean' &&
      !p.unsafe
        ? confirmResume(native, p.approval, p.resumeRunId, p.approved, valid)
        : undefined;
    return valid()
      ? {
          native,
          rows: Object.freeze(
            native.transcript.filter((m) => m.subagentRunId === undefined)
          ),
          draft: projectExpense(native.state),
          approval,
          confirmed,
        }
      : undefined;
  }
  function observe(p: Owner) {
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
          !p.approval ||
          !sameApproval(result.approval, p.approval))
      ) {
        fail(p);
        return;
      }
      publish({ rows: result.rows, draft: result.draft });
    } catch {
      if (valid()) fail(p);
    }
  }
  function claim(status: 'running' | 'replacing') {
    const controller = new AbortController();
    operation = controller;
    const valid = () =>
      !disposed &&
      !cleanupFailed &&
      operation === controller &&
      !controller.signal.aborted;
    publish({
      busy: true,
      canSend: false,
      canRespond: false,
      approval: undefined,
      result: null,
      status,
      error: null,
    });
    return { controller, valid };
  }
  function finish(controller: AbortController) {
    if (!disposed && operation === controller) {
      operation = undefined;
      publish({ busy: false });
    }
  }
  async function install(valid: () => boolean): Promise<Owner | undefined> {
    if (!valid()) return;
    const threadIdFactory =
      options.threadIdFactory ?? (() => crypto.randomUUID());
    if (!valid()) return;
    const threadId = threadIdFactory();
    if (!valid()) return;
    if (typeof threadId !== 'string' || !threadId || threadId.length > 500)
      throw TypeError('A thread identifier is required');
    const factory = options.sessionFactory;
    if (!valid()) return;
    // Track late bootstrap so New/dispose cannot finish ahead of candidate cleanup.
    let resolveCandidate!: (candidate: Session | Promise<Session>) => void,
      rejectCandidate!: (error: unknown) => void;
    const candidatePromise = new Promise<Session>((resolve, reject) => {
      resolveCandidate = resolve;
      rejectCandidate = reject;
    });
    track(
      candidatePromise.then((candidate) => {
        if (!valid()) return cleanupCandidate(candidate);
        return undefined;
      })
    );
    try {
      resolveCandidate(factory(threadId));
    } catch (error) {
      rejectCandidate(error);
    }
    const candidate = await candidatePromise;
    if (!valid()) return;
    const methods: Partial<Methods> = {};
    let release: (() => void) | undefined,
      p: Owner | undefined,
      cleanupAccessFailed = false;
    try {
      if (
        candidate === null ||
        (typeof candidate !== 'object' && typeof candidate !== 'function')
      )
        throw TypeError('A native Session is required');
      for (const name of [
        'getSnapshot',
        'subscribe',
        'submit',
        'resume',
        'stop',
        'dispose',
      ] as const) {
        let method: unknown;
        try {
          method = candidate[name];
        } catch (error) {
          cleanupAccessFailed = name === 'stop' || name === 'dispose';
          throw error;
        }
        if (!valid()) {
          void cleanupCandidate(candidate, methods);
          return;
        }
        if (typeof method !== 'function')
          throw TypeError('A complete native Session is required');
        Object.defineProperty(methods, name, {
          value: method,
          enumerable: true,
        });
      }
      p = {
        candidate,
        threadId,
        methods: methods as Methods,
        seenRuns: new Set(),
        closed: false,
        transcript: Object.freeze([]),
        unsafe: false,
      };
      const selected = p;
      const result = p.methods.subscribe.call(candidate, () => {
        if (primary === selected) observe(selected);
      });
      if (typeof result !== 'function')
        throw TypeError('A callable release is required');
      release = result;
      if (!valid()) {
        p.closed = true;
        void cleanupCandidate(candidate, methods, release);
        return;
      }
      // Only a complete callable candidate with its release in hand can become authoritative.
      p.release = release;
      primary = p;
      return p;
    } catch (error) {
      if (p) p.closed = true;
      void cleanupCandidate(candidate, methods, release);
      // Register owned cleanup before notifying reentrant observers. A later
      // successful disposal cannot erase an observed cleanup accessor failure.
      if (cleanupAccessFailed) failCleanup();
      throw error;
    }
  }
  async function submit(message: string, generation = snapshot.generation) {
    if (
      disposed ||
      cleanupFailed ||
      revoking ||
      snapshot.busy ||
      !snapshot.canSend ||
      generation !== snapshot.generation ||
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 16000
    )
      return;
    const { controller, valid } = claim('running');
    let p = primary;
    let bootstrapping = true;
    try {
      if (!valid()) return;
      await drain();
      if (!valid()) return;
      p ??= await install(valid);
      if (!p || !valid() || !current(p)) return;
      const owner = p,
        ownedValid = () => valid() && current(owner);
      publish({ threadId: p.threadId });
      if (!ownedValid()) return;
      const initial = read(p, ownedValid);
      if (!ownedValid()) return;
      if (
        !initial ||
        initial.status !== 'idle' ||
        initial.decision ||
        p.unsafe ||
        !same(
          initial.transcript.filter((m) => m.subagentRunId === undefined),
          p.transcript
        )
      ) {
        fail(p, true);
        return;
      }
      bootstrapping = false;
      p.previous = initial.run?.id;
      p.turn = undefined;
      p.intent = 'submit';
      p.approval = undefined;
      const pending = p.methods.submit.call(p.candidate, message, {
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
        fail(p);
        return;
      }
      p.approval = result.approval;
      publish({
        rows: result.rows,
        draft: result.draft,
        approval: p.approval,
        canRespond: true,
        canSend: false,
        status: 'pending',
      });
    } catch {
      if (valid()) fail(p, bootstrapping);
    } finally {
      finish(controller);
    }
  }
  async function decide(
    approval: ExpenseApproval,
    action: 'approve' | 'decline',
    generation = snapshot.generation
  ) {
    const p = primary;
    if (
      disposed ||
      cleanupFailed ||
      revoking ||
      snapshot.busy ||
      !snapshot.canRespond ||
      generation !== snapshot.generation ||
      !p ||
      p.closed ||
      p.unsafe ||
      p.approval !== approval ||
      snapshot.approval !== approval ||
      !p.turn ||
      (action !== 'approve' && action !== 'decline')
    )
      return;
    // Claim synchronously before getters, native execution or observer notification.
    const { controller, valid } = claim('running'),
      ownedValid = () => valid() && current(p);
    try {
      if (!ownedValid()) return;
      const native = read(p, ownedValid),
        fresh = native && captureApproval(native, p.turn, ownedValid);
      if (!ownedValid()) return;
      if (!fresh || !sameApproval(fresh, approval)) {
        fail(p);
        return;
      }
      p.intent = 'resume';
      p.resumeRunId = undefined;
      p.approved = action === 'approve';
      const pending = p.methods.resume.call(
        p.candidate,
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
        fail(p);
        return;
      }
      p.transcript = result.confirmed.transcript;
      p.approval = undefined;
      publish({
        rows: result.rows,
        draft: result.draft,
        approval: undefined,
        canRespond: false,
        canSend: true,
        status: p.approved ? 'approved' : 'declined',
        result: result.confirmed.result,
        error: null,
      });
    } catch {
      if (ownedValid()) fail(p);
    } finally {
      finish(controller);
    }
  }
  async function revoke(replacing: boolean) {
    if (disposed || cleanupFailed || revoking) return;
    revoking = true;
    const previous = operation,
      p = primary;
    operation = undefined;
    primary = undefined;
    if (p) {
      p.closed = true;
      p.approval = undefined;
    }
    // A view notification can dispose while the old owner is already detached.
    // Keep that disposal behind preparation until the old cleanup is registered.
    let prepared!: () => void;
    track(
      new Promise<void>((resolve) => {
        prepared = resolve;
      })
    );
    // Clear controls and result before abort/release/cleanup can inspect or reenter.
    const { controller, valid } = claim(replacing ? 'replacing' : 'running');
    publish({
      generation: snapshot.generation + 1,
      threadId: replacing ? null : snapshot.threadId,
      rows: replacing ? Object.freeze([]) : snapshot.rows,
      draft: replacing ? undefined : snapshot.draft,
      approval: undefined,
      result: null,
      canRespond: false,
      canSend: false,
      status: replacing ? 'replacing' : 'unconfirmed',
      error: replacing
        ? null
        : 'The operation stopped. Start a new conversation.',
    });
    try {
      previous?.abort();
      if (p) void close(p);
    } finally {
      prepared();
    }
    try {
      await drain();
      if (valid() && replacing) publish({ canSend: true, status: 'ready' });
    } finally {
      revoking = false;
      finish(controller);
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    let settled!: () => void;
    disposal = new Promise<void>((resolve) => {
      settled = resolve;
    });
    disposed = true;
    const previous = operation,
      p = primary;
    operation = undefined;
    primary = undefined;
    if (p) {
      p.closed = true;
      p.approval = undefined;
    }
    snapshot = Object.freeze({
      ...snapshot,
      generation: snapshot.generation + 1,
      busy: false,
      canSend: false,
      canRespond: false,
      approval: undefined,
      result: null,
      status: 'disposed',
    });
    listeners.clear();
    previous?.abort();
    if (p) void close(p);
    void drain().then(settled);
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
