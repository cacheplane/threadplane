import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_SUGGESTIONS_STYLES } from '../../styles/chat-suggestions.styles';

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
  readonly suggestions = input<string[]>([]);
  readonly selected = output<string>();
}
