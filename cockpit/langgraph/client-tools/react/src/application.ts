import type { AgentSession, AgentSnapshot, CompleteOutcome } from '@threadplane/core';
import { createMessageContent, type MessageRow } from '@threadplane/content/messages';
import { createClientToolsController, type ClientToolsSnapshot, type BookingPanel } from './tools';

export interface ClientToolsSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly { readonly value?: unknown }[];
  };
}
export type ClientToolCatalog = ReturnType<typeof createClientToolsController>['tools'];
export interface ClientToolsApplicationSnapshot extends ClientToolsSnapshot {
  readonly creation: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
  readonly rows: readonly MessageRow[];
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
}

/** Owns one thread and the browser decisions admitted by its active command. */
export function createClientToolsApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (threadId: string, tools: ClientToolCatalog) => ClientToolsSession;
}) {
  const controller = createClientToolsController();
  const content = createMessageContent();
  const listeners = new Set<() => void>();
  let snapshot: ClientToolsApplicationSnapshot = Object.freeze({
    creation: 'idle', rows: Object.freeze([]), ...controller.getSnapshot(),
    busy: false, canSubmit: true, outcome: null, error: null,
  });
  let session: ClientToolsSession | undefined;
  let release: (() => void) | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  function blocked() {
    const state = session?.getSnapshot();
    return !!state?.interrupts.length || !!state?.toolCalls.some((tool) =>
      !Object.hasOwn(controller.tools, tool.name) || tool.status === 'pending' || tool.status === 'running'
    // Typed sessions omit unknown tools, but retain their server call references.
    ) || !!state?.messages.some((message) => message.role === 'assistant' &&
      message.toolCallIds?.some((id) => !state.toolCalls.some((call) => call.id === id))
    ) || controller.getSnapshot().bookings.some((row) => row.status === 'pending');
  }
  function publish(update: Partial<ClientToolsApplicationSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function projection() {
    return {
      ...controller.getSnapshot(),
      ...(session ? { rows: content.project(session.getSnapshot()) } : {}),
    };
  }
  function observe() {
    if (disposed) return;
    publish({ ...projection(), ...(blocked() ? { canSubmit: false } : {}) });
  }
  const releaseTools = controller.subscribe(observe);
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim()) return;
    if (blocked()) { observe(); return; }
    const admitted = new AbortController();
    operation = admitted;
    const current = () => !disposed && operation === admitted && !admitted.signal.aborted;
    publish({ busy: true, canSubmit: false, outcome: null, error: null });
    try {
      if (!current()) return;
      if (!session) {
        publish({ creation: 'pending' });
        if (!current()) return;
        const threadId = await options.createThread(admitted.signal);
        if (!current()) return;
        session = options.sessionFactory(threadId, controller.tools);
        release = session.subscribe(observe);
        publish({ creation: 'confirmed', ...projection() });
      }
      if (!current()) return;
      if (blocked()) {
        publish({ ...projection(), outcome: 'paused', canSubmit: false });
        return;
      }
      const outcome = await session.submit(text, { signal: admitted.signal });
      if (!current()) return;
      publish({
        ...projection(), outcome, canSubmit: outcome === 'success' && !blocked(),
        error: outcome === 'error' ? 'The LangGraph request failed.' : null,
      });
    } catch {
      if (!current()) return;
      publish({ creation: session ? 'confirmed' : 'unconfirmed', outcome: 'error',
        canSubmit: false, error: 'The LangGraph request failed.' });
    } finally {
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false });
      }
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    publish({ ...projection(), busy: false, canSubmit: false, outcome: 'aborted',
      creation: session ? 'confirmed' : 'unconfirmed' });
    try { await session?.stop(); } catch { /* Reset is required. */ }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    release?.();
    releaseTools();
    controller.dispose();
    content.dispose();
    listeners.clear();
    disposal = Promise.resolve().then(() => session?.dispose()).then(() => undefined);
    return disposal;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    submit, stop, dispose,
    decide(row: BookingPanel, confirmed: boolean) {
      if (disposed || !operation || operation.signal.aborted || !snapshot.busy) return false;
      return controller.decide(row, confirmed);
    },
  };
}
