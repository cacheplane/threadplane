import { Component } from '@angular/core';
import { ChatComponent, ChatTimelineSliderComponent } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

/**
 * TimelineComponent demonstrates conversation timeline navigation
 * with ChatComponent and ChatTimelineSliderComponent for scrubbing
 * through conversation checkpoints.
 */
@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [ChatComponent, ChatTimelineSliderComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout sidebarWidth="20rem">
      <!-- #region chat-surface -->
      <chat main [agent]="agent" class="flex-1 min-w-0" />
      <!-- #endregion -->
      <!-- #region timeline-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Timeline</h3>
        <chat-timeline-slider [agent]="agent" />
        <div>
          <h4 class="cap">How It Works</h4>
          <p class="info">
            The sidebar lists saved checkpoints. Replay and Fork events require host wiring.
          </p>
        </div>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
  styles: [`
    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--tplane-chat-bg);
      color: var(--tplane-chat-text);
    }

    .cap {
      margin: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: var(--tplane-chat-line-height-tight);
      text-transform: uppercase;
    }

    .info {
      margin: 0.5rem 0 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-sm);
      line-height: var(--tplane-chat-line-height);
    }
  `],
})
export class TimelineComponent {
  // #region agent
  protected readonly agent = injectAgent();
  // #endregion
}
