// libs/chat/src/lib/primitives/chat-sidenav-scrim/chat-sidenav-scrim.component.ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Backdrop scrim for chat-sidenav's drawer mode, rendered as a sibling of
 * `<chat-sidenav>` so its z-index sits cleanly between the page content
 * and the drawer host (escapes the drawer host's stacking context).
 *
 * Usage:
 *
 * ```html
 *   <chat-sidenav-scrim [open]="drawerOpen()" (dismiss)="drawerOpen.set(false)" />
 *   <chat-sidenav [(open)]="drawerOpen" ...></chat-sidenav>
 * ```
 */
@Component({
  selector: 'chat-sidenav-scrim',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <button
        type="button"
        class="chat-sidenav-scrim__button"
        aria-label="Close conversations"
        (click)="dismiss.emit()"
      ></button>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .chat-sidenav-scrim__button {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: var(--tplane-chat-z-drawer-scrim, 1000);
        border: 0;
        padding: 0;
        cursor: pointer;
      }
    `,
  ],
})
export class ChatSidenavScrimComponent {
  /** When true, render the backdrop button covering the viewport. */
  readonly open = input<boolean>(false);
  /** Fires when the user clicks the backdrop. */
  readonly dismiss = output<void>();
}
