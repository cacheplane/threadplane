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

/** Renders agent messages with registered category templates, or optionally projects caller-owned message rows. */
@Component({
  selector: 'chat-message-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_LIST_STYLES],
  template: `
    @if (projectedMessages()) {
      <ng-content />
    } @else {
      @for (message of messages(); track message.id) {
        @let template = findTemplate(getMessageType(message));
        @if (template) {
          <ng-container
            [ngTemplateOutlet]="template.templateRef"
            [ngTemplateOutletContext]="{ $implicit: message, index: $index }"
          />
        }
      }
    }
  `,
})
export class ChatMessageListComponent {
  readonly agent = input.required<Agent>();

  /**
   * Renders projected message rows instead of the registered message templates.
   * Defaults to false, preserving the generic list's template contexts and queries.
   * The chat composition uses this mode for its inline built-in rows; its list
   * therefore has no registered messageTemplates. Explicitly projected template
   * directives remain available to this list's content query in either mode.
   */
  readonly projectedMessages = input(false);

  readonly messageTemplates = contentChildren(MessageTemplateDirective);

  readonly messages = computed(() => this.agent().messages());

  readonly getMessageType = getMessageType;

  findTemplate(type: MessageTemplateType): MessageTemplateDirective | undefined {
    return this.messageTemplates().find(t => t.chatMessageTemplate() === type);
  }
}
