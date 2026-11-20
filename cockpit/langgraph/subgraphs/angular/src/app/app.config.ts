import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { type } from '@threadplane/core';
import { createSession } from '@threadplane/langgraph';
import { SUBGRAPHS_AGENT, type SubgraphsState } from './agent-ref';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(SUBGRAPHS_AGENT, () => {
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
            // Types `agent.state()` as the parent graph's shared keys.
            stateType: type<SubgraphsState>(),
            // Only the parent's `answer` node writes the user-facing turn, so
            // only its streamed chunks enter the transcript. The router model
            // in `orchestrate` produces routing data, not chat content, and
            // this keeps anything it streams out of the chat.
            //
            // A final-state e2e assertion cannot catch a regression here: the
            // parent's saved state corrects the transcript when the run ends,
            // so a stray bubble would only show while the answer streams. The
            // child graph needs no filter. Its messages belong to
            // `agent.subagents()`, never to the transcript.
            transcriptNodeNames: ['answer'],
          }),
      };
    }),
  ],
};
