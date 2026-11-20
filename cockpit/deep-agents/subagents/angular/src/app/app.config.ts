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
        createSession: (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            onOperationFailure: context.reportOperationFailure,
            // `SubAgentMiddleware` dispatches every child through one tool
            // named `task`, carrying `{description, subagent_type}`. That name
            // is also the session's default, so this line changes nothing at
            // runtime: it is here to say out loud which tool call means "a
            // child agent started". Set it when your dispatch tool is named
            // something else; overriding it with a name the graph never calls
            // is what turns the cards back into generic tool chips.
            subagentToolNames: ['task'],
          }),
      };
    }),
  ],
};
