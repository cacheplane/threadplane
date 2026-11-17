// Phase 1 copy of `ThreadDirectory` from `@threadplane/core`; replaced by a
// re-export when the Angular packages export core. A type spec in
// libs/langgraph pins this file to the core contract.

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

/** Plain display projection of a directory failure (copy of `AgentError`). */
export interface ThreadDirectoryError {
  readonly kind: 'connection' | 'auth' | 'server' | 'interrupted' | 'aborted';
  readonly message: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly recovery?: 'retry' | 'check' | 'none';
  readonly detail?: string;
}

/** Immutable aggregate, stable between actual changes. */
export interface ThreadDirectorySnapshot {
  readonly threads: readonly ThreadEntry[];
  readonly archived: readonly ThreadEntry[];
  readonly projects?: readonly ProjectEntry[];
  readonly status: ThreadDirectoryStatus;
  readonly error?: ThreadDirectoryError;
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
  create?(options?: {
    readonly metadata?: { readonly [key: string]: unknown };
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
