import type { ApplicationConfig } from '@angular/core';
import { provideAgent, type AgentSessionContext } from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI session factory; no production dependency.
import type {
  createSession as createAgUiSession,
  SessionOptions,
} from '../../ag-ui/src/runtime/create-session';

type Expect<T extends true> = T;

/**
 * The Angular quick start of the AG-UI README, verbatim: the whole context is
 * spread into `createSession` with no cast.
 */
export function readmeProvider(createSession: typeof createAgUiSession) {
  const appConfig: ApplicationConfig = {
    providers: [
      provideAgent({
        createSession: async (context) =>
          createSession({ url: 'https://your-backend.example/agent', ...context }),
      }),
    ],
  };
  return appConfig;
}

/** The context first and options after it: the same result. */
export function contextFirst(
  createSession: typeof createAgUiSession,
  fetch: typeof globalThis.fetch
) {
  return provideAgent({
    createSession: async (context) =>
      createSession({ ...context, url: '/api/agent', fetch }),
  });
}

/** Every context field is one `createSession` reads under the same name. */
export function everyField(
  createSession: typeof createAgUiSession,
  context: AgentSessionContext
) {
  type Names = Expect<
    keyof AgentSessionContext extends keyof SessionOptions ? true : false
  >;
  // The pattern that serves either backend: picking fields one by one
  // compiles as the spread does.
  const session = createSession({
    url: '/api/agent',
    threadId: context.threadId,
    onThreadId: context.onThreadId,
    clientOptions: context.clientOptions,
    reportOperationFailure: context.reportOperationFailure,
    developmentRuntime: context.developmentRuntime,
  });
  // A host with no reporter and no client options passes `undefined` for both.
  createSession({
    url: '/api/agent',
    threadId: null,
    onThreadId: undefined,
    clientOptions: undefined,
    reportOperationFailure: undefined,
  });
  // The same over a client agent the application built, and with client tools.
  createSession({ agent: {} as SessionOptions['agent'] & object, ...context });
  createSession({ url: '/api/agent', ...context }, {});
  return [session, {} as Names] as const;
}

export function wrongCallback(createSession: typeof createAgUiSession) {
  // @ts-expect-error onThreadId receives the thread id, a string.
  createSession({ url: '/api/agent', onThreadId: (id: number) => id });
  // @ts-expect-error A thread id is a string or null.
  createSession({ url: '/api/agent', threadId: 7 });
}
