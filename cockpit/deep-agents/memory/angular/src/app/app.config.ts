import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig, inject } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';
import { MemoryScope } from './memory-scope';
import { MemoryTransport } from './memory-transport';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      const scope = inject(MemoryScope);
      const clientOptions = { ...connection.clientOptions, maxRetries: 0 };
      return {
        // Runs once at start and again for each thread switch. Each session
        // gets its own scoped transport: the session creates its thread
        // through `transport.createThread` and reports the id through
        // `context.onThreadId`, so the transport needs no thread callback.
        createSession: async (context) =>
          createSession({
            assistantId: connection.assistantId,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            developmentRuntime: context.developmentRuntime,
            transport: new MemoryTransport(
              connection.apiUrl,
              scope,
              undefined,
              clientOptions,
              context.reportOperationFailure
            ),
          }),
      };
    }),
  ],
};
