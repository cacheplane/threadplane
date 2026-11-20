import type { ThreadDirectoryConfig } from '@threadplane/angular';
import type { ThreadDirectory, ThreadEntry } from '@threadplane/core';
import {
  createLangGraphClient,
  createLangGraphThreadDirectory,
  type LangGraphClientOptions,
} from '@threadplane/langgraph';
import { environment } from '../../environments/environment';

/**
 * The LangGraph directory offers every thread command, while its factory is
 * typed by the core contract, where each command is optional. Naming the ones
 * the shell binds lets it call them without asking whether they exist.
 */
export type DemoThreadDirectory = ThreadDirectory &
  Required<
    Pick<
      ThreadDirectory,
      'create' | 'rename' | 'remove' | 'setArchived' | 'setPinned' | 'reorderPinned' | 'setProject'
    >
  >;

/** The one saved thread the SDK returns, as far as the demo reads it. */
interface SavedThread {
  readonly thread_id: string;
  readonly updated_at?: string;
  readonly metadata?: Record<string, unknown> | null;
}

/** Reads the HTTP status off an SDK error, which has no typed error class. */
function errorStatus(error: unknown): number | undefined {
  const direct = (error as { status?: unknown } | null)?.status;
  if (typeof direct === 'number') return direct;
  const nested = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof nested === 'number' ? nested : undefined;
}

/** The directory's own reading of thread metadata, for one thread. */
export function toThreadEntry(thread: SavedThread): ThreadEntry {
  const metadata = thread.metadata ?? {};
  const title = typeof metadata['title'] === 'string' ? metadata['title'].trim() : '';
  const updatedAt = thread.updated_at ? Date.parse(thread.updated_at) : Number.NaN;
  return {
    id: thread.thread_id,
    title: title || 'New chat',
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    pinned: metadata['pinned'] === true,
    archived: metadata['archived'] === true,
    projectId: typeof metadata['projectId'] === 'string' ? metadata['projectId'] : null,
  };
}

/**
 * The demo's thread directory: saved conversations of the LangGraph
 * deployment. Projects stay in the browser (`ProjectsService`), so the
 * directory's own project store is off.
 *
 * `getThread` reads one thread from the backend. The directory lists a single
 * page, and URL thread routing must tell "no such thread" (redirect to a
 * fresh chat) from a thread that is merely older than that page. 404 and 422
 * (not even a valid id) both mean missing; any other failure rejects.
 */
export function demoThreadDirectoryConfig(): ThreadDirectoryConfig<DemoThreadDirectory> {
  let clientOptions: LangGraphClientOptions | undefined;
  return {
    createDirectory: (context) => {
      clientOptions = context.clientOptions as LangGraphClientOptions | undefined;
      return createLangGraphThreadDirectory({
        apiUrl: environment.langGraphApiUrl,
        clientOptions,
        projects: false,
      }) as DemoThreadDirectory;
    },
    getThread: async (threadId) => {
      const client = createLangGraphClient(environment.langGraphApiUrl, {
        ...clientOptions,
        maxRetries: clientOptions?.maxRetries ?? 0,
      });
      try {
        return toThreadEntry(await client.threads.get(threadId));
      } catch (error) {
        const status = errorStatus(error);
        if (status === 404 || status === 422) return null;
        throw error;
      }
    },
  };
}
