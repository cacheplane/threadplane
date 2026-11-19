import type { ThreadEntry } from '@threadplane/core';

/** A projected thread plus the pin rank it was stored with. */
export type ProjectedThread = ThreadEntry & { readonly pinnedOrder?: number };

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
