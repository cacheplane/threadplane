import { ApplicationConfig } from '@angular/core';
import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import {
  AGENT_CLIENT_OPTIONS,
  provideThreadDirectory,
} from '@threadplane/angular';
import {
  createLangGraphThreadDirectory,
  type LangGraphClientOptions,
} from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    // The agent is provided at the component (ThreadsComponent) because its
    // threadId + onThreadId config is per-instance — see threads.component.ts.
    // The directory reads metadata.title; the cap's generate_title
    // graph node writes there. No per-cap key override needed.
    provideThreadDirectory(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        // context.clientOptions is the AGENT_CLIENT_OPTIONS value below.
        createDirectory: (context) =>
          createLangGraphThreadDirectory({
            apiUrl: connection.apiUrl,
            clientOptions: context.clientOptions as
              | LangGraphClientOptions
              | undefined,
          }),
      };
    }),
    {
      provide: AGENT_CLIENT_OPTIONS,
      useFactory: () => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') {
          throw new Error('incompatible runtime');
        }
        return connection.clientOptions;
      },
    },
  ],
};
