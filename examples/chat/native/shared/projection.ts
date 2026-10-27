import type { Thread } from '@langchain/langgraph-sdk';
import type { ThreadRow } from './contracts.js';

export function projectThread(thread: Thread): ThreadRow {
  const title = thread.metadata?.['title'];
  const rank = thread.metadata?.['pinnedOrder'];
  const updatedAt =
    typeof thread.updated_at === 'string' ? Date.parse(thread.updated_at) : NaN;
  return Object.freeze({
    id: thread.thread_id,
    title:
      typeof title === 'string' && title.trim() ? title.trim() : 'Untitled',
    ...(thread.metadata?.['archived'] === true ? { archived: true } : {}),
    ...(thread.metadata?.['pinned'] === true ? { pinned: true } : {}),
    ...(typeof rank === 'number' && Number.isFinite(rank)
      ? { pinnedOrder: rank }
      : {}),
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
  });
}

export function projectThreads(
  threads: readonly Thread[]
): readonly ThreadRow[] {
  return Object.freeze(threads.map(projectThread));
}

export function filterLoadedTitles(
  rows: readonly ThreadRow[],
  query: string
): readonly ThreadRow[] {
  const search = query.trim().toLowerCase();
  return Object.freeze(
    rows.filter((row) => row.title.toLowerCase().includes(search))
  );
}

// Active application view only. Stable ties retain the supplied loaded order;
// archived views continue to consume their original supplied order.
export function orderActiveThreads(
  rows: readonly ThreadRow[]
): readonly ThreadRow[] {
  const rank = (row: ThreadRow) =>
    typeof row.pinnedOrder === 'number' && Number.isFinite(row.pinnedOrder)
      ? row.pinnedOrder
      : Infinity;
  return Object.freeze(
    rows
      .filter((row) => row.archived !== true)
      .sort((a, b) => {
        if ((a.pinned === true) !== (b.pinned === true))
          return a.pinned === true ? -1 : 1;
        if (a.pinned !== true) return 0;
        const left = rank(a),
          right = rank(b);
        return left === right ? 0 : left < right ? -1 : 1;
      })
  );
}
