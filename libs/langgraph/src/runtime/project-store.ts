import type { ProjectEntry } from '@threadplane/core';

/** Where a thread directory keeps project names. */
export interface ProjectStore {
  list(signal?: AbortSignal): Promise<readonly ProjectEntry[]>;
  create(name: string): Promise<{ readonly id: string }>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}
