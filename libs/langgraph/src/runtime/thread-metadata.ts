import type { ProjectEntry, ThreadEntry } from '@threadplane/core';

// The one copy of the thread metadata rules. `createLangGraphThreadDirectory`
// and the Angular `LangGraphThreadsAdapter` both read and write threads
// through these helpers.

/** A projected thread plus the pin rank it was stored with. */
export type ProjectedThread = ThreadEntry & { readonly pinnedOrder?: number };

/** Fields an optimistic patch may change. */
export type ThreadPatchFields = Partial<
  Pick<ProjectedThread, 'title' | 'archived' | 'pinned' | 'projectId'> & {
    pinnedOrder: number;
    removed: true;
  }
>;

/**
 * Projects a LangGraph thread onto a directory entry. Reads the metadata keys
 * the Angular adapter writes (`title`, `archived`, `pinned`, `pinnedOrder`,
 * `projectId`) and replaces anything malformed with a fallback; it never
 * throws on metadata shape.
 */
export function projectThread(
  raw: { thread_id: string; updated_at?: string; metadata?: unknown },
  titleFallback: string
): ProjectedThread {
  const metadata =
    typeof raw.metadata === 'object' &&
    raw.metadata !== null &&
    !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};
  const title = metadata['title'];
  const rank = metadata['pinnedOrder'];
  const projectId = metadata['projectId'];
  const updatedAt =
    typeof raw.updated_at === 'string' ? Date.parse(raw.updated_at) : NaN;
  return Object.freeze({
    id: raw.thread_id,
    title:
      typeof title === 'string' && title.trim() ? title.trim() : titleFallback,
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    pinned: metadata['pinned'] === true,
    archived: metadata['archived'] === true,
    projectId:
      typeof projectId === 'string' && projectId.trim() ? projectId : null,
    ...(typeof rank === 'number' && Number.isFinite(rank)
      ? { pinnedOrder: rank }
      : {}),
  });
}

/**
 * Splits entries into active and archived lists. Active threads put pinned
 * ones first by `pinnedOrder` (missing order last); every other tie keeps the
 * order the server returned, as `LangGraphThreadsAdapter` does. Archived
 * threads keep server order.
 */
export function orderThreads<T extends ProjectedThread>(
  entries: readonly T[]
): { threads: T[]; archived: T[] } {
  const rank = (entry: T) => entry.pinnedOrder ?? Infinity;
  const threads = entries
    .filter((entry) => !entry.archived)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (!a.pinned) return 0;
      const left = rank(a);
      const right = rank(b);
      return left === right ? 0 : left < right ? -1 : 1;
    });
  return { threads, archived: entries.filter((entry) => entry.archived) };
}

/** Applies a patch; a removal drops the entry. */
export function applyPatch(
  entry: ProjectedThread,
  fields: ThreadPatchFields
): ProjectedThread | undefined {
  if (fields.removed) return undefined;
  return Object.freeze({ ...entry, ...fields });
}

/** The published entry: no `pinnedOrder`. */
export function stripOrder(entry: ProjectedThread): ThreadEntry {
  return Object.freeze({
    id: entry.id,
    title: entry.title,
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
    pinned: entry.pinned,
    archived: entry.archived,
    projectId: entry.projectId,
  });
}

/** Field-by-field equality, including the pin rank. */
export function sameEntry(a: ProjectedThread, b: ProjectedThread): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.updatedAt === b.updatedAt &&
    a.pinned === b.pinned &&
    a.archived === b.archived &&
    a.projectId === b.projectId &&
    a.pinnedOrder === b.pinnedOrder
  );
}

/** Same length and same element references. */
export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Same ids and names in the same order. */
export function sameProjects(
  a: readonly ProjectEntry[],
  b: readonly ProjectEntry[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (project, i) => project.id === b[i]?.id && project.name === b[i]?.name
    )
  );
}
