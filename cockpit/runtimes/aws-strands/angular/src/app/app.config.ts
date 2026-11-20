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
        createSession: (context) =>
          createSession({
            url: connection.url,
            threadId: context.threadId ?? undefined,
            reportOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
          }),
      };
    }),
  ],
};
