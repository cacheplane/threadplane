import type { AGUIEvent } from '@ag-ui/client';
import type { CompleteOutcome } from '@threadplane/core';
import type { InterruptMode, InterruptTransport } from './interrupt-mode.js';
import { collectReplay, foldReplay, type ReplaySource } from './replay.js';
import type { Observation } from './session-observation.js';
import {
  contentOf,
  createThreadStore,
  observationOf,
  type SessionPersistence,
  type ThreadRecord,
} from './thread-store.js';

/** The durability options of a session. */
export interface DurabilityOptions {
  /**
   * Application-owned durable storage. The session saves its thread after
   * every run and before it sends an answer, and restores it on creation.
   * Requires a `threadId` the application chose.
   */
  readonly persistence?: SessionPersistence;
  /**
   * Loads the thread's AG-UI events from the server when the session is
   * created. Replay wins whenever it returns at least one event; an empty
   * result, a failure, or events that cannot be folded fall back to
   * `persistence`, or to the thread the session was created with. A failed
   * replay never rejects `ready`.
   */
  readonly replay?: ReplaySource;
}

/** What the owner lends the durability controller. */
export interface DurabilityHost {
  readonly publication: {
    getObservation(): Observation;
    publish(next: Observation): void;
    command(action: () => void): void;
  };
  /** A command is running. */
  active(): boolean;
  disposed(): boolean;
  /** Replaces the thread with a restored one, in the owner's own terms. */
  adopt(observation: Observation): void;
  /** Reports the events a replay was folded from, after the thread shows them. */
  replayed?(events: readonly AGUIEvent[]): void;
  /** A load restored a saved thread, from replay or from storage. */
  restored?(): void;
}

const CHECKING = 'A status check is in progress.';
const STORAGE = 'Thread storage needs reconciliation before another request.';
const DISPOSED = 'The session is disposed.';
const LOADING = 'The thread is loading.';

/** True when a session with these options restores its thread before it runs. */
export function isDurable(options: DurabilityOptions): boolean {
  return options.persistence !== undefined || options.replay !== undefined;
}

/** True for a failed thread whose answer may or may not have been taken. */
function uncertainAnswer(observation: Observation): boolean {
  const decision = observation.decision;
  return (
    observation.status === 'error' &&
    decision?.kind === 'native' &&
    decision.attempt !== undefined &&
    observation.run?.outcome !== undefined
  );
}

function withHold(
  observation: Observation,
  hold: Observation['hold'],
  status?: Observation['status']
): Observation {
  const { hold: _previous, ...rest } = observation;
  return Object.freeze({
    ...rest,
    ...(status && { status }),
    ...(hold && { hold }),
  });
}

/**
 * Restores a session's thread when it is created, saves it as it changes and
 * asks the backend what became of an uncertain answer. The owner keeps every
 * run decision; this module only reads and replaces the observation.
 */
export function createDurability(
  options: DurabilityOptions & {
    readonly threadId: string;
    readonly interruptMode?: InterruptMode;
    readonly interruptTransport?: InterruptTransport;
    readonly redact?: (event: AGUIEvent) => AGUIEvent;
  },
  host: DurabilityHost
) {
  const { publication } = host;
  const store = options.persistence
    ? createThreadStore(options.persistence, options.threadId)
    : undefined;
  const replayAbort = new AbortController();
  let hydrated = false;
  let checking = false;
  /** A `load()` the application asked for, while it is going. */
  let loading: Promise<void> | undefined;
  /** Storage failed; held back while a run is going, shown when it settles. */
  let faulted = false;
  const setHold = (hold: Observation['hold'], status?: Observation['status']) =>
    publication.command(() => {
      const current = publication.getObservation();
      if (current.hold !== hold || (status && current.status !== status))
        publication.publish(withHold(current, hold, status));
    });
  const showFault = () => {
    if (!faulted || checking || host.disposed() || host.active()) return;
    setHold('storage', 'error');
  };
  const fault = () => {
    faulted = true;
    publication.command(showFault);
  };
  const adopt = (record: ThreadRecord | null) =>
    publication.command(() => {
      faulted = false;
      if (record) {
        host.adopt(observationOf(record));
        host.restored?.();
      } else {
        const current = publication.getObservation();
        publication.publish(
          withHold(
            current,
            undefined,
            current.status === 'running' ? undefined : 'idle'
          )
        );
      }
    });

  const hydrate = async (): Promise<void> => {
    if (options.replay) {
      try {
        const events = await collectReplay(
          options.replay,
          options.threadId,
          replayAbort.signal
        );
        if (!host.disposed() && events.length) {
          const result = await foldReplay(options.threadId, events, options);
          if (host.disposed()) return;
          publication.command(() => {
            host.adopt(result.observation);
            host.restored?.();
            host.replayed?.(result.events);
          });
          return;
        }
      } catch {
        /* A failed replay falls back to what was saved, or to nothing. */
      }
    }
    if (host.disposed()) return;
    if (!store) {
      setHold(undefined);
      return;
    }
    let record: ThreadRecord | null;
    try {
      record = await store.load();
    } catch (error) {
      fault();
      throw error;
    }
    if (host.disposed()) return;
    if (record) adopt(record);
    else setHold(undefined);
  };
  const ready = hydrate().finally(() => {
    hydrated = true;
  });
  // A caller that never reads `ready` must not see an unhandled rejection.
  void ready.catch(() => undefined);

  /** Holds the session, drains pending writes and asks the backend once. */
  const reconcileOnce = async (): Promise<ThreadRecord | null> => {
    if (!store) throw new Error('Recovery requires a persistence reconciler');
    checking = true;
    setHold('checking');
    try {
      // A failed write is why local state is in doubt; it must not stop the
      // question about what the backend recorded.
      await store.idle();
      return await store.reconcile();
    } finally {
      checking = false;
      if (!host.disposed())
        publication.command(() => {
          const current = publication.getObservation();
          if (current.hold === 'checking')
            publication.publish(
              withHold(current, faulted ? 'storage' : undefined)
            );
        });
    }
  };

  const save = (): Promise<void> => {
    if (!store || faulted) return Promise.resolve();
    let write: Promise<void>;
    try {
      write = store.save(contentOf(publication.getObservation()));
    } catch (error) {
      write = Promise.reject(error);
    }
    void write.catch(fault);
    return write;
  };

  const checkStatus = async (): Promise<void> => {
    if (host.disposed()) throw new Error(DISPOSED);
    if (host.active())
      throw new Error('Stop the active request before checking status.');
    if (checking || !hydrated) return;
    let record: ThreadRecord | null;
    try {
      record = await reconcileOnce();
    } catch {
      // The error stays, so the check can be offered again.
      return;
    }
    // An answer that only proves the resume started settles nothing.
    if (host.disposed() || host.active() || !record || record.pause?.attempt)
      return;
    adopt(record);
  };

  /**
   * Reads the thread again, from replay and then from storage, exactly as the
   * session did when it was created. The session holds `hydrating` meanwhile.
   */
  const load = (options?: { readonly signal?: AbortSignal }): Promise<void> => {
    if (host.disposed()) return Promise.reject(new Error(DISPOSED));
    if (options?.signal?.aborted) return Promise.resolve();
    // The first load is still going: that is the load.
    if (!hydrated) return ready;
    if (loading) return loading;
    if (checking) return Promise.reject(new Error(CHECKING));
    if (host.active())
      return Promise.reject(
        new Error('Stop the active request before loading the thread.')
      );
    setHold('hydrating');
    const current = hydrate().finally(() => {
      if (loading === current) loading = undefined;
    });
    loading = current;
    return current;
  };

  return {
    /** Resolves once the thread is restored. Rejects when storage could not be read. */
    ready,
    load,
    hydrated: () => hydrated,
    /** A reconciler is configured, so an uncertain answer can be checked. */
    canCheck: store?.canReconcile === true,
    /** Why no command can run now, apart from hydration, which commands wait for. */
    refusal: (): string | undefined =>
      checking ? CHECKING : loading ? LOADING : faulted ? STORAGE : undefined,
    /** Saves the thread as it is now. Rejects when the write failed. */
    save,
    /** The owner settled a command: save, show a held fault, check if offered. */
    settled: (): void => {
      void save().catch(() => undefined);
      publication.command(showFault);
      if (
        store?.canReconcile &&
        !faulted &&
        uncertainAnswer(publication.getObservation())
      )
        void checkStatus().catch(() => undefined);
    },
    /**
     * Adopts whatever the backend reports, including an answer that only
     * proves the resume started. Rejects when it cannot run or the backend
     * does not know.
     */
    reconcileInterrupt: async (): Promise<void> => {
      if (host.disposed()) throw new Error(DISPOSED);
      if (checking) throw new Error(CHECKING);
      if (host.active())
        throw new Error('Stop the active request before reconciliation.');
      if (!hydrated) await ready.catch(() => undefined);
      const record = await reconcileOnce();
      if (!host.disposed()) adopt(record);
    },
    ...(store?.canReconcile && { checkStatus }),
    dispose: (): void => {
      replayAbort.abort();
    },
  };
}

export type Durability = ReturnType<typeof createDurability>;

type Command<A extends unknown[]> = (...args: A) => Promise<CompleteOutcome>;

/**
 * Makes a command wait for the thread to be restored, and refuse while the
 * session is checking a status or its storage is in doubt.
 */
export function gated<A extends unknown[]>(
  durability: Durability,
  command: Command<A>,
  refuse: (reason: string) => Promise<CompleteOutcome>
): Command<A> {
  return (...args) => {
    const run = () => {
      const reason = durability.refusal();
      return reason ? refuse(reason) : command(...args);
    };
    return durability.hydrated() ? run() : durability.ready.then(run, run);
  };
}
