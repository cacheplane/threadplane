import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import { CHAT_SUGGESTIONS_STYLES } from '../../styles/chat-suggestions.styles';
import { injectChatRuntime } from '../../styles/chat-runtime';

/** Renders suggestion buttons and emits the selected text. */
@Component({
  selector: 'chat-suggestions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_SUGGESTIONS_STYLES],
  template: `
    <div class="chat-suggestions">
      @for (s of suggestions(); track s) {
        <button type="button" class="chat-suggestion" (click)="selected.emit(s)">{{ s }}</button>
      }
    </div>
  `,
})
export class ChatSuggestionsComponent {
  protected readonly chatRuntime = injectChatRuntime();
  readonly suggestions = input<string[]>([]);
  readonly selected = output<string>();
}
