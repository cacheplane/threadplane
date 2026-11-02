// libs/chat/src/lib/primitives/chat-tool-calls/chat-tool-call-template.directive.ts
import { Directive, TemplateRef, inject, input } from '@angular/core';
import type { ToolCall, ToolCallStatus } from '../../agent';

/**
 * Template-context surface available to a per-tool template. The first
 * argument is the ToolCall itself (let-call); status is exposed as a
 * named context property (let-status="status").
 */
export interface ChatToolCallTemplateContext {
  $implicit: ToolCall;
  status: ToolCallStatus;
}

/**
 * Registers a per-tool-name template inside <chat-tool-calls>. The
 * primitive collects all directive instances via contentChildren() and
 * dispatches incoming calls by their `name` field. A literal "*" name
 * registers a wildcard catch-all that handles any tool name without a
 * specific template registered.
 *
 * Usage:
 *
 * ```html
 *   <chat-tool-calls [agent]="agent" [message]="msg">
 *     <ng-template chatToolCallTemplate="search_web" let-call let-status="status">
 *       <my-search-result-card [query]="call.args.query" [status]="status"/>
 *     </ng-template>
 *     <ng-template chatToolCallTemplate="*" let-call>
 *       <chat-tool-call-card [toolCall]="call"/>
 *     </ng-template>
 *   </chat-tool-calls>
 * ```
 */
@Directive({
  selector: '[chatToolCallTemplate]',
  standalone: true,
})
export class ChatToolCallTemplateDirective {
  /** The tool name this template handles, or "*" for the wildcard catch-all. */
  readonly name = input.required<string>({ alias: 'chatToolCallTemplate' });
  readonly templateRef = inject(TemplateRef<ChatToolCallTemplateContext>);
}
