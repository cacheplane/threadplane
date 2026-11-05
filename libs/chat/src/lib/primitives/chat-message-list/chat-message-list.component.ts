import {
  Component,
  computed,
  contentChildren,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent, Message } from '../../agent';
import { MessageTemplateDirective } from './message-template.directive';
import type { MessageTemplateType } from '../../chat.types';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_MESSAGE_LIST_STYLES } from '../../styles/chat-message-list.styles';

/**
 * Maps a {@link Message} to a {@link MessageTemplateType}.
 * Exported as a standalone function so it can be unit-tested without DOM rendering.
 */
export function getMessageType(message: Message): MessageTemplateType {
  switch (message.role) {
    case 'user':
      return 'human';
    case 'assistant':
      return 'ai';
    case 'tool':
      return 'tool';
    case 'system':
      return 'system';
    default:
      return 'ai';
  }
}

/** Renders agent messages using the custom template registered for each message category. */
@Component({
  selector: 'chat-message-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_LIST_STYLES],
  template: `
    @for (message of messages(); track message.id) {
      @let template = findTemplate(getMessageType(message));
      @if (template) {
        <ng-container
          [ngTemplateOutlet]="template.templateRef"
          [ngTemplateOutletContext]="{ $implicit: message, index: $index }"
        />
      }
    }
  `,
})
export class ChatMessageListComponent {
  readonly agent = input.required<Agent>();

  readonly messageTemplates = contentChildren(MessageTemplateDirective);

  readonly messages = computed(() => this.agent().messages());

  readonly getMessageType = getMessageType;

  findTemplate(type: MessageTemplateType): MessageTemplateDirective | undefined {
    return this.messageTemplates().find(t => t.chatMessageTemplate() === type);
  }
}
