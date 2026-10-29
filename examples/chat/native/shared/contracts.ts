// Private example contracts. App ownership and its independent operation
// states are introduced with the application owner, not the directory.
export interface ThreadRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt?: number;
  readonly pinned?: boolean;
  readonly pinnedOrder?: number;
  readonly archived?: boolean;
  readonly projectId?: string;
}

export type DirectoryResult<T> =
  | Readonly<{ kind: 'ready'; value: T }>
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'cancelled' }>;
export type ThreadLookupResult =
  | DirectoryResult<ThreadRow>
  | Readonly<{ kind: 'missing' }>;

export type RemovalInspection =
  | DirectoryResult<ThreadRow>
  | Readonly<{ kind: 'missing'; id: string }>;

export interface ThreadDirectory {
  projectMembers?(
    projectId: string,
    signal: AbortSignal
  ): Promise<DirectoryResult<readonly string[]>>;
  setProject?(
    id: string,
    projectId: string | null,
    signal: AbortSignal
  ): Promise<
    DirectoryResult<Readonly<{ id: string; projectId: string | null }>>
  >;
  remove?(
    id: string,
    signal: AbortSignal
  ): Promise<DirectoryResult<Readonly<{ id: string }>>>;
  inspectRemoval?(id: string, signal: AbortSignal): Promise<RemovalInspection>;
  setPinnedOrder?(
    id: string,
    rank: number,
    signal: AbortSignal
  ): Promise<DirectoryResult<ThreadRow>>;
  setArchived?(
    id: string,
    archived: boolean,
    signal: AbortSignal
  ): Promise<DirectoryResult<ThreadRow>>;
  setPinned?(
    id: string,
    pinned: boolean,
    signal: AbortSignal
  ): Promise<DirectoryResult<ThreadRow>>;
  rename?(
    id: string,
    title: string,
    signal: AbortSignal
  ): Promise<DirectoryResult<ThreadRow>>;
  get(id: string, signal: AbortSignal): Promise<ThreadLookupResult>;
  list(signal: AbortSignal): Promise<DirectoryResult<readonly ThreadRow[]>>;
  create(
    signal: AbortSignal,
    projectId?: string | null
  ): Promise<DirectoryResult<ThreadRow>>;
}
