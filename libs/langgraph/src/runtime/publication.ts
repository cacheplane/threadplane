import type { AgentSessionCustomEvent } from '@threadplane/core';
import type { LangGraphPublication } from './langgraph-snapshot.js';
import { ownLangGraphSnapshot } from './ownership.js';

/** Backend-private publication. Listener failures are reported once to the
 * optional callback and otherwise ignored; reporter failures are contained too.
 * Neither kind of failure changes execution state or rejects a command. */
export function createPublication(
  initial: LangGraphPublication,
  reportListenerError: (error: unknown) => void = () => undefined
) {
  let current = ownLangGraphSnapshot(initial);
  const listeners = new Set<{ notify: () => void }>();
  const eventListeners = new Set<{
    listener: (event: AgentSessionCustomEvent) => void;
  }>();
  const pending: (() => void)[] = [];
  let flushing = false;
  let notifying = false;

  function drain(): void {
    if (flushing || notifying) return;
    flushing = true;
    try {
      while (pending.length) pending.shift()?.();
    } finally {
      flushing = false;
    }
  }

  function schedule(operation: () => void): void {
    if (notifying) pending.push(operation);
    else {
      operation();
      drain();
    }
  }

  function publish(input: LangGraphPublication): void {
    // Capture external ingress now, including when a listener queues a publish.
    const captured = ownLangGraphSnapshot(input, current);
    schedule(() => {
      const next = ownLangGraphSnapshot(captured, current);
      if (next === current) return;
      current = next;
      notifying = true;
      try {
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try {
            listener.notify();
          } catch (error) {
            try {
              reportListenerError(error);
            } catch {
              /* Reporting cannot abort the pass or corrupt publication. */
            }
          }
        }
      } finally {
        notifying = false;
      }
    });
  }

  return {
    getSnapshot: () => current,
    subscribe(notify: () => void): () => void {
      const listener = { notify };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish,
    /** Events are delivered once, to the listeners registered right now. */
    onCustomEvent(
      listener: (event: AgentSessionCustomEvent) => void
    ): () => void {
      const registration = { listener };
      eventListeners.add(registration);
      return () => {
        eventListeners.delete(registration);
      };
    },
    emitCustomEvent(event: AgentSessionCustomEvent): void {
      for (const registration of [...eventListeners]) {
        // A listener can release another, or dispose the session, mid-pass.
        if (!eventListeners.has(registration)) continue;
        try {
          registration.listener(event);
        } catch (error) {
          try {
            reportListenerError(error);
          } catch {
            /* Reporting cannot abort the pass. */
          }
        }
      }
    },
    // Session disposal releases observers without discarding queued commands.
    clearListeners: () => {
      listeners.clear();
      eventListeners.clear();
    },
    command<T>(run: () => T | PromiseLike<T>): Promise<T> {
      return new Promise<T>((resolve, reject) =>
        schedule(() => {
          try {
            resolve(run());
          } catch (error) {
            reject(error);
          }
        })
      );
    },
  };
}
