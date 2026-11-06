import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * Deployment-runtime demo — production deployment patterns.
 *
 * Shows how injectAgent() connects to a deployed LangGraph Cloud
 * instance using environment-specific API URLs and assistant IDs
 * configured at the provider in app.config.ts.
 */
@Component({
  selector: 'app-deployment-runtime',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="LangGraph deployment runtime"
      description="Send a message to the connected LangGraph runtime. Completed replies stay in this conversation until you start a new one."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask a fictional deployment question…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
    </example-chat-layout>
  `,
})
export class DeploymentRuntimeComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly agent = injectAgent();
}
