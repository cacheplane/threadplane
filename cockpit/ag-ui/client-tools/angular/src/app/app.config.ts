import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/ag-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'ag-ui') {
        throw new Error('incompatible runtime');
      }
      return {
        createSession: async (context) =>
          createSession({
            url: connection.url,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            reportOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
          }),
      };
    }),
  ],
};
