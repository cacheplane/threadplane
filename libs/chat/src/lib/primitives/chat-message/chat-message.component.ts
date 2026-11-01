// libs/chat/src/lib/primitives/chat-message/chat-message.component.ts
import { Component, ChangeDetectionStrategy, input, computed, effect, inject } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_MESSAGE_STYLES } from '../../styles/chat-message.styles';
import { ChatCitationsComponent } from '../chat-citations/chat-citations.component';
import { CitationsResolverService } from '../../markdown/citations-resolver.service';
import type { Message } from '../../agent/message';

/** Message roles used to select the chat message layout. */
export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Provides role-specific message layout, projected controls, and citations for assistant messages. */
@Component({
  selector: 'chat-message',
  standalone: true,
  imports: [ChatCitationsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_STYLES],
  providers: [CitationsResolverService],
  host: {
    '[attr.data-role]': 'role()',
    '[attr.data-current]': 'currentStr()',
    '[attr.data-streaming]': 'streamingStr()',
    '[attr.data-prev-role]': 'prevRole() ?? null',
  },
  template: `
    <div [class]="bodyClass()">
      <ng-content />
      <span class="chat-message__caret" aria-hidden="true"></span>
    </div>
    @if (message()?.role === 'assistant' && message(); as msg) {
      <chat-citations [message]="msg" />
    }
    <div class="chat-message__controls">
      <ng-content select="[chatMessageControls]" />
    </div>
  `,
})
export class ChatMessageComponent {
  readonly role = input.required<ChatMessageRole>();
  readonly current = input(false);
  readonly streaming = input(false);
  readonly prevRole = input<ChatMessageRole | undefined>(undefined);
  readonly message = input<Message | undefined>(undefined);

  private readonly resolver = inject(CitationsResolverService);

  constructor() {
    effect(() => {
      this.resolver.message.set(this.message() ?? null);
    });
  }

  readonly currentStr = computed(() => String(this.current()));
  readonly streamingStr = computed(() => String(this.streaming()));

  readonly bodyClass = computed(() => {
    switch (this.role()) {
      case 'user': return 'chat-message__bubble';
      case 'assistant': return 'chat-message__assistant-body';
      default: return 'chat-message__plain';
    }
  });
}
