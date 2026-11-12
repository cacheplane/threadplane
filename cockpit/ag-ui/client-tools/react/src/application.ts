import type {
  ClientToolSession,
  ClientToolSessionSnapshot,
} from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import type { ToolContracts } from '@threadplane/core/tools';
import {
  createClientToolsController,
  validateBookingArguments,
  type BookingInvocation,
  type BookingPanel,
} from './tools';
import {
  projectClientToolViews,
  type ClientToolMessageView,
} from './projection';

export type ToolsController = ReturnType<typeof createClientToolsController>;
export type Tools = ToolsController['tools'];
export type NativeSession = ClientToolSession<ToolContracts<Tools>>;
export type NativeSnapshot = ClientToolSessionSnapshot<ToolContracts<Tools>>;
export interface ClientToolsApplicationSnapshot {
  readonly threadId: string | null;
  readonly native: NativeSnapshot | undefined;
  readonly views: readonly ClientToolMessageView[];
  readonly bookings: readonly BookingPanel[];
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly activity: 'idle' | 'running' | 'replacing';
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
/** App lifetime and explicit controls only. All protocol execution belongs to the native owner. */
export function createClientToolsApplication(options: {
  readonly sessionFactory: (threadId: string, tools: Tools) => NativeSession;
}) {
  type Primary = {
    readonly generation: number;
    readonly threadId: string;
    readonly tools: ToolsController;
    session?: NativeSession;
    closed: boolean;
    unsafe: boolean;
    release?: () => void;
    releaseTools?: () => void;
  };
  type Operation = { readonly controller: AbortController; owner?: Primary };
  const listeners = new Set<() => void>();
  let primary: Primary | undefined, operation: Operation | undefined;
  let generation = 0,
    disposed = false;
  let snapshot: ClientToolsApplicationSnapshot = Object.freeze({
    threadId: null,
    native: undefined,
    views: Object.freeze([]),
    bookings: Object.freeze([]),
    busy: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<ClientToolsApplicationSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    const publication = snapshot;
    for (const notify of [...listeners]) {
      if (disposed || snapshot !== publication) break;
      try {
        notify();
      } catch {
        /* A view cannot interrupt execution or cleanup. */
      }
    }
  }
  function current(owner: Primary, admitted?: Operation) {
    return (
      !disposed &&
      primary === owner &&
      generation === owner.generation &&
      !owner.closed &&
      (!admitted ||
        (operation === admitted &&
          admitted.owner === owner &&
          !admitted.controller.signal.aborted))
    );
  }
  // Observe every cleanup rejection without waiting for arbitrary foreign promises.
  function cleanup(action: () => unknown) {
    try {
      void Promise.resolve(action()).catch(() => undefined);
    } catch {
      /* Revoked candidates cannot publish. */
    }
  }
  function close(owner: Primary) {
    if (owner.closed) return;
    owner.closed = true;
    cleanup(() => owner.release?.());
    cleanup(() => owner.releaseTools?.());
    owner.tools.dispose();
    const session = owner.session;
    if (session) {
      cleanup(() => session.stop());
      cleanup(() => session.dispose());
    }
  }
  function read(owner: Primary, valid: () => boolean) {
    if (!valid() || !owner.session) return;
    const session = owner.session;
    const getSnapshot = session.getSnapshot;
    if (!valid()) return;
    const native = getSnapshot.call(session);
    return valid() ? native : undefined;
  }
  function booking(owner: Primary): BookingInvocation | undefined {
    const admitted = operation;
    const valid = () => !!admitted && current(owner, admitted) && snapshot.busy;
    if (!valid()) return;
    const native = read(owner, valid);
    if (!native || !valid() || native.clientTools.blocker || !native.run?.id)
      return;
    const calls = native.clientTools.calls.filter(
      (call) =>
        call.provenance === 'local' &&
        call.name === 'confirm_booking' &&
        call.status === 'running'
    );
    if (!valid() || calls.length !== 1) return;
    const call = calls[0];
    if (call.sourceRunId !== native.run.id) return;
    const { summary } = validateBookingArguments(call.args);
    if (!valid()) return;
    const identity = Object.freeze({
      ownerGeneration: owner.generation,
      callId: call.callId,
      assistantMessageId: call.assistantMessageId,
      sourceRunId: call.sourceRunId,
      summary,
    });
    return valid() ? identity : undefined;
  }
  function capture(owner: Primary, valid: () => boolean) {
    const native = read(owner, valid);
    if (!native || !valid()) return;
    const views = projectClientToolViews(native, valid);
    if (!valid()) return;
    const bookings = owner.tools.getSnapshot().bookings;
    return valid() ? { native, views, bookings } : undefined;
  }
  function observe(owner: Primary) {
    const admitted = operation;
    const valid = () =>
      current(owner) && (!admitted || current(owner, admitted));
    try {
      const result = capture(owner, valid);
      if (result && valid()) publish(result);
    } catch {
      if (valid()) {
        owner.unsafe = true;
        publish({
          canSubmit: false,
          error:
            'The client tool session is unavailable. Start a new conversation.',
        });
      }
    }
  }
  function install(admitted: Operation): Primary | undefined {
    const valid = () =>
      !disposed &&
      operation === admitted &&
      !admitted.controller.signal.aborted;
    if (!valid()) return;
    const threadId = crypto.randomUUID();
    if (!valid()) return;
    const tools = createClientToolsController(() => booking(owner));
    const owner: Primary = {
      threadId,
      generation: ++generation,
      tools,
      closed: false,
      unsafe: false,
    };
    if (!valid()) {
      close(owner);
      return;
    }
    primary = owner;
    admitted.owner = owner;
    try {
      const factory = options.sessionFactory;
      if (!current(owner, admitted)) return;
      const session = factory.call(options, threadId, tools.tools);
      owner.session = session;
      if (!current(owner, admitted)) {
        close(owner);
        cleanup(() => session.dispose());
        return;
      }
      const releaseTools = tools.subscribe(() => observe(owner));
      owner.releaseTools = releaseTools;
      if (!current(owner, admitted)) {
        cleanup(releaseTools);
        close(owner);
        return;
      }
      const subscribe = session.subscribe;
      if (!current(owner, admitted)) return;
      const release = subscribe.call(session, () => observe(owner));
      owner.release = release;
      if (!current(owner, admitted)) {
        cleanup(release);
        close(owner);
        return;
      }
      const initial = capture(owner, () => current(owner, admitted));
      if (!initial || !current(owner, admitted)) {
        close(owner);
        return;
      }
      publish({ threadId, ...initial });
      return current(owner, admitted) ? owner : undefined;
    } catch (error) {
      close(owner);
      if (primary === owner) primary = undefined;
      throw error;
    }
  }
  function eligible(native: NativeSnapshot, valid: () => boolean) {
    if (!valid()) return false;
    const status = native.status;
    if (!valid() || status !== 'idle') return false;
    const tools = native.clientTools;
    if (!valid()) return false;
    const outcome = tools.commandOutcome;
    if (!valid() || outcome !== 'success') return false;
    const blocker = tools.blocker;
    if (!valid() || blocker) return false;
    const decision = native.decision;
    if (!valid() || decision) return false;
    const failed = tools.calls.some(
      (call) => call.status === 'error' || call.status === 'cancelled'
    );
    if (!valid() || failed) return false;
    const child = native.transcript.some(
      (message) =>
        message.role === 'assistant' &&
        typeof message.subagentRunId === 'string' &&
        !!message.toolCalls?.length
    );
    return valid() && !child;
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
    const before = primary;
    const initialValid = () =>
      !disposed &&
      !snapshot.busy &&
      snapshot.canSubmit &&
      primary === before &&
      !before?.closed;
    try {
      if (before) {
        const native = read(before, initialValid);
        if (!native || !initialValid()) return;
        const safe = !before.unsafe && eligible(native, initialValid);
        if (!initialValid()) return;
        if (!safe) {
          publish({
            canSubmit: false,
            error: 'Start a new conversation to continue.',
          });
          return;
        }
      }
    } catch {
      if (initialValid())
        publish({
          canSubmit: false,
          error:
            'The client tool session is unavailable. Start a new conversation.',
        });
      return;
    }
    if (!initialValid()) return;
    const admitted: Operation = {
      controller: new AbortController(),
      owner: before,
    };
    operation = admitted;
    const valid = () =>
      !disposed &&
      operation === admitted &&
      !admitted.controller.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity: 'running',
      outcome: null,
      error: null,
    });
    try {
      if (!valid()) return;
      const owner = before ?? install(admitted);
      if (!owner || !current(owner, admitted) || !owner.session) return;
      const session = owner.session;
      const execute = session.submit;
      if (!current(owner, admitted)) return;
      const pending = execute.call(session, text, {
        signal: admitted.controller.signal,
      });
      // Adoption observes late rejection even if callbacks detach the owner immediately.
      void Promise.resolve(pending).catch(() => undefined);
      if (!current(owner, admitted)) return;
      const outcome = await pending;
      if (!current(owner, admitted)) return;
      const result = capture(owner, () => current(owner, admitted));
      if (!result || !current(owner, admitted)) return;
      const safe =
        outcome === 'success' &&
        eligible(result.native, () => current(owner, admitted)) &&
        !owner.unsafe;
      if (!current(owner, admitted)) return;
      owner.unsafe ||= !safe;
      publish({
        ...result,
        outcome,
        canSubmit: safe,
        error: safe
          ? null
          : 'The client tool command did not complete safely. Start a new conversation.',
      });
    } catch {
      if (valid()) {
        if (admitted.owner) admitted.owner.unsafe = true;
        publish({
          canSubmit: false,
          outcome: 'error',
          error: 'The AG-UI request failed. Start a new conversation.',
        });
      }
    } finally {
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    const admitted = operation,
      owner = primary;
    operation = undefined;
    primary = undefined;
    admitted.controller.abort();
    if (owner) close(owner);
    publish({
      busy: false,
      canSubmit: false,
      activity: 'idle',
      outcome: 'aborted',
      ...(owner ? { bookings: owner.tools.getSnapshot().bookings } : {}),
      error: 'The operation stopped. Start a new conversation.',
    });
  }
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const replacement: Operation = { controller: new AbortController() };
    operation = replacement;
    const valid = () =>
      !disposed &&
      operation === replacement &&
      !replacement.controller.signal.aborted;
    publish({ busy: true, canSubmit: false, activity: 'replacing' });
    if (!valid()) return;
    const owner = primary;
    primary = undefined;
    generation++;
    if (owner) close(owner);
    if (!valid()) return;
    operation = undefined;
    publish({
      threadId: null,
      native: undefined,
      views: Object.freeze([]),
      bookings: Object.freeze([]),
      busy: false,
      canSubmit: true,
      activity: 'idle',
      outcome: null,
      error: null,
      viewGeneration: snapshot.viewGeneration + 1,
    });
  }
  function respond(token: string, decision: boolean) {
    const owner = primary,
      admitted = operation;
    if (!owner || !admitted || !current(owner, admitted) || !snapshot.busy)
      return false;
    return owner.tools.respond(token, decision);
  }
  function dispose(): Promise<void> {
    if (disposed) return Promise.resolve();
    disposed = true;
    const owner = primary;
    primary = undefined;
    const admitted = operation;
    operation = undefined;
    generation++;
    admitted?.controller.abort();
    if (owner) close(owner);
    listeners.clear();
    return Promise.resolve();
  }
  return Object.freeze({
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
    respond,
    dispose,
  });
}
