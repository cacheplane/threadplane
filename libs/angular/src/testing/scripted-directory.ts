import type {
  ThreadDirectory,
  ThreadDirectorySnapshot,
  ThreadEntry,
} from '@threadplane/core';

/** A thread entry with every field given a default. */
export function entry(
  id: string,
  patch: Partial<Omit<ThreadEntry, 'id'>> = {}
): ThreadEntry {
  return Object.freeze({
    id,
    title: `Thread ${id}`,
    pinned: false,
    archived: false,
    projectId: null,
    ...patch,
  });
}

/** Test-only directory whose every publication the spec decides. */
export function scriptedDirectory(
  initial: Partial<ThreadDirectorySnapshot> = {}
) {
  let snapshot: ThreadDirectorySnapshot = Object.freeze({
    threads: Object.freeze([]),
    archived: Object.freeze([]),
    status: 'idle',
    ...initial,
  });
  const listeners = new Set<() => void>();
  const calls: unknown[][] = [];
  const control = {
    calls,
    disposals: 0,
    /** What the next `refresh()` publishes before it resolves. */
    onRefresh: undefined as Partial<ThreadDirectorySnapshot> | undefined,
    /** The error the next mutation or `create` rejects with. */
    failNext: undefined as Error | undefined,
    get subscribers() {
      return listeners.size;
    },
    publish(patch: Partial<ThreadDirectorySnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...patch });
      for (const notify of [...listeners]) notify();
    },
  };
  const settle = <T>(value: T): Promise<T> => {
    const failure = control.failNext;
    control.failNext = undefined;
    return failure ? Promise.reject(failure) : Promise.resolve(value);
  };
  const record =
    (name: string) =>
    (...args: unknown[]): Promise<void> => {
      calls.push([name, ...args]);
      return settle(undefined);
    };
  const directory = {
    /** Proves each command is called on the directory. */
    label: 'scripted',
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    async refresh(
      this: { label: string },
      options?: { readonly signal?: AbortSignal }
    ) {
      calls.push(['refresh', this.label, options]);
      if (control.onRefresh) control.publish(control.onRefresh);
    },
    create(options?: { readonly metadata?: object }) {
      calls.push(['create', options]);
      return settle({ id: 'created' });
    },
    rename: record('rename'),
    remove: record('remove'),
    setArchived: record('setArchived'),
    setPinned: record('setPinned'),
    reorderPinned: record('reorderPinned'),
    setProject: record('setProject'),
    createProject(name: string) {
      calls.push(['createProject', name]);
      return settle({ id: 'project' });
    },
    renameProject: record('renameProject'),
    removeProject: record('removeProject'),
    /** Leaves its listeners in place, so a spec can prove they were released. */
    dispose() {
      control.disposals++;
    },
  } satisfies ThreadDirectory & { label: string };
  return { directory, control };
}

export type ScriptedDirectory = ReturnType<
  typeof scriptedDirectory
>['directory'];
