import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { type } from '@threadplane/core';
import { createSession } from '@threadplane/langgraph';
import { CLIENT_TOOLS_AGENT_REF, type ClientToolsState } from './agent-ref';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(CLIENT_TOOLS_AGENT_REF, () => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        // Runs once at start and again for each thread switch.
        createSession: (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            onOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
            // Types `agent.state()`. No `tools` map is given, so the session
            // offers `clientTools`, which `<chat [clientTools]>` drives: it
            // sends the catalog and settles each call the browser runs.
            stateType: type<ClientToolsState>(),
          }),
      };
    }),
  ],
};
