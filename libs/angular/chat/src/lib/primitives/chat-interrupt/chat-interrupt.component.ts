// libs/angular/chat/src/lib/primitives/chat-interrupt/chat-interrupt.component.ts
import {
  Component,
  computed,
  contentChild,
  input,
  TemplateRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { pendingInterrupt, type Agent, type AgentInterrupt } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_INTERRUPT_STYLES } from '../../styles/chat-interrupt.styles';
import { injectChatRuntime } from '../../styles/chat-runtime';

/**
 * Read the interrupt a paused agent shows first, if any. A run may pause on
 * several at once; `agent.interrupts()` lists them all.
 *
 * @param agent - The agent to inspect.
 * @returns The first pending {@link AgentInterrupt}, or `undefined` when the
 *   agent is not waiting on one.
 * @example
 * ```ts
 * const interrupt = getInterrupt(agent);
 * if (interrupt) agent.resume?.([{ interruptId: interrupt.id, status: 'resolved', value: 'approved' }]);
 * ```
 */
export function getInterrupt(agent: Agent): AgentInterrupt | undefined {
  return pendingInterrupt(agent);
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
  protected readonly chatRuntime = injectChatRuntime();
  readonly agent = input.required<Agent>();
  readonly templateRef = contentChild(TemplateRef);
  readonly interrupt = computed(() => getInterrupt(this.agent()));

  defaultText(i: AgentInterrupt): string {
    const v = i.value;
    if (typeof v === 'string') return v;
    // The backend's display text stands in for a pause that carries no value.
    return v === undefined ? i.message ?? '' : JSON.stringify(v);
  }
}
