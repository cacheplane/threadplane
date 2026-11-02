// libs/chat/src/lib/primitives/chat-typing-indicator/chat-typing-indicator.component.ts
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type { Agent } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_TYPING_INDICATOR_STYLES } from '../../styles/chat-typing-indicator.styles';

/**
 * Whether the agent should show a "typing" indicator — it is loading and has
 * not yet started streaming the assistant's reply.
 *
 * @param agent - The agent to inspect.
 * @returns `true` while the agent is awaiting a response but no assistant text
 *   has streamed yet; `false` once tokens arrive or the agent is idle.
 * @example
 * ```ts
 * \@if (isTyping(agent)) { <chat-typing-indicator [agent]="agent" /> }
 * ```
 */
export function isTyping(agent: Agent): boolean {
  if (!agent.isLoading()) return false;
  const msgs = agent.messages();
  if (msgs.length === 0) return true;
  const last = msgs[msgs.length - 1];
  if (last.role === 'user') return true;
  if (last.role === 'assistant') {
    return typeof last.content === 'string'
      ? !last.content
      : last.content.length === 0;
  }
  return false;
}

/** Displays animated typing dots while a loading agent has not produced assistant content. */
@Component({
  selector: 'chat-typing-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_TYPING_INDICATOR_STYLES],
  host: {
    '[style.display]': "visible() ? null : 'none'",
  },
  template: `
    @if (visible()) {
      <div class="chat-typing__dots" role="status" aria-label="Assistant is typing">
        <span class="chat-typing__dot"></span>
        <span class="chat-typing__dot"></span>
        <span class="chat-typing__dot"></span>
      </div>
    }
  `,
})
export class ChatTypingIndicatorComponent {
  readonly agent = input.required<Agent>();
  readonly visible = computed(() => isTyping(this.agent()));
}
