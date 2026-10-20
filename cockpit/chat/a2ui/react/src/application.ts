import type { AgentSession, AgentSnapshot, Message } from '@threadplane/core';
import {
  createObservation,
  prepareTerminal,
  type Checkpoint,
  type Observation,
} from './terminal';
// Same-layout private source import is copied unchanged into installed consumers.
// eslint-disable-next-line @nx/enforce-module-boundaries -- Internal package-less aviation presentation.
import {
  createFlightSurface,
  type FlightSurface,
  type SurfaceView,
  type SurfaceKind,
} from '../../../../../libs/cockpit-a2ui-react/src/index';

export interface A2uiSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly unknown[];
    readonly subgraphs: readonly unknown[];
    readonly history: readonly unknown[] | undefined;
  };
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface A2uiClient {
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(threadId: string): A2uiSession;
  readCheckpoint(checkpoint: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
export interface A2uiSnapshot {
  readonly threadId: string | null;
  readonly messages: readonly Message[];
  readonly surfaces: readonly SurfaceView[];
  readonly activeSurface: string | null;
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly error: string | null;
  readonly viewGeneration: number;
}
type SurfaceOwner = FlightSurface;
type Conversation = {
  id: string;
  session: A2uiSession;
  release?: () => void;
  observation?: Observation;
  closed: boolean;
};
/** No streamed assistant row can create presentation or interactive authority. */
export function createA2uiApplication(client: A2uiClient) {
  let conversation: Conversation | undefined,
    operation: AbortController | undefined;
  let active: SurfaceOwner | undefined,
    sequence = 0,
    revoked = false;
  let disposal: Promise<void> | undefined;
  const surfaces = new Set<SurfaceOwner>(),
    listeners = new Set<{ notify: () => void }>();
  const cleanups = new Set<Promise<void>>();
  let snapshot: A2uiSnapshot = Object.freeze({
    threadId: null,
    messages: Object.freeze([]),
    surfaces: Object.freeze([]),
    activeSurface: null,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    error: null,
    viewGeneration: 0,
  });
  function publish(change: Partial<A2uiSnapshot>) {
    if (revoked) return;
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of [...listeners]) {
      if (revoked) break;
      if (listeners.has(listener))
        try {
          listener.notify();
        } catch {
          /* Observation cannot reject admission. */
        }
    }
  }
  function retire(owner: SurfaceOwner) {
    owner.dispose();
  }
  function revokeActive() {
    if (active) retire(active);
    active = undefined;
  }
  function track(cleanup: Promise<void>) {
    cleanups.add(cleanup);
    void cleanup.then(() => cleanups.delete(cleanup));
    return cleanup;
  }
  function detach(stop: boolean) {
    const selected = conversation;
    conversation = undefined;
    if (!selected || selected.closed) return Promise.resolve();
    selected.closed = true;
    selected.observation = undefined;
    selected.release?.();
    let stopped: Promise<unknown>;
    try {
      stopped = stop
        ? Promise.resolve(selected.session.stop())
        : Promise.resolve();
    } catch {
      stopped = Promise.resolve();
    }
    return track(
      stopped
        .catch(() => undefined)
        .then(async () => {
          try {
            await selected.session.dispose();
          } catch {
            /* An uncertain operation is never replayed. */
          }
        })
    );
  }
  function prepare(content: string, kind: SurfaceKind, messageId: string) {
    const owner: SurfaceOwner = createFlightSurface({
      content,
      expected: kind,
      messageId,
      id: 'surface-' + ++sequence,
      isCurrent: () =>
        !revoked && active === owner && !snapshot.busy && snapshot.canSubmit,
      onAction(payload) {
        const next: SurfaceKind =
          payload.action.name === 'bookingSubmit'
            ? 'results'
            : payload.action.name === 'flightSelect'
            ? 'confirmation'
            : 'booking';
        // submit closes the epoch synchronously before transport or observer reentry.
        void submit(JSON.stringify(payload), next).catch(() => undefined);
      },
    });
    surfaces.add(owner);
    return owner;
  }
  async function submit(
    text: string,
    expected: SurfaceKind = 'booking'
  ): Promise<boolean> {
    if (
      revoked ||
      snapshot.busy ||
      !snapshot.canSubmit ||
      typeof text !== 'string' ||
      !text.trim()
    )
      return false;
    const admitted = new AbortController();
    operation = admitted;
    // Reentrant observers see the closed epoch and the same busy operation.
    revokeActive();
    const current = () =>
      !revoked && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activeSurface: null,
      activity: conversation ? 'running' : 'creating',
      error: null,
    });
    try {
      if (!current()) return false;
      if (!conversation) {
        const id = await client.createThread(admitted.signal);
        if (!current()) return false;
        if (typeof id !== 'string' || !id)
          throw Error('Unconfirmed conversation');
        const session = client.sessionFactory(id);
        if (!current()) {
          await track(
            Promise.resolve()
              .then(() => session.dispose())
              .catch(() => undefined)
          );
          return false;
        }
        const selected: Conversation = { id, session, closed: false };
        conversation = selected;
        const release = session.subscribe(() => {
          if (
            !revoked &&
            operation &&
            !operation.signal.aborted &&
            conversation === selected &&
            !selected.closed &&
            snapshot.activity === 'running'
          )
            selected.observation?.observe(session.getSnapshot());
        });
        selected.release = release;
        if (selected.closed) release();
        if (!current()) return false;
        publish({ threadId: id, activity: 'running' });
      }
      const selected = conversation;
      if (!current() || !selected || selected.closed) return false;
      const valid = () =>
        current() && conversation === selected && !selected.closed;
      const observation = createObservation({
        threadId: selected.id,
        input: text,
        previous: snapshot.messages,
      });
      selected.observation = observation;
      const outcome = await selected.session.submit(text, {
        signal: admitted.signal,
      });
      if (!valid()) return false;
      publish({ activity: 'confirming' });
      const terminal = await prepareTerminal({
        operation: admitted,
        observation,
        outcome,
        getOperation: () => (valid() ? operation : undefined),
        getSnapshot: () => selected.session.getSnapshot(),
        load: () => selected.session.load({ signal: admitted.signal }),
        read: (cp) => client.readCheckpoint(cp, admitted.signal),
      });
      if (!valid()) return false;
      if (terminal.kind !== 'prepared') throw Error('Unconfirmed response');
      const messages = terminal.confirmation.messages;
      const last = messages.at(-1)!;
      let prepared: SurfaceOwner;
      try {
        prepared = prepare(last.content, expected, last.id);
      } catch {
        // The saved response remains inspectable as text, with no partial executable tree.
        publish({
          messages,
          error: 'This response is unavailable. Start a new conversation.',
          canSubmit: false,
        });
        return false;
      }
      if (!valid()) {
        retire(prepared);
        return false;
      }
      active = prepared;
      selected.observation = undefined;
      operation = undefined;
      // Transcript, view and authority become observable in one immutable publication.
      publish({
        messages,
        surfaces: Object.freeze([...snapshot.surfaces, prepared.view]),
        activeSurface: prepared.view.id,
        busy: false,
        activity: 'idle',
        canSubmit: true,
        error: null,
      });
      return true;
    } catch {
      if (current())
        publish({
          canSubmit: false,
          error:
            'The response could not be confirmed. Start a new conversation.',
        });
      return false;
    } finally {
      if (current()) {
        operation = undefined;
        if (conversation) conversation.observation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function stop() {
    if (revoked || !operation) return;
    operation.abort();
    operation = undefined;
    revokeActive();
    const cleanup = detach(true);
    publish({
      busy: false,
      activity: 'idle',
      activeSurface: null,
      canSubmit: false,
      error: 'Stopped. Start a new conversation to continue.',
    });
    await cleanup;
  }
  async function newConversation() {
    if (revoked) return;
    const running = !!operation;
    operation?.abort();
    revokeActive();
    const admitted = new AbortController();
    operation = admitted;
    const cleanup = detach(running);
    for (const owner of surfaces) retire(owner);
    surfaces.clear();
    publish({
      threadId: null,
      messages: Object.freeze([]),
      surfaces: Object.freeze([]),
      activeSurface: null,
      busy: true,
      activity: 'replacing',
      canSubmit: false,
      error: null,
      viewGeneration: snapshot.viewGeneration + 1,
    });
    await cleanup;
    if (revoked || operation !== admitted || admitted.signal.aborted) return;
    operation = undefined;
    publish({ busy: false, activity: 'idle', canSubmit: true });
  }
  /** Main calls this before unmount; owner disposal occurs afterward. */
  function revoke() {
    if (revoked) return;
    revoked = true;
    const running = !!operation;
    operation?.abort();
    operation = undefined;
    for (const owner of surfaces) owner.revoke();
    conversation?.release?.();
    if (conversation) {
      conversation.release = undefined;
      conversation.observation = undefined;
    }
    if (running && conversation) {
      try {
        track(
          Promise.resolve(conversation.session.stop()).catch(() => undefined)
        );
      } catch {
        /* Cleanup continues. */
      }
    }
    listeners.clear();
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    revoke();
    for (const owner of surfaces) retire(owner);
    surfaces.clear();
    active = undefined;
    void detach(false);
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
