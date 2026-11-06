import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * Streaming demo — simplest possible @threadplane/chat integration with AG-UI.
 *
 * Retrieves the agent with injectAgent() (provided by provideAgent /
 * provideFakeAgent) and passes it to the prebuilt <chat> composition. The
 * composition handles message rendering, input, typing indicator, and error
 * display internally.
 *
 * Demonstrates the chat-runtime decoupling: same <chat> composition as the
 * LangGraph cockpit, AG-UI runtime instead of LangGraph.
 */
@Component({
  selector: 'app-streaming',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="AG-UI streaming"
      description="Watch an ordinary text reply arrive from the connected AG-UI agent. This experimental preview keeps the current conversation until you start a new one. Tools, pauses and uncertain outcomes require a new conversation."
    >
      <chat placeholder="Ask a fictional streaming question…" [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
    </example-chat-layout>
  `,
})
export class StreamingComponent {
  protected readonly agent = injectAgent();
}
