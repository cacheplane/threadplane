import type { Session } from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import type { RenderSpecData } from '@threadplane/react/render';
import {
  captureTurn,
  confirmTranscript,
  selectDashboard,
  unsupportedSnapshot,
  type DashboardProjection,
  type NativeSnapshot,
  type OwnedTurn,
} from './dashboard-policy';
import { dashboardState } from './dashboard-data';

export interface DashboardSurface {
  readonly ownerId: string;
  readonly spec: RenderSpecData;
}
export interface DashboardSnapshot {
  readonly threadId: string | null;
  readonly native: NativeSnapshot | undefined;
  readonly projection: DashboardProjection | null;
  readonly surfaces: readonly DashboardSurface[];
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly activity: 'idle' | 'running' | 'replacing';
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}

/** Owns lifetime and admission; the native session owns all protocol execution. */
export function createDashboardApplication(options: {
  readonly sessionFactory: (threadId: string) => Session;
}) {
  type Primary = {
    session: Session;
    threadId: string;
    closed: boolean;
    release?: () => void;
    unsafe: boolean;
    confirmed: NativeSnapshot['transcript'];
    projection: DashboardProjection | null;
    surfaces: readonly DashboardSurface[];
    previousRunId?: string;
    turn?: OwnedTurn;
  };
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let primary: Primary | undefined;
  let operation: AbortController | undefined;
  let disposed = false,
    disposal: Promise<void> | undefined;
  let snapshot: DashboardSnapshot = Object.freeze({
    threadId: null,
    native: undefined,
    projection: null,
    surfaces: Object.freeze([]),
    busy: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
  });
  function publish(update: Partial<DashboardSnapshot>) {
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
    const blocked = unsupportedSnapshot(root, valid);
    return valid() ? { root, blocked } : undefined;
  }
  function capture(selected: Primary, valid: () => boolean) {
    const state = read(selected, valid);
    if (!state || !valid()) return;
    selected.unsafe ||= state.blocked;
    if (!selected.turn && snapshot.activity === 'running') {
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
    const confirmed =
      selected.turn && !selected.unsafe
        ? confirmTranscript(state.root, selected.turn, valid)
        : undefined;
    if (!valid()) return;
    const accepted =
      confirmed && selected.turn
        ? selectDashboard(
            state.root,
            selected.turn,
            selected.projection ?? undefined,
            valid
          )
        : undefined;
    if (!valid()) return;
    const displayState = dashboardState(state.root.state);
    const projection =
      selected.projection && displayState
        ? Object.freeze({ ...selected.projection, state: displayState })
        : selected.projection;
    return valid()
      ? { native: state.root, projection, confirmed, accepted }
      : undefined;
  }
  function observe(selected: Primary) {
    const valid = () => current(selected);
    try {
      const result = capture(selected, valid);
      if (!result || !valid()) return;
      publish({
        native: result.native,
        projection: result.projection,
        surfaces: selected.surfaces,
        ...(selected.unsafe ? { canSubmit: false } : {}),
      });
    } catch {
      if (valid()) {
        selected.unsafe = true;
        publish({
          canSubmit: false,
          error:
            'The dashboard result could not be confirmed. Start a new conversation.',
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
      projection: null,
      surfaces: Object.freeze([]),
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
  function admit(activity: DashboardSnapshot['activity'], execution: boolean) {
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
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
          error:
            'The dashboard session is unavailable. Start a new conversation.',
        });
      return;
    }
    if (!initialValid()) return;
    if (before && (before.unsafe || state?.blocked)) {
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
        outcome === 'success' &&
        !!result.confirmed &&
        !!result.accepted &&
        !selected.unsafe;
      if (safe) {
        selected.confirmed = result.confirmed!;
        selected.projection = result.accepted!;
        const { ownerId, spec } = selected.projection;
        if (
          ownerId &&
          spec &&
          !selected.surfaces.some((surface) => surface.ownerId === ownerId)
        )
          selected.surfaces = Object.freeze([
            ...selected.surfaces,
            Object.freeze({ ownerId, spec }),
          ]);
      }
      publish({
        native: result.native,
        projection: safe ? selected.projection : result.projection,
        surfaces: selected.surfaces,
        outcome,
        canSubmit: safe,
        error: safe
          ? null
          : 'The current dashboard outcome could not be confirmed. Start a new conversation.',
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
  async function newConversation() {
    if (disposed || snapshot.busy) return;
    const { admitted, valid } = admit('replacing', false);
    const cleanup = detach();
    try {
      if (!valid()) return;
      publish({
        threadId: null,
        native: undefined,
        projection: null,
        surfaces: Object.freeze([]),
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
    newConversation,
    stop,
    dispose,
  };
}
