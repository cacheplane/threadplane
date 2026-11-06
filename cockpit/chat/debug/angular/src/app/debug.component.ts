import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { ChatDebugComponent } from '@threadplane/chat/debug';
import { injectAgent } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * DebugComponent pairs the standard `<chat>` composition with
 * `<chat-debug>`, the devtools dock that carries the timeline, state
 * inspector, and diff viewer.
 *
 * `<chat-debug>` renders `display: contents` and mounts its own fixed
 * launcher, so it adds no layout of its own; both elements carry the
 * layout's `main` projection attribute, and `<chat>` supplies the
 * transcript and the composer that produce the runs to inspect.
 */
@Component({
  selector: 'app-debug',
  standalone: true,
  imports: [ChatComponent, ChatDebugComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="Chat debug"
      description="Ask an aviation question. Watch the answer, processing result and summary arrive, then inspect the observed saved state."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask an aviation question…" #conversation [welcomeDisabled]="true" main [agent]="agent">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <chat-debug main [agent]="agent" />
    </example-chat-layout>
  `,
})
export class DebugPageComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly agent = injectAgent();
}
