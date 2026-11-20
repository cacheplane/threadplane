// libs/chat/src/lib/compositions/chat/chat-interrupt-template.directive.ts
import { Directive, TemplateRef, inject } from '@angular/core';
import type { Agent, AgentInterrupt } from '../../agent';

/**
 * Template context for the interrupt template projected into `<chat>`.
 */
export interface ChatInterruptTemplateContext {
  /** The agent bound to `<chat>` (`let-agent`). */
  $implicit: Agent;
  /**
   * The first pending interrupt, `agent.interrupts()[0]`
   * (`let-interrupt="interrupt"`).
   */
  interrupt: AgentInterrupt;
  /**
   * Every interrupt the paused run waits on, in the agent's order
   * (`let-interrupts="interrupts"`). A run continues once, so answer them
   * together with one `agent.resume(responses)`.
   */
  interrupts: readonly AgentInterrupt[];
}

/**
 * Registers an interrupt renderer on `<chat>`. While the agent has a pending
 * interrupt (`agent.interrupts()` lists one), the template renders at the
 * end of the transcript, inside the scroll region and after any run
 * activity, so approval cards and other human-in-the-loop UI sit in the
 * conversation. With no pending interrupt, or no template, nothing renders:
 * `<chat>` has no default interrupt UI.
 *
 * Usage:
 *
 * ```html
 *   <chat [agent]="agent">
 *     <ng-template chatInterruptTemplate let-agent let-interrupt="interrupt">
 *       <my-approval-card
 *         [interrupt]="interrupt"
 *         (decide)="agent.resume?.([{ interruptId: interrupt.id, status: 'resolved', value: $event }])"
 *       />
 *     </ng-template>
 *   </chat>
 * ```
 */
@Directive({
  selector: 'ng-template[chatInterruptTemplate]',
  standalone: true,
})
export class ChatInterruptTemplateDirective {
  readonly templateRef = inject<TemplateRef<ChatInterruptTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: ChatInterruptTemplateDirective,
    context: unknown,
  ): context is ChatInterruptTemplateContext {
    return true;
  }
}
