import { Component, computed } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

const SUGGESTIONS = [
  // values match cockpit/deep-agents/subagents/angular/e2e/*.spec.ts prompts.
  {
    label: 'Two airports at once',
    value: 'Brief me on KASE and KDEN: I need field data for both and the current weather at both.',
    description: 'Four dispatches in a single turn — the specialists run in parallel.',
  },
  {
    label: 'One airport',
    value: 'What is the field data for KSFO?',
    description: 'A single dispatch to the field researcher.',
  },
] as const;

/**
 * SubagentsComponent shows real child agents, not a tool-call log.
 *
 * `SubAgentMiddleware` runs each `task` dispatch as its own graph in its own
 * namespace, and seeds it with the dispatch `description`. The tracker
 * registers the dispatch from the `task` call and attributes the child stream
 * by matching that description — exact match first, then containment either
 * way, then a single remaining candidate. Descriptions that name their airport
 * are what make parallel fan-out render correctly: four children streaming at
 * once land in four separate cards rather than interleaving into one.
 *
 * The cards are rendered inline by the `<chat>` composition and persist after
 * completion. The sidebar keeps the roster and a live dispatch count so the
 * fan-out is visible as a number, not only as a wall of cards.
 */
@Component({
  selector: 'app-subagents',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="Deep Agents subagents"
      description="Dispatch sample field research and weather tasks, and inspect separate native child streams. Aviation lookups use fixed sample data, including weather. Stop cancels local delivery; it does not roll back backend work."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask about field data or weather…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
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
      <!-- #region sidebar-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Dispatches</h3>
        <p class="count" data-testid="dispatch-count">
          {{ dispatchCount() }} dispatched, {{ runningCount() }} running
        </p>
        <h3 class="cap">Specialists</h3>
        <ul class="roster">
          <li><span class="roster__name">field-researcher</span> — elevation and runway length</li>
          <li><span class="roster__name">weather-analyst</span> — conditions and operational impact</li>
        </ul>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
  styles: [
    `
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

      .count {
        margin: 0;
        color: var(--tplane-chat-text);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .roster {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin: 0;
        padding: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
        line-height: var(--tplane-chat-line-height);
        list-style: none;
      }

      .roster__name {
        color: var(--tplane-chat-text);
        font-family: var(--tplane-chat-font-mono);
      }
    `,
  ],
})
export class SubagentsComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly agent = injectAgent();

  protected readonly suggestions = SUGGESTIONS;

  // #region dispatch-signals
  private readonly dispatches = computed(() => [...this.agent.subagents().values()]);

  protected readonly dispatchCount = computed(() => this.dispatches().length);

  protected readonly runningCount = computed(
    () => this.dispatches().filter((subagent) => subagent.status() === 'running').length,
  );
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
