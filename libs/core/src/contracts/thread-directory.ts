import type { AgentSession } from './agent-session.js';
import type { AgentError } from './error.js';
import type { PlainValue } from './tool.js';

/** Load state of a thread directory. */
export type ThreadDirectoryStatus = 'idle' | 'loading' | 'error';

/** One thread as a list view shows it. `title` is always a string: the
 * implementation applies the fallback, so views never branch on it. */
export interface ThreadEntry {
  readonly id: string;
  readonly title: string;
  readonly updatedAt?: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly projectId: string | null;
}

/** A named group of threads. */
export interface ProjectEntry {
  readonly id: string;
  readonly name: string;
}

/** Immutable aggregate, stable between actual changes. */
export interface ThreadDirectorySnapshot {
  readonly threads: readonly ThreadEntry[];
  readonly archived: readonly ThreadEntry[];
  readonly projects?: readonly ProjectEntry[];
  readonly status: ThreadDirectoryStatus;
  readonly error?: AgentError;
}

/**
 * A framework-neutral directory of threads. Mutations are optional; a
 * directory that cannot perform one leaves the command undefined, and callers
 * offer no control for it.
 */
export interface ThreadDirectory {
  getSnapshot(): ThreadDirectorySnapshot;
  /** Changes only. Read the initial aggregate through getSnapshot. */
  subscribe(notify: () => void): () => void;
  refresh(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /**
   * Reads one thread from the backend, listed or not: the entry, or null when
   * the backend says there is no such thread. Rejects when the backend could
   * not be asked, so a caller can tell "missing" from "unknown". It does not
   * change the snapshot.
   */
  get?(
    id: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<ThreadEntry | null>;
  /**
   * The saved rank of an entry among pinned threads, for an entry this
   * directory published or answered from `get`; undefined when it has none.
   * Entries themselves carry no rank: `threads` is already in pinned order.
   */
  pinnedOrderOf?(entry: ThreadEntry): number | undefined;
  create?(options?: {
    readonly metadata?: { readonly [key: string]: PlainValue };
    readonly signal?: AbortSignal;
  }): Promise<{ readonly id: string }>;
  rename?(id: string, title: string): Promise<void>;
  remove?(id: string): Promise<void>;
  setArchived?(id: string, archived: boolean): Promise<void>;
  setPinned?(id: string, pinned: boolean): Promise<void>;
  reorderPinned?(id: string, beforeId: string | null): Promise<void>;
  setProject?(id: string, projectId: string | null): Promise<void>;
  createProject?(name: string): Promise<{ readonly id: string }>;
  renameProject?(id: string, name: string): Promise<void>;
  removeProject?(id: string): Promise<void>;
  dispose(): void;
}

/**
 * Refreshes the directory each time the session leaves `'running'`, whether
 * the run succeeded or ended in error. A rejected refresh is ignored. Returns
 * an idempotent release.
 */
export function refreshDirectoryOnRunEnd(
  directory: Pick<ThreadDirectory, 'refresh'>,
  session: Pick<AgentSession, 'getSnapshot' | 'subscribe'>
): () => void {
  let last = session.getSnapshot().status;
  return session.subscribe(() => {
    const next = session.getSnapshot().status;
    const ended = last === 'running' && next !== 'running';
    last = next;
    // A failed refresh shows on the directory; it never escapes as an
    // unhandled rejection.
    if (ended) directory.refresh().catch(() => undefined);
  });
}
