import { Directive, input, TemplateRef, inject } from '@angular/core';
import type { MessageTemplateType } from '../../chat.types';

/** Registers an ng-template for rendering a specific chat message category. */
@Directive({
  selector: 'ng-template[chatMessageTemplate]',
  standalone: true,
})
export class MessageTemplateDirective {
  readonly chatMessageTemplate = input.required<MessageTemplateType>();
  readonly templateRef = inject(TemplateRef);
}
