// libs/chat/src/lib/compositions/chat/chat-activity-template.directive.ts
import { Directive, TemplateRef, inject } from '@angular/core';
import type { Agent, Message, Subagent, ToolCall } from '../../agent';

/**
 * Template context for a per-message activity template projected into
 * `<chat>`. One context is built for every assistant message.
 */
export interface ChatActivityTemplateContext {
  /** The assistant message the activity belongs to (`let-message`). */
  $implicit: Message;
  /** Index of the message in `agent.messages()` (`let-i="index"`). */
  index: number;
  /**
   * The tool calls this message emitted, in emission order, excluding the
   * generative-UI dispatcher and view-backed tool names that `<chat>` never
   * renders as cards (`let-toolCalls="toolCalls"`).
   */
  toolCalls: ToolCall[];
  /**
   * Subagents spawned by this message's tool calls, anchored by
   * `Subagent.toolCallId` and ordered like the spawning calls
   * (`let-subagents="subagents"`).
   */
  subagents: Subagent[];
  /** The agent bound to `<chat>` (`let-agent="agent"`). */
  agent: Agent;
}

/**
 * Registers a per-message activity renderer on `<chat>`. When present, the
 * template replaces the reasoning pill and the tool-call region
 * (`<chat-reasoning>` + `<chat-tool-calls>`) of every assistant message.
 * Markdown, tool views, generative UI and message actions still render.
 *
 * The template renders at message level, so tall activity (nested subagent
 * turns, approval cards) is never clipped by a trace body.
 *
 * Precedence: the activity template owns the whole region, so any
 * `chatToolCallTemplate` projected into `<chat>` is not used while an
 * activity template is present. Render `<chat-tool-calls>` inside the
 * activity template to keep per-tool templates.
 *
 * Usage:
 *
 *   <chat [agent]="agent">
 *     <ng-template chatActivityTemplate let-message let-toolCalls="toolCalls" let-subagents="subagents">
 *       <my-activity-summary [message]="message" [calls]="toolCalls" [subagents]="subagents" />
 *     </ng-template>
 *   </chat>
 */
@Directive({
  selector: 'ng-template[chatActivityTemplate]',
  standalone: true,
})
export class ChatActivityTemplateDirective {
  readonly templateRef = inject<TemplateRef<ChatActivityTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: ChatActivityTemplateDirective,
    context: unknown,
  ): context is ChatActivityTemplateContext {
    return true;
  }
}
