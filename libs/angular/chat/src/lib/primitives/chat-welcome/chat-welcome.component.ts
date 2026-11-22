import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import { CHAT_WELCOME_STYLES } from '../../styles/chat-welcome.styles';
import { injectChatRuntime } from '../../styles/chat-runtime';

/**
 * Empty-state owner. Renders a centered greeting + slot-projected input +
 * optional vertical suggestion rows. Mounted only when the parent chat has
 * no messages and welcome is not disabled.
 *
 * Slots:
 *   [chatWelcomeTitle]       — replaces the default <h1> "How can I help?"
 *   [chatWelcomeInput]       — projects the chat input into the center column
 *   [chatWelcomeSuggestions] — projects suggestion rows below the input
 *
 * Host CSS variables (override on :host or any ancestor):
 *   --tplane-chat-welcome-max-width  default 36rem
 *   --tplane-chat-welcome-gap        default 1.25rem
 *   --tplane-chat-welcome-padding    default 24px
 */
@Component({
  selector: 'chat-welcome',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_WELCOME_STYLES],
  template: `
    <div class="chat-welcome__inner">
      <span class="chat-welcome__beacon" aria-hidden="true"></span>
      <ng-content select="[chatWelcomeTitle]">
        <h1 class="chat-welcome__title">How can I help?</h1>
      </ng-content>
      <div class="chat-welcome__input"><ng-content select="[chatWelcomeInput]" /></div>
      <div class="chat-welcome__suggestions">
        <ng-content select="[chatWelcomeSuggestions]" />
      </div>
    </div>
  `,
})
export class ChatWelcomeComponent {
  protected readonly chatRuntime = injectChatRuntime();
}
