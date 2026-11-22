import type { ApplicationConfig } from '@angular/core';
import {
  provideAgent,
  provideThreadDirectory,
  type AgentSessionContext,
  type ThreadDirectoryContext,
} from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session factory; no production dependency.
import type {
  createSession as createLangGraphSession,
  SessionOptions,
} from '../../langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph thread directory; no production dependency.
import type {
  createLangGraphThreadDirectory as createDirectory,
  LangGraphThreadDirectoryOptions,
} from '../../langgraph/src/runtime/thread-directory';

type Expect<T extends true> = T;

/**
 * The Angular provider sample of the LangGraph README, verbatim: the whole
 * context is spread into `createSession` with no cast.
 */
export function readmeProvider(createSession: typeof createLangGraphSession) {
  const appConfig: ApplicationConfig = {
    providers: [
      provideAgent({
        createSession: async (context) =>
          createSession({
            apiUrl: 'https://your-langgraph-platform.com',
            assistantId: 'my-agent',
            ...context,
          }),
      }),
    ],
  };
  return appConfig;
}

/** The chat README's order: the context last, the same result. */
export function contextLast(createSession: typeof createLangGraphSession) {
  return provideAgent({
    createSession: async (context) =>
      createSession({
        apiUrl: '/api/langgraph',
        assistantId: 'agent',
        ...context,
      }),
  });
}

/** Every context field is one `createSession` reads under the same name. */
export function everyField(
  createSession: typeof createLangGraphSession,
  context: AgentSessionContext
) {
  type Names = Expect<
    keyof AgentSessionContext extends keyof SessionOptions ? true : false
  >;
  // Picking fields one by one compiles as the spread does.
  const session = createSession({
    assistantId: 'chat',
    apiUrl: '/api',
    threadId: context.threadId,
    onThreadId: context.onThreadId,
    clientOptions: context.clientOptions,
    reportOperationFailure: context.reportOperationFailure,
    developmentRuntime: context.developmentRuntime,
  });
  // A host with no reporter and no client options passes `undefined` for both.
  createSession({
    assistantId: 'chat',
    apiUrl: '/api',
    threadId: null,
    clientOptions: undefined,
    reportOperationFailure: undefined,
  });
  return [session, {} as Names] as const;
}

/**
 * The thread directory sample of the Angular README, verbatim, and the spread
 * form: the directory context has only names the options read.
 */
export function readmeDirectory(
  createLangGraphThreadDirectory: typeof createDirectory,
  apiUrl: string
) {
  type Names = Expect<
    keyof ThreadDirectoryContext extends keyof LangGraphThreadDirectoryOptions
      ? true
      : false
  >;
  const providers = [
    provideThreadDirectory({
      createDirectory: ({ clientOptions, reportOperationFailure }) =>
        createLangGraphThreadDirectory({
          apiUrl,
          clientOptions,
          reportOperationFailure,
        }),
    }),
    provideThreadDirectory({
      createDirectory: (context) =>
        createLangGraphThreadDirectory({ apiUrl, ...context }),
    }),
  ];
  return [providers, {} as Names] as const;
}
