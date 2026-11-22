import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        // Runs once at start and again for each thread switch.
        createSession: async (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            reportOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
          }),
      };
    }),
  ],
};
