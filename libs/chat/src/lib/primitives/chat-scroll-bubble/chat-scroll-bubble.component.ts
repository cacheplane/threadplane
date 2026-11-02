// libs/chat/src/lib/primitives/chat-scroll-bubble/chat-scroll-bubble.component.ts
import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_SCROLL_BUBBLE_STYLES } from '../../styles/chat-scroll-bubble.styles';

/** Selects streaming activity dots or an idle scroll arrow for the latest-activity button. */
export type ChatScrollBubbleMode = 'streaming' | 'idle';

/** Renders a latest-activity button with streaming dots or an idle scroll arrow. */
@Component({
  selector: 'chat-scroll-bubble',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_SCROLL_BUBBLE_STYLES],
  template: `
    <button
      type="button"
      class="chat-scroll-bubble"
      [attr.aria-label]="ariaLabel()"
      (click)="clicked.emit()"
    >
      @if (mode() === 'streaming') {
        <span class="chat-scroll-bubble__dots" aria-hidden="true">
          <span class="chat-scroll-bubble__dot"></span>
          <span class="chat-scroll-bubble__dot"></span>
          <span class="chat-scroll-bubble__dot"></span>
        </span>
      } @else {
        <svg class="chat-scroll-bubble__arrow" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <polyline points="19 12 12 19 5 12"/>
        </svg>
      }
    </button>
  `,
})
export class ChatScrollBubbleComponent {
  readonly mode = input.required<ChatScrollBubbleMode>();
  readonly clicked = output<void>();
  protected readonly ariaLabel = computed(() =>
    this.mode() === 'streaming' ? 'Latest activity' : 'Scroll to latest',
  );
}
