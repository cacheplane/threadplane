import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        // The graph also runs a background title model after each visible turn.
        transcriptNodeNames: ['build_form', 'search_flights', 'confirm_booking'],
        clientOptions: connection.clientOptions,
      };
    }),
  ],
};
