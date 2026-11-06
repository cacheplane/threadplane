import { Component, computed } from '@angular/core';
import {
  ChatComponent,
  ChatInterruptPanelComponent,
  ChatWelcomeSuggestionComponent,
} from '@threadplane/chat';
import type { InterruptAction } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

const SUGGESTIONS = [
  // values match cockpit/chat/interrupts/angular/e2e/c-interrupts.spec.ts.
  // Confirm flow: book + Accept → "Booked …"
  {
    label: 'Book a flight (you confirm)',
    value: 'Book me on UA123.',
    description: 'Agent pauses for approval; click Accept in the sidebar to complete the booking.',
  },
  // Cancel flow: book + Ignore → "Booking cancelled."
  {
    label: 'Book a flight (you cancel)',
    value: 'Book me on AA404.',
    description: 'Same interrupt flow; click Ignore to see the cancellation path.',
  },
] as const;

/**
 * InterruptsComponent demonstrates human-in-the-loop approval gates
 * using ChatComponent and ChatInterruptPanelComponent.
 *
 * Shows interrupt payload and action buttons in a sidebar panel.
 * Maps the panel's UI actions to LangGraph resume payloads:
 *   Accept  → resume('confirm')   — the book_flight tool returns Booked …
 *   Ignore  → resume('cancel')    — the book_flight tool returns Booking cancelled.
 * Edit / Respond are not wired for this demo's single-decision booking flow.
 *
 * Welcome chips let users one-click into either recorded aimock flow.
 * Chip labels hint at the modal action that produces the recorded path.
 */
@Component({
  selector: 'app-interrupts',
  standalone: true,
  imports: [
    ChatComponent,
    ChatInterruptPanelComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
  ],
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="Chat interrupts"
      description="Explore flight approvals with demo data. Confirm or cancel a saved booking request; no real ticket is purchased."
    >
      <chat placeholder="Ask about a flight or request a booking…" [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
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
      <!-- #region panel -->
      <div sidebar class="panel">
        <h3 class="cap">Interrupt Panel</h3>
        <chat-interrupt-panel [agent]="agent" (action)="onInterruptAction($event)" />
        <div>
          <h4 class="cap">Stream Status</h4>
          <p class="metric-value">{{ streamStatus() }}</p>
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

    .metric-value {
      margin: 0.5rem 0 0;
      color: var(--tplane-chat-text);
      font-family: var(--tplane-chat-font-mono);
      font-size: var(--tplane-chat-font-size-xs);
      line-height: var(--tplane-chat-line-height);
    }
  `],
})
export class InterruptsComponent {
  protected readonly agent = injectAgent();

  protected readonly streamStatus = computed(() => this.agent.status());
  protected readonly suggestions = SUGGESTIONS;

  // #region resume
  protected onInterruptAction(action: InterruptAction): void {
    if (action === 'accept') {
      this.agent.submit({ resume: 'confirm' });
    } else if (action === 'ignore') {
      this.agent.submit({ resume: 'cancel' });
    }
    // 'edit' and 'respond' are intentionally unhandled for the booking flow.
  }
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
