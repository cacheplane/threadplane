import { Component, ChangeDetectionStrategy, output } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_LAUNCHER_BUTTON_STYLES } from '../../styles/chat-launcher-button.styles';

/** Renders an open-chat button and emits its clicks. */
@Component({
  selector: 'chat-launcher-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_LAUNCHER_BUTTON_STYLES],
  template: `
    <button type="button" class="chat-launcher-button" aria-label="Open chat" (click)="clicked.emit()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  `,
})
export class ChatLauncherButtonComponent {
  /** Fires when the inner <button> receives a click. Prefer this over
   *  binding `(click)` on the host element — explicit output gives
   *  consumers (and Playwright) an unambiguous click target that won't
   *  be intercepted by sibling overlays in higher stacking contexts.
   *  Native `(click)` on the host still works for back-compat: the
   *  click event bubbles through unchanged. */
  readonly clicked = output<void>();
}
