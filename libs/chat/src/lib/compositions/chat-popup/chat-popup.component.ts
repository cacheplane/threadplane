// libs/chat/src/lib/compositions/chat-popup/chat-popup.component.ts
import { Component, ChangeDetectionStrategy, input, model, DestroyRef, inject, DOCUMENT, effect, output } from '@angular/core';
import type { Agent } from '../../agent';
import type { ViewRegistry } from '@threadplane/render';
import type { ClientToolRegistry } from '../../client-tools/tool-def';
import { ChatComponent } from '../chat/chat.component';
import type { ChatSelectOption } from '../../primitives/chat-select/chat-select.component';
import { ChatLauncherButtonComponent } from '../../primitives/chat-launcher-button/chat-launcher-button.component';
import { CHAT_HOST_TOKENS, ensureChatRootStyles } from '../../styles/chat-tokens';

@Component({
  selector: 'chat-popup',
  standalone: true,
  imports: [ChatComponent, ChatLauncherButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, `
    :host {
      position: fixed;
      bottom: var(--tplane-chat-launcher-offset-y);
      right: var(--tplane-chat-launcher-offset-x);
      z-index: var(--tplane-chat-z-overlay-content, 30);
    }
    .chat-popup__launcher { position: relative; }
    .chat-popup__window {
      position: fixed;
      bottom: 5rem;
      right: var(--tplane-chat-launcher-offset-x);
      width: 24rem;
      height: 600px;
      max-height: calc(100vh - 6rem);
      background: var(--tplane-chat-bg);
      border: 1px solid var(--tplane-chat-separator);
      border-radius: 0.75rem;
      box-shadow: 0 5px 40px rgba(0,0,0,.16);
      transform-origin: bottom right;
      transform: scale(0.95) translateY(20px);
      opacity: 0;
      pointer-events: none;
      transition: transform 200ms ease-out, opacity 100ms ease-out;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .chat-popup__window[data-open="true"] {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: auto;
    }
    @media (max-width: 640px) {
      .chat-popup__window { inset: 0; width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; bottom: auto; right: auto; }
    }
    .chat-popup__close {
      position: absolute; top: 8px; right: 8px;
      width: 32px; height: 32px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--tplane-chat-text-muted);
      border-radius: 50%;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .chat-popup__close:hover { background: var(--tplane-chat-surface-alt); color: var(--tplane-chat-text); }
  `],
  template: `
    <div class="chat-popup__launcher">
      <chat-launcher-button (clicked)="toggle()" />
    </div>
    <div class="chat-popup__window" [attr.data-open]="open() ? 'true' : 'false'" role="dialog" aria-modal="false">
      <button type="button" class="chat-popup__close" (click)="closeWindow()" aria-label="Close chat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <chat
        [agent]="agent()"
        [views]="views()"
        [clientTools]="clientTools()"
        [modelOptions]="modelOptions()"
        [showModelPicker]="showModelPicker()"
        [selectedModel]="selectedModel()"
        (selectedModelChange)="selectedModel.set($event)"
        (regenerate)="regenerate.emit()"
        (rate)="rate.emit($event)"
        (messageCopy)="messageCopy.emit($event)"
      >
        <ng-content select="[chatHeader]" chatHeader />
        <ng-content select="[chatWelcomeSuggestions]" chatWelcomeSuggestions />
      </chat>
    </div>
  `,
})
export class ChatPopupComponent {
  readonly agent = input.required<Agent>();
  /** A2UI component catalog forwarded to the inner <chat>. Without it,
   * messages classified as A2UI parse correctly but never mount a
   * surface. Pass `a2uiBasicCatalog()` from `@threadplane/chat`. */
  readonly views = input<ViewRegistry | undefined>(undefined);
  /** Frontend-declared client tools forwarded to the inner `<chat>`. */
  readonly clientTools = input<ClientToolRegistry | undefined>(undefined);
  /** Forwarded to the inner <chat>. When non-empty, a model picker pill
   * renders in the chat-input chrome. */
  readonly modelOptions = input<readonly ChatSelectOption[]>([]);
  /**
   * Forwarded to the inner `<chat>`. When `false`, hides the
   * auto-rendered model picker even with non-empty `modelOptions`.
   * Use this in narrow surfaces (the chat-sidebar panel is 28rem
   * wide; chat-popup is 24rem) where the picker crowds the input.
   * Defaults to `true`.
   */
  readonly showModelPicker = input<boolean>(true);
  /** Two-way bound current model value. */
  readonly selectedModel = model<string>('');
  readonly open = model(false);
  /**
   * Keyboard shortcut (single key) that toggles the popup with cmd (mac)
   * or ctrl (other). Set to `null` to disable. Default: 'k' — matches the
   * widely-used cmd/ctrl+K convention.
   */
  readonly shortcut = input<string | null>('k');
  /** Close the popup on Escape (default true). */
  readonly closeOnEscape = input<boolean>(true);
  /** Emitted when the user clicks the regenerate button on an assistant message. */
  readonly regenerate = output<void>();
  /** Emitted when the user rates an assistant message. */
  readonly rate = output<{ messageIndex: number; rating: 'up' | 'down' }>();
  /** Emitted when the user copies an assistant message. */
  readonly messageCopy = output<{ messageIndex: number; content: string }>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  constructor() {
    // Inject chat lib root CSS custom properties — see ChatComponent
    // for the full rationale. Idempotent + lifecycle-guaranteed.
    ensureChatRootStyles();
    effect(() => {
      // Re-bind whenever shortcut/closeOnEscape change.
      const shortcut = this.shortcut();
      const closeOnEscape = this.closeOnEscape();
      const win = this.document.defaultView;
      if (!win) return;
      const isMac = /Mac|iPhone|iPad/i.test(win.navigator.platform || win.navigator.userAgent);
      const handler = (e: KeyboardEvent): void => {
        if (shortcut && e.key.toLowerCase() === shortcut.toLowerCase() && (isMac ? e.metaKey : e.ctrlKey)) {
          e.preventDefault();
          this.toggle();
          return;
        }
        if (closeOnEscape && this.open() && e.key === 'Escape') {
          this.closeWindow();
        }
      };
      win.addEventListener('keydown', handler);
      this.destroyRef.onDestroy(() => win.removeEventListener('keydown', handler));
    });
  }

  toggle(): void { this.open.update((v) => !v); }
  openWindow(): void { this.open.set(true); }
  closeWindow(): void { this.open.set(false); }
}
