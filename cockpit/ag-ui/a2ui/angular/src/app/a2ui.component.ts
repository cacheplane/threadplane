import { Component } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent, a2uiBasicCatalog } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/ag-ui';

const WELCOME_SUGGESTIONS = [
  {
    label: 'Book LAX → JFK',
    value: 'I want to fly LAX to JFK',
    description: 'Agent emits an A2UI form spec; watch the booking form render in-chat.',
  },
  {
    label: 'Book SFO → SEA',
    value: 'I want to fly SFO to SEA',
    description: 'Same A2UI pattern on a different route — try both to compare.',
  },
] as const;

@Component({
  selector: 'app-a2ui',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="Plan a flight"
      description="Flight preview: request a flight form, edit your details, and select a demonstration flight. This preview makes no booking or payment."
    >
      <chat placeholder="Ask for a flight form…" [welcomeDisabled]="true" main [agent]="agent" [views]="catalog" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
        <div chatWelcomeSuggestions>
          @for (s of suggestions; track s.value) {
            <chat-welcome-suggestion [label]="s.label" [value]="s.value" [description]="s.description" (selected)="send($event)" />
          }
        </div>
      </chat>
    </example-chat-layout>
  `,
})
export class A2uiComponent {
  protected readonly agent = injectAgent();
  protected readonly catalog = a2uiBasicCatalog();
  protected readonly suggestions = WELCOME_SUGGESTIONS;
  protected send(text: string): void { void this.agent.submit({ message: text }); }
}
