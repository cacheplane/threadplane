// Private example contracts. App ownership and its independent operation
// states are introduced with the application owner, not the directory.
export interface ThreadRow {
  readonly id: string;
  readonly title: string;
}

export type DirectoryResult<T> =
  | Readonly<{ kind: 'ready'; value: T }>
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'cancelled' }>;
export type ThreadLookupResult =
  | DirectoryResult<ThreadRow>
  | Readonly<{ kind: 'missing' }>;

export interface ThreadDirectory {
  get(id: string, signal: AbortSignal): Promise<ThreadLookupResult>;
  list(signal: AbortSignal): Promise<DirectoryResult<readonly ThreadRow[]>>;
  create(signal: AbortSignal): Promise<DirectoryResult<ThreadRow>>;
}
