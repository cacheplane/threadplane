import type { Thread } from '@langchain/langgraph-sdk';
import type { ThreadRow } from './contracts.js';

export function projectThread(thread: Thread): ThreadRow {
  const title = thread.metadata?.['title'];
  return Object.freeze({
    id: thread.thread_id,
    title:
      typeof title === 'string' && title.trim() ? title.trim() : 'Untitled',
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
