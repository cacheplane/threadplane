import type { createFixtureSession } from './runtime-entry.js';

export type ThreadSelection = Readonly<{
  id: 'thread-a' | 'thread-b';
  generation: number;
  session: ReturnType<typeof createFixtureSession>;
}>;

/** Application policy for this example, not a library switching service.
 * Construct outside framework render/setup; observers only borrow its sessions. */
export function createThreadOwner(
  create: (id: string) => ThreadSelection['session']
) {
  let selected: ThreadSelection = Object.freeze({
    id: 'thread-a',
    generation: 1,
    session: create('thread-a'),
  });
  let disposed = false;
  return {
    get selected() {
      return selected;
    },
    select(id: ThreadSelection['id']) {
      if (disposed || selected.id === id) return selected;
      const previous = selected;
      selected = Object.freeze({
        id,
        generation: previous.generation + 1,
        session: create(id),
      });
      // Dispose locally before the view changes. This runtime's disposal settles
      // ownership without waiting for an uncooperative remote read or tool.
      void previous.session.dispose();
      return selected;
    },
    dispose() {
      disposed = true;
      return selected.session.dispose();
    },
  };
}

export const threadInstructions =
  'Load selected → Run selected (A stays running) → Select B → Load selected → Run selected → Select B again → Select A → Load selected (stays pending) → Select B → Load selected → Dispose selected → Run selected → Select A. Selection creates a fresh local session, never a server thread or automatic history request. This example disposes outgoing sessions; an application can choose to retain them instead. Restart the review server to repeat.';
