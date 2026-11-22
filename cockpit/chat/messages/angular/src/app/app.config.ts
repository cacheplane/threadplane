import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';
import { MESSAGES_AGENT, MESSAGES_STATE } from './agent-ref';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(MESSAGES_AGENT, () => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        // One session per thread: the agent asks for a new one on each
        // thread switch and hands it the thread to open.
        createSession: async (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            reportOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
            throttle: 16,
            // Types agent.state() as MessagesState.
            stateType: MESSAGES_STATE,
          }),
      };
    }),
  ],
};
