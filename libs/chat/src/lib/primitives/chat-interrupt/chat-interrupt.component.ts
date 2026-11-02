// libs/chat/src/lib/primitives/chat-interrupt/chat-interrupt.component.ts
import {
  Component,
  computed,
  contentChild,
  input,
  TemplateRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent } from '../../agent';
import type { AgentInterrupt } from '../../agent/agent-interrupt';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_INTERRUPT_STYLES } from '../../styles/chat-interrupt.styles';

/**
 * Read the agent's current human-in-the-loop interrupt, if any.
 *
 * @param agent - The agent to inspect.
 * @returns The pending {@link AgentInterrupt}, or `undefined` when the agent is
 *   not currently waiting on an interrupt.
 * @example
 * ```ts
 * const interrupt = getInterrupt(agent);
 * if (interrupt) agent.submit({ resume: 'approved' });
 * ```
 */
export function getInterrupt(agent: Agent): AgentInterrupt | undefined {
  return agent.interrupt?.();
}

/** Displays the agent’s current interrupt using a projected template or a default payload preview. */
@Component({
  selector: 'chat-interrupt',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_INTERRUPT_STYLES],
  template: `
    @if (interrupt(); as currentInterrupt) {
      <div class="chat-interrupt" role="status">
        <div class="chat-interrupt__title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
          Agent paused
        </div>
        @if (templateRef()) {
          <ng-container
            [ngTemplateOutlet]="templateRef()!"
            [ngTemplateOutletContext]="{ $implicit: currentInterrupt }"
          />
        } @else {
          <p class="chat-interrupt__body">{{ defaultText(currentInterrupt) }}</p>
        }
      </div>
    }
  `,
})
export class ChatInterruptComponent {
  readonly agent = input.required<Agent>();
  readonly templateRef = contentChild(TemplateRef);
  readonly interrupt = computed(() => getInterrupt(this.agent()));

  defaultText(i: AgentInterrupt): string {
    const v = (i as { value?: unknown }).value;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
}
