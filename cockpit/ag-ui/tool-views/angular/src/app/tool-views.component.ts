import { exampleToolLabel } from '../../../../../shared/tool-presentation';
import { Component } from '@angular/core';
import { ChatComponent, views } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { WeatherCardComponent } from './weather-card.component';

/**
 * Tool-views demo — renders a frontend component for a tool call by reusing
 * the chat composition's `views` registry. The agent calls a tool named
 * `weather_card`; the component registered under that key renders inline in
 * the transcript, live from the call's args/result/status. No UI spec is
 * sent from the backend.
 */
@Component({
  selector: 'app-tool-views',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="AG-UI weather cards"
      description="Ask for a city’s weather. The agent runs a server tool and the page displays its demo reading alongside the conversation."
    >
      <chat [groupRelatedTools]="true" [toolLabel]="toolLabel" placeholder="Ask for a city’s weather…" [welcomeDisabled]="true" main [agent]="agent" [views]="views" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
    </example-chat-layout>
  `,
})
export class ToolViewsComponent {
  protected readonly toolLabel = exampleToolLabel;
  protected readonly agent = injectAgent();
  protected readonly views = views({ weather_card: WeatherCardComponent });
}
