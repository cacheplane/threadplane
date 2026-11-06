import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * Subagents demo — research-delegation over the AG-UI transport.
 *
 * Retrieves the agent with injectAgent() (provided by provideAgent /
 * provideFakeAgent) and passes it to the prebuilt <chat> composition. No
 * subagent-specific wiring is needed in the component: when the orchestrator
 * dispatches a `task` tool call, the backend emits the protocol's standard
 * SUBAGENT_STARTED / TEXT_MESSAGE_* (attributed via subagentRunId) /
 * SUBAGENT_FINISHED events, the @threadplane/ag-ui reducer projects them onto
 * `agent.subagents()`, and <chat> renders each dispatch inline as a persistent
 * `chat-subagent-card`.
 *
 * Demonstrates the chat-runtime decoupling: same <chat> composition as the
 * LangGraph cockpit, AG-UI runtime instead of LangGraph.
 */
@Component({
  selector: 'app-subagents',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="AG-UI trip specialists"
      description="Plan a fictional trip. Research, booking and itinerary specialists share their progress with the main agent."
    >
      <chat placeholder="Plan a fictional trip…" [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
    </example-chat-layout>
  `,
})
export class SubagentsComponent {
  protected readonly agent = injectAgent();
}
