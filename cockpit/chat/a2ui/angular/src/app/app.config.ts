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
        // One session per thread: the agent asks for a new one on each
        // thread switch and hands it the thread to open.
        createSession: (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            onOperationFailure: context.reportOperationFailure,
            throttle: 16,
            // The graph also runs a background title model after each visible turn.
            transcriptNodeNames: ['build_form', 'search_flights', 'confirm_booking'],
          }),
      };
    }),
  ],
};
