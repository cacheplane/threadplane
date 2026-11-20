import { Component, computed } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/angular';
import type { LangGraphSession } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * MemoryComponent demonstrates thread-scoped persistent context with `injectAgent()`.
 *
 * This example shows how an agent can learn and remember facts about the user
 * within the same conversation. The graph maintains a `memory` dict in its
 * state that is updated as new facts are extracted from the conversation.
 * Memory shared across threads would require the separate LangGraph Store API.
 *
 * Key integration points:
 * - `agent.state()` exposes the graph state, including the `memory` field
 * - `memoryEntries` is derived from `agent.state()` for reactive sidebar rendering
 * - Facts appear in the sidebar as the agent learns them during conversation
 */
@Component({
  selector: 'app-memory',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  styles: `
    .panel { padding: 1rem; }
    .cap {
      margin-bottom: 1rem;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .empty { font-size: 13px; font-style: italic; color: var(--ds-text-muted, #a0a0a0); }
    .fact {
      padding: 6px 0;
      font-size: 13px;
      border-bottom: 1px solid var(--ds-border, #2d2d2d);
    }
    .fact:last-child { border-bottom: none; }
    .fact__key { font-weight: 600; color: var(--ds-text-primary, #f5f5f5); }
    .fact__value { color: var(--ds-text-secondary, #c8c8c8); }
  `,
  template: `
    <example-chat-layout
      title="LangGraph memory"
      description="Teach the assistant a fictional fact, then ask it to recall it in this conversation. Each reply is followed by a memory extraction pass. A new conversation starts empty."
    >
      <button headerActions type="button" [disabled]="agent.status() === 'running'"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Tell me a fictional fact…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.status() === 'running' ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <!-- #region memory-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Learned Facts</h3>
        @if (memoryEntries().length === 0) {
          <p class="empty">No facts learned yet</p>
        }
        @for (entry of memoryEntries(); track entry[0]) {
          <div class="fact">
            <span class="fact__key">{{ entry[0] }}:</span>
            <span class="fact__value"> {{ entry[1] }}</span>
          </div>
        }
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
})
export class MemoryComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.status() === 'running') return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  // #region memory-signal
  /**
   * The agent connected to the memory graph.
   *
   * The graph returns a `memory` dict alongside messages in its state.
   * We read it from `agent.state()` and derive a reactive signal for display.
   */
  protected readonly agent = injectAgent<LangGraphSession>();

  /**
   * Reactive list of [key, value] memory entries derived from the graph state.
   *
   * The Python graph stores learned facts in `state.memory` as a plain dict.
   * This signal re-computes whenever the graph state changes.
   */
  protected readonly memoryEntries = computed(() => {
    const mem = this.agent.state()?.['memory'];
    if (!mem || typeof mem !== 'object') return [];
    return Object.entries(mem as Record<string, string>);
  });
  // #endregion
}
