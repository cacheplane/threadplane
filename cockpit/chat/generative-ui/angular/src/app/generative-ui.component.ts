import { exampleToolLabel } from '../../../../../shared/tool-presentation';
import { Component, viewChild } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent, views } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';
import { signalStateStore } from '@threadplane/render';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

import { StatCardComponent } from './views/stat-card.component';
import { ContainerComponent } from './views/container.component';
import { DashboardGridComponent } from './views/dashboard-grid.component';
import { LineChartComponent } from './views/line-chart.component';
import { BarChartComponent } from './views/bar-chart.component';
import { DataGridComponent } from './views/data-grid.component';

const dashboardViews = views({
  stat_card: StatCardComponent,
  container: ContainerComponent,
  dashboard_grid: DashboardGridComponent,
  line_chart: LineChartComponent,
  bar_chart: BarChartComponent,
  data_grid: DataGridComponent,
});

const WELCOME_SUGGESTIONS = [
  {
    label: 'Airline operations dashboard',
    value: 'Show me a dashboard of airline operations.',
    description: 'Agent emits a render spec; charts and KPI cards appear inline in the chat.',
  },
  {
    label: 'Filter to cancelled flights',
    value: 'Filter to only the cancelled flights.',
    description: 'Follow-up that updates the dashboard state — shows GenUI mutation in action.',
  },
] as const;

@Component({
  selector: 'app-generative-ui',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="Chat generative UI"
      description="Explore airline operations with fixture data. Confirmed dashboards stay in the conversation and refresh together when a new update is saved."
    >
      <button headerActions type="button" (click)="newConversation()">New conversation</button>
      <chat [groupRelatedTools]="true" [toolLabel]="toolLabel" placeholder="Ask about airline operations…" [welcomeDisabled]="true" main [agent]="agent" [views]="dashboardViews" [store]="dashStore" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
        <div chatWelcomeSuggestions>
          @for (s of suggestions; track s.value) {
            <chat-welcome-suggestion
              [label]="s.label"
              [value]="s.value"
              [description]="s.description"
              (selected)="send($event)"
            />
          }
        </div>
      </chat>
    </example-chat-layout>
  `,
})
export class GenerativeUiComponent {
  protected readonly toolLabel = exampleToolLabel;
  private readonly chat = viewChild(ChatComponent);
  protected readonly agent = injectAgent();
  protected readonly dashboardViews = dashboardViews;
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  /**
   * Explicit shared store: backend graph state syncs into it via the chat
   * composition, so every dashboard surface reads live values.
   */
  protected readonly dashStore = signalStateStore({});

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }

  protected newConversation(): void {
    this.agent.switchThread(null);
    this.dashStore.set('', {});
    this.chat()?.clearThread();
    this.chat()?.clearDraft();
  }
}
