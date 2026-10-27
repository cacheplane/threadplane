import { Component, computed } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';
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
 * - `stream.value()` exposes the full graph state, including the `memory` field
 * - `memoryEntries` is derived from `stream.value()` for reactive sidebar rendering
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
    <example-chat-layout>
      <chat main [agent]="agent" class="flex-1 min-w-0" />
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
  // #region memory-signal
  /**
   * The streaming resource connected to the memory graph.
   *
   * The graph returns a `memory` dict alongside messages in its state.
   * We expose it via `stream.value()` and derive a reactive signal for display.
   */
  protected readonly agent = injectAgent();

  /**
   * Reactive list of [key, value] memory entries derived from the graph state.
   *
   * The Python graph stores learned facts in `state.memory` as a plain dict.
   * This signal re-computes whenever the stream state changes.
   */
  protected readonly memoryEntries = computed(() => {
    const val = this.agent.value() as Record<string, unknown>;
    const mem = val?.['memory'];
    if (!mem || typeof mem !== 'object') return [];
    return Object.entries(mem as Record<string, string>);
  });
  // #endregion
}
