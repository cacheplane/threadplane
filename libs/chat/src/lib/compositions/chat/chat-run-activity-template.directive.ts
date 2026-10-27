// libs/chat/src/lib/compositions/chat/chat-run-activity-template.directive.ts
import { Directive, TemplateRef, inject } from '@angular/core';
import type { Agent, Message } from '../../agent';

/**
 * Template context for the run-activity template projected into `<chat>`.
 * One context is built while a run is active and has no assistant message.
 */
export interface ChatRunActivityTemplateContext {
  /** The agent bound to `<chat>` (`let-agent`). */
  $implicit: Agent;
  /**
   * Whether a run is in flight (`agent.isLoading()`). Always `true` while the
   * template renders (`let-running="running"`).
   */
  running: boolean;
  /**
   * Whether the current run has an assistant message yet. Always `false`
   * while the template renders: the first assistant message hands the run
   * over to the per-message activity slot (`let-hasAssistantMessage="hasAssistantMessage"`).
   */
  hasAssistantMessage: boolean;
  /**
   * The current run's messages: every message after the last user message,
   * or every message when there is none (`let-messages="messages"`).
   */
  messages: Message[];
}

/**
 * Registers a turn-level run-activity renderer on `<chat>`. The template
 * renders after the last message, inside the transcript's scroll region,
 * while a run is active and the current run has no assistant message yet:
 * the window between the user's submit and the first assistant message,
 * which can be long when the first model call is slow. It replaces the
 * default typing indicator in that window.
 *
 * The current run is every message after the last user message. Once an
 * assistant message arrives, the template stops rendering and the
 * per-message `chatActivityTemplate` (or the default reasoning and tool-call
 * region) takes over. A resumed run that continues an existing assistant
 * message never shows it.
 *
 * Without this template, `<chat>` renders the default typing indicator.
 *
 * Usage:
 *
 *   <chat [agent]="agent">
 *     <ng-template chatRunActivityTemplate let-agent>
 *       <my-turn-activity [agent]="agent" />
 *     </ng-template>
 *   </chat>
 */
@Directive({
  selector: 'ng-template[chatRunActivityTemplate]',
  standalone: true,
})
export class ChatRunActivityTemplateDirective {
  readonly templateRef = inject<TemplateRef<ChatRunActivityTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: ChatRunActivityTemplateDirective,
    context: unknown,
  ): context is ChatRunActivityTemplateContext {
    return true;
  }
}
