import type { Session } from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';
import {
  createNativeObservation,
  type NativeObservation,
  type NativeSnapshot,
  type OrdinaryMessage,
} from './terminal';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Internal package-less shared flight presentation.
import {
  createFlightSurface,
  copyData,
  type FlightSurface,
  type SurfaceView,
  type SurfaceKind,
} from '../../../../../libs/cockpit-a2ui-react/src/index';
export interface A2uiSnapshot {
  readonly threadId: string | null;
  readonly native: NativeSnapshot | undefined;
  readonly messages: readonly OrdinaryMessage[];
  readonly surfaces: readonly SurfaceView[];
  readonly activeSurface: string | null;
  readonly activity: 'idle' | 'running' | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly error: string | null;
  readonly outcome: CompleteOutcome | null;
  readonly viewGeneration: number;
}
/** Native Session owns protocol execution; this owner admits confirmed flight views. */
export function createA2uiApplication(options: {
  readonly sessionFactory: (threadId: string) => Session;
}) {
  type Owner = {
    readonly session: Session;
    readonly threadId: string;
    readonly runIds: Set<string>;
    release?: () => void;
    observation?: NativeObservation;
    pendingSubmit?: Promise<CompleteOutcome>;
    submitOutcome?: unknown;
    closed: boolean;
  };
  const listeners = new Set<{ notify: () => void }>(),
    surfaces = new Set<FlightSurface>();
  const sessions = new WeakSet<object>(),
    threads = new Set<string>(),
    cleanups = new Set<Promise<void>>();
  let owner: Owner | undefined,
    operation: AbortController | undefined,
    active: FlightSurface | undefined;
  let revoked = false,
    generation = 0,
    sequence = 0,
    disposal: Promise<void> | undefined;
  let snapshot: A2uiSnapshot = Object.freeze({
    threadId: null,
    native: undefined,
    messages: Object.freeze([]),
    surfaces: Object.freeze([]),
    activeSurface: null,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    error: null,
    outcome: null,
    viewGeneration: 0,
  });
  function publish(change: Partial<A2uiSnapshot>) {
    if (revoked) return;
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const registration of [...listeners]) {
      if (revoked) break;
      if (listeners.has(registration))
        try {
          registration.notify();
        } catch {
          /* A view cannot interrupt ownership. */
        }
    }
  }
  function track(work: () => unknown) {
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(work()).then(
        () => undefined,
        () => undefined
      );
    } catch {
      pending = Promise.resolve();
    }
    cleanups.add(pending);
    void pending.then(() => cleanups.delete(pending));
    return pending;
  }
  function close(selected: Owner, stop: boolean) {
    if (selected.closed) return;
    selected.closed = true;
    selected.observation = undefined;
    try {
      selected.release?.();
    } catch {
      /* Revoked callbacks have no authority. */
    }
    selected.release = undefined;
    // stop() is void-valued; the original pending submit owns its eventual outcome.
    if (stop) track(() => selected.session.stop());
    track(() => selected.session.dispose());
  }
  function detach(stop: boolean) {
    const selected = owner;
    owner = undefined;
    if (selected) close(selected, stop);
  }
  function retireActive() {
    const selected = active;
    active = undefined;
    selected?.dispose();
  }
  function read(selected: Owner, valid: () => boolean) {
    if (!valid()) return;
    const getSnapshot = selected.session.getSnapshot;
    if (!valid()) return;
    const value = getSnapshot.call(selected.session);
    if (!valid()) return;
    const captured = copyData(value) as unknown as NativeSnapshot;
    return valid() ? captured : undefined;
  }
  function observe(selected: Owner, valid: () => boolean) {
    if (!valid()) return;
    try {
      const native = read(selected, valid);
      if (!native || !valid()) return;
      selected.observation?.observe(native);
      if (!valid()) return;
      const identity = selected.observation?.identity();
      if (!valid()) return;
      // Bind identity before any application listener can replace or stop the owner.
      if (identity) selected.runIds.add(identity.runId);
      publish({ native });
    } catch {
      if (valid()) {
        operation?.abort();
        operation = undefined;
        retireActive();
        detach(true);
        publish({
          busy: false,
          activity: 'idle',
          canSubmit: false,
          activeSurface: null,
          error:
            'The native response is unavailable. Start a new conversation.',
        });
      }
    }
  }
  function install(valid: () => boolean): Owner | undefined {
    const threadId = crypto.randomUUID();
    if (!valid()) return;
    if (!threadId || threads.has(threadId))
      throw Error('Reused thread identity');
    threads.add(threadId);
    const sessionFactory = options.sessionFactory;
    if (!valid()) return;
    const session = sessionFactory.call(options, threadId);
    if (!session || typeof session !== 'object')
      throw Error('Unavailable native owner');
    const selected: Owner = {
      session,
      threadId,
      runIds: new Set(),
      closed: false,
    };
    if (!valid()) {
      close(selected, true);
      return;
    }
    if (sessions.has(session)) throw Error('Reused native owner');
    sessions.add(session);
    owner = selected;
    for (const method of [
      'getSnapshot',
      'subscribe',
      'submit',
      'stop',
      'dispose',
      'resume',
    ] as const) {
      if (typeof session[method] !== 'function')
        throw Error('Unavailable native owner');
      if (!valid() || owner !== selected || selected.closed) return;
    }
    const subscribe = session.subscribe;
    if (!valid() || owner !== selected || selected.closed) return;
    const release = subscribe.call(session, () => {
      const selectedOperation = operation;
      if (!selectedOperation || !selected.observation) return;
      observe(
        selected,
        () =>
          !revoked &&
          owner === selected &&
          !selected.closed &&
          operation === selectedOperation &&
          !selectedOperation.signal.aborted
      );
    });
    if (typeof release !== 'function')
      throw Error('Unavailable native observation');
    selected.release = release;
    if (selected.closed || !valid() || owner !== selected) {
      try {
        release();
      } catch {
        /* Cleanup is best effort after revocation. */
      }
      if (!selected.closed) close(selected, true);
      return;
    }
    const initial = read(selected, valid);
    if (!valid()) return;
    if (
      !initial ||
      initial.status !== 'idle' ||
      initial.transcript.length ||
      initial.subagents.length ||
      initial.decision ||
      initial.run
    )
      throw Error('Native owner is not fresh');
    return selected;
  }
  async function submit(
    text: string,
    expected: SurfaceKind = 'booking'
  ): Promise<boolean> {
    if (
      revoked ||
      operation ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      typeof text !== 'string' ||
      !text.trim()
    )
      return false;
    const admitted = new AbortController();
    operation = admitted;
    const valid = () =>
      !revoked && operation === admitted && !admitted.signal.aborted;
    retireActive();
    publish({
      busy: true,
      canSubmit: false,
      activeSurface: null,
      activity: 'running',
      error: null,
      outcome: null,
    });
    let selected: Owner | undefined;
    try {
      if (!valid()) return false;
      selected = owner ?? install(valid);
      if (!selected || !valid() || selected.closed) return false;
      const chosen = selected;
      const current = () => valid() && owner === chosen && !chosen.closed;
      const observation = createNativeObservation({
        owner: chosen,
        generation: ++generation,
        threadId: chosen.threadId,
        message: text,
        previous: snapshot.messages,
        usedRunIds: [...chosen.runIds],
        valid: current,
      });
      if (!current()) return false;
      chosen.observation = observation;
      publish({ threadId: chosen.threadId });
      if (!current()) return false;
      const submitNative = chosen.session.submit;
      if (!current()) return false;
      const pending = submitNative.call(chosen.session, text, {
        signal: admitted.signal,
      });
      chosen.pendingSubmit = pending;
      // Retain the actual native outcome even when Stop/New has detached publication.
      void pending.then(
        (value) => {
          chosen.submitOutcome = value;
        },
        (error) => {
          chosen.submitOutcome = error;
        }
      );
      const outcome = await pending;
      if (!current()) return false;
      const native = read(chosen, current);
      if (!native || !current()) return false;
      const messages = observation.confirm(outcome, native);
      if (!current()) return false;
      const reported = [
        'success',
        'error',
        'aborted',
        'paused',
        'interrupted',
      ].includes(outcome)
        ? outcome
        : null;
      if (!messages) {
        detach(false);
        operation = undefined;
        publish({
          native,
          outcome: reported,
          busy: false,
          activity: 'idle',
          canSubmit: false,
          error:
            'The native response could not be confirmed. Start a new conversation.',
        });
        return false;
      }
      const last = messages.at(-1);
      if (!last) throw Error('Missing confirmed response');
      let prepared: FlightSurface;
      try {
        prepared = createFlightSurface({
          content: last.content,
          expected,
          messageId: last.id,
          id: 'surface-' + ++sequence,
          isCurrent: () =>
            !revoked &&
            active === prepared &&
            !operation &&
            !snapshot.busy &&
            snapshot.canSubmit,
          onAction(payload) {
            if (
              revoked ||
              active !== prepared ||
              operation ||
              snapshot.busy ||
              !snapshot.canSubmit
            )
              return;
            const next: SurfaceKind =
              payload.action.name === 'bookingSubmit'
                ? 'results'
                : payload.action.name === 'flightSelect'
                ? 'confirmation'
                : 'booking';
            void submit(JSON.stringify(payload), next).catch(() => undefined);
          },
        });
      } catch {
        if (current()) {
          detach(false);
          operation = undefined;
          publish({
            native,
            messages,
            outcome: reported,
            busy: false,
            activity: 'idle',
            canSubmit: false,
            error:
              'This confirmed response is unavailable. Start a new conversation.',
          });
        }
        return false;
      }
      if (!current()) {
        prepared.dispose();
        return false;
      }
      surfaces.add(prepared);
      active = prepared;
      chosen.observation = undefined;
      operation = undefined;
      // The ordinary transcript, immutable view and current command epoch publish together.
      publish({
        native,
        messages,
        surfaces: Object.freeze([...snapshot.surfaces, prepared.view]),
        activeSurface: prepared.view.id,
        outcome: reported,
        busy: false,
        activity: 'idle',
        canSubmit: true,
        error: null,
      });
      return (
        !revoked && owner === chosen && !chosen.closed && active === prepared
      );
    } catch {
      if (valid()) {
        detach(true);
        operation = undefined;
        publish({
          busy: false,
          activity: 'idle',
          canSubmit: false,
          activeSurface: null,
          error: 'The native request failed. Start a new conversation.',
        });
      }
      return false;
    } finally {
      if (valid()) {
        if (selected) selected.observation = undefined;
        operation = undefined;
        publish({ busy: false, activity: 'idle', canSubmit: false });
      }
    }
  }
  async function stop() {
    if (revoked || (!operation && !owner)) return;
    operation?.abort();
    operation = undefined;
    retireActive();
    detach(true);
    publish({
      busy: false,
      activity: 'idle',
      activeSurface: null,
      canSubmit: false,
      error: 'Stopped. Start a new conversation to continue.',
    });
  }
  async function newConversation() {
    if (revoked) return;
    operation?.abort();
    operation = undefined;
    retireActive();
    detach(true);
    for (const surface of surfaces) surface.dispose();
    surfaces.clear();
    // Cleanup cannot retain permission to act or delay a fresh conversation.
    publish({
      threadId: null,
      native: undefined,
      messages: Object.freeze([]),
      surfaces: Object.freeze([]),
      activeSurface: null,
      busy: false,
      activity: 'idle',
      canSubmit: true,
      error: null,
      outcome: null,
      viewGeneration: snapshot.viewGeneration + 1,
    });
  }
  function revoke() {
    if (revoked) return;
    revoked = true;
    operation?.abort();
    operation = undefined;
    for (const surface of surfaces) surface.revoke();
    active = undefined;
    detach(true);
    listeners.clear();
    snapshot = Object.freeze({
      ...snapshot,
      activeSurface: null,
      busy: false,
      canSubmit: false,
      activity: 'idle',
    });
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    revoke();
    for (const surface of surfaces) surface.dispose();
    surfaces.clear();
    disposal = Promise.all([...cleanups]).then(() => undefined);
    return disposal;
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (revoked) return () => undefined;
      const registration = { notify };
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
      };
    },
    submit: (text: string) => submit(text),
    stop,
    newConversation,
    revoke,
    dispose,
  });
}
export type A2uiApplication = ReturnType<typeof createA2uiApplication>;
