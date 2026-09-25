import type { SessionSnapshot } from './session-observation';
export function createPublication(initial: SessionSnapshot) {
  let current = initial;
  const listeners = new Set<{ notify: () => void }>();
  const commands: (() => void)[] = [];
  let notifying = false;
  let draining = false;
  const drain = () => {
    if (notifying || draining) return;
    draining = true;
    try {
      while (commands.length) commands.shift()?.();
    } finally {
      draining = false;
    }
  };
  const command = (action: () => void) => {
    commands.push(action);
    drain();
  };
  const publish = (next: SessionSnapshot) => {
    if (notifying) {
      command(() => publish(next));
      return;
    }
    if (next === current) return;
    current = next;
    notifying = true;
    try {
      for (const registration of [...listeners]) {
        if (!listeners.has(registration)) continue;
        try {
          registration.notify();
        } catch {
          /* A view cannot fail a run. */
        }
      }
    } finally {
      notifying = false;
      drain();
    }
  };
  return {
    getSnapshot: () => current,
    subscribe: (notify: () => void): (() => void) => {
      const registration = { notify };
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
      };
    },
    publish,
    command,
    clear: (): void => {
      listeners.clear();
    },
  };
}
