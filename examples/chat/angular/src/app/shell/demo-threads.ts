import type { ThreadDirectoryConfig } from '@threadplane/angular';
import {
  createLangGraphThreadDirectory,
  type LangGraphClientOptions,
  type LangGraphThreadDirectory,
} from '@threadplane/langgraph';
import { environment } from '../../environments/environment';

/**
 * The demo's directory type: the LangGraph directory with its project
 * commands off. Naming it at `injectThreadDirectory<DemoThreadDirectory>()`
 * types every thread command as present, so the shell calls them without `?.`.
 */
export type DemoThreadDirectory = LangGraphThreadDirectory<false>;

/**
 * The demo's thread directory: saved conversations of the LangGraph
 * deployment. Projects stay in the browser (`ProjectsService`), so the
 * directory's own project store is off.
 *
 * URL thread routing must tell "no such thread" (redirect to a fresh chat)
 * from a thread that is merely older than the one page the directory lists.
 * The directory's own `get(id)` reads one thread from the backend and answers
 * `null` for 404 and 422, so the view's `getThread` needs no reader here.
 */
export function demoThreadDirectoryConfig(): ThreadDirectoryConfig<DemoThreadDirectory> {
  return {
    createDirectory: (context) =>
      createLangGraphThreadDirectory({
        apiUrl: environment.langGraphApiUrl,
        clientOptions: context.clientOptions as LangGraphClientOptions | undefined,
        reportOperationFailure: context.reportOperationFailure,
        projects: false,
      }),
  };
}
