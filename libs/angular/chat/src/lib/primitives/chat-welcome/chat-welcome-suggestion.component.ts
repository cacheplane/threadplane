import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import { CHAT_WELCOME_SUGGESTION_STYLES } from '../../styles/chat-welcome.styles';
import { ɵinjectChatRuntime as injectChatRuntime } from '@threadplane/angular/chat/shared';

/** Renders a labeled welcome suggestion and emits its associated value when selected. */
@Component({
  selector: 'chat-welcome-suggestion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_WELCOME_SUGGESTION_STYLES],
  template: `
    <button
      type="button"
      class="chat-welcome-suggestion"
      [attr.title]="description() || null"
      [attr.aria-description]="description() || null"
      (click)="selected.emit(value())"
    >
      <ng-content select="[chatWelcomeSuggestionIcon]" />
      <span class="chat-welcome-suggestion__label">{{ label() }}</span>
      <span class="chat-welcome-suggestion__chevron" aria-hidden="true">›</span>
    </button>
  `,
})
export class ChatWelcomeSuggestionComponent {
  protected readonly chatRuntime = injectChatRuntime();
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** Optional short description, surfaced as a hover/focus tooltip on the chip. */
  readonly description = input<string>();
  readonly selected = output<string>();
}
