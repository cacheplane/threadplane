// libs/chat/src/lib/primitives/chat-message/chat-message.component.ts
import { Component, ChangeDetectionStrategy, input, computed, effect, inject, untracked } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_MESSAGE_STYLES } from '../../styles/chat-message.styles';
import { ChatCitationsComponent } from '../chat-citations/chat-citations.component';
import { CitationsResolverService } from '../../markdown/citations-resolver.service';
import type { Message } from '../../agent/message';
import { OwnedMarkdownContextDirective } from './owned-markdown-context';
import { OwnedMarkdownBodyComponent } from './owned-markdown-body.component';

/** Message roles used to select the chat message layout. */
export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

const DEFAULT_SPEAKERS: Partial<Record<ChatMessageRole, string>> = { user: 'You', assistant: 'Assistant' };

/** Provides role-specific message layout, projected controls, and citations for assistant messages. */
@Component({
  selector: 'chat-message',
  standalone: true,
  imports: [ChatCitationsComponent, OwnedMarkdownBodyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_STYLES],
  providers: [CitationsResolverService],
  host: {
    '[attr.data-role]': 'hostValue(role)',
    '[attr.data-current]': 'hostValue(currentStr)',
    '[attr.data-streaming]': 'hostValue(streamingStr)',
    '[attr.data-prev-role]': 'hostValue(prevRole) ?? null',
  },
  template: `
    @if (speakerText(); as speaker) {
      <span class="chat-message__speaker">{{ speaker }}</span>
    }
    <!-- dir="auto": a message takes its base direction from its own first
         strong character, so right-to-left text keeps its reading order. -->
    <div [class]="bodyClass()" dir="auto" [chatOwnedMarkdownBody]="ownedMarkdownContext?.context() ?? null">
      <ng-container ngProjectAs="[chatBeforeMarkdown]">
        <ng-content select="[chatBeforeMarkdown]" />
      </ng-container>
      <ng-container ngProjectAs="[chatAfterMarkdown]">
        <ng-content select="[chatAfterMarkdown]" />
      </ng-container>
      <ng-content />
      <ng-container ngProjectAs="[chatMarkdownCaret]">
        <span class="chat-message__caret" aria-hidden="true"></span>
      </ng-container>
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
  /**
   * Speaker name read by assistive technology before the message, so a
   * transcript says who said what. Visually hidden; the layout already shows
   * it. Defaults to "You" for user and "Assistant" for assistant messages.
   */
  readonly speaker = input<string | undefined>(undefined);

  private readonly resolver = inject(CitationsResolverService);
  protected readonly ownedMarkdownContext = inject(OwnedMarkdownContextDirective, { optional: true, self: true });

  constructor() {
    effect(() => {
      this.resolver.message.set(this.message() ?? null);
    });
  }

  protected readonly speakerText = computed(() => {
    const name = this.speaker() ?? DEFAULT_SPEAKERS[this.role()];
    return name ? `${name}:` : undefined;
  });

  readonly currentStr = computed(() => String(this.current()));
  readonly streamingStr = computed(() => String(this.streaming()));

  // Angular input writes already schedule this view and its host bindings.
  // Host reads must not enroll each row's inputs in a shared ancestor consumer.
  protected hostValue<T>(read: () => T): T {
    return untracked(read);
  }

  readonly bodyClass = computed(() => {
    switch (this.role()) {
      case 'user': return 'chat-message__bubble';
      case 'assistant': return 'chat-message__assistant-body';
      default: return 'chat-message__plain';
    }
  });
}
