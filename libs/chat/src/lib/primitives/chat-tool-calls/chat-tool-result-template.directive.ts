// libs/chat/src/lib/primitives/chat-tool-calls/chat-tool-result-template.directive.ts
import { Directive, TemplateRef, inject, input } from '@angular/core';
import type { ToolActivityInfo } from '../chat-tool-activity/chat-tool-activity.component';

/** Template context for a per-call result slot: the resolved activity, after any `toolOutcome` hook ran. */
export interface ChatToolResultTemplateContext {
  $implicit: ToolActivityInfo;
}

/**
 * Registers an app-owned result or action template for default tool rows.
 * The template renders outside the technical Details, once per matching
 * call, with the resolved `ToolActivityInfo`. A literal "*" matches any tool
 * name without a specific template; a name match wins over "*". Tools that
 * have a `chatToolCallTemplate` keep that full replacement, and result
 * templates do not apply to them. Name the call in any control, because a
 * bare "Retry" below a collapsed group does not say which call it acts on.
 *
 * ```html
 *   <chat [agent]="agent">
 *     <ng-template chatToolResultTemplate="read_reference" let-activity>
 *       @if (activity.phase === 'error') {
 *         <button type="button" (click)="retryRead(activity.id)">Retry reference read</button>
 *       }
 *     </ng-template>
 *   </chat>
 * ```
 */
@Directive({
  selector: 'ng-template[chatToolResultTemplate]',
  standalone: true,
})
export class ChatToolResultTemplateDirective {
  /** The tool name this template handles, or "*" for the wildcard. */
  readonly name = input.required<string>({ alias: 'chatToolResultTemplate' });
  readonly templateRef = inject<TemplateRef<ChatToolResultTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: ChatToolResultTemplateDirective,
    _context: unknown
  ): _context is ChatToolResultTemplateContext {
    return true;
  }
}
