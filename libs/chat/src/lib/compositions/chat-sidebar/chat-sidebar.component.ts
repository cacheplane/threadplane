// libs/chat/src/lib/compositions/chat-sidebar/chat-sidebar.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  DOCUMENT,
  effect,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import type { Agent } from '../../agent';
import type { ViewRegistry } from '@threadplane/render';
import type { ClientToolRegistry } from '../../client-tools/tool-def';
import { ChatComponent } from '../chat/chat.component';
import { ChatLauncherButtonComponent } from '../../primitives/chat-launcher-button/chat-launcher-button.component';
import type { ChatSelectOption } from '../../primitives/chat-select/chat-select.component';
import { CHAT_HOST_TOKENS, ensureChatRootStyles } from '../../styles/chat-tokens';

/** Hosts an agent chat in a toggleable side panel alongside projected application content. */
@Component({
  selector: 'chat-sidebar',
  standalone: true,
  imports: [ChatComponent, ChatLauncherButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-push]': 'pushContent() ? "true" : "false"',
    '[attr.data-open]': 'open() ? "true" : "false"',
  },
  styles: [CHAT_HOST_TOKENS, `
    /* Flex row so the projected main content fills the area beside the panel
       and inherits the host's height (no hardcoded 100vh). Consumers thread
       height: 100% from their layout down to <chat-sidebar>; the content slot
       then fills it via flex. */
    :host { display: flex; height: 100%; min-height: 0; }
    .chat-sidebar__content {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      transition: margin-right 300ms ease;
    }
    :host([data-push="true"][data-open="true"]) .chat-sidebar__content {
      margin-right: var(--tplane-chat-sidebar-width-drawer, 28rem);
    }
    @media (max-width: 640px) {
      :host([data-push="true"][data-open="true"]) .chat-sidebar__content { margin-right: 0; }
    }
    .chat-sidebar__panel {
      position: fixed;
      top: 0; right: 0;
      bottom: var(--tplane-chat-debug-claim-bottom, 0);
      width: var(--tplane-chat-sidebar-width-drawer, 28rem);
      background: var(--tplane-chat-bg);
      border-left: 1px solid var(--tplane-chat-separator);
      box-shadow: -8px 0 32px rgba(0,0,0,.08);
      transform: translateX(100%);
      transition: transform 200ms ease-out, bottom 200ms ease-out;
      z-index: var(--tplane-chat-z-overlay-content, 30);
      display: flex;
      flex-direction: column;
    }
    .chat-sidebar__panel[data-open="true"] { transform: translateX(0); }
    @media (max-width: 640px) {
      .chat-sidebar__panel { width: 100vw; }
    }
    .chat-sidebar__panel-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--tplane-chat-separator);
      min-height: 48px;
    }
    .chat-sidebar__panel-title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--tplane-chat-text);
      font-weight: 500;
      font-size: var(--tplane-chat-font-size-sm);
    }
    .chat-sidebar__close {
      flex: 0 0 auto;
      width: 32px; height: 32px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--tplane-chat-text-muted);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .chat-sidebar__close:hover { background: var(--tplane-chat-surface-alt); color: var(--tplane-chat-text); }
    .chat-sidebar__launcher {
      position: fixed;
      bottom: calc(1rem + var(--tplane-chat-debug-claim-bottom, 0));
      right: 1rem;
      z-index: var(--tplane-chat-z-overlay-content, 30);
      transition: bottom 200ms ease-out;
    }
    /* Hide the launcher when the sidebar is open — the close button on the
       panel handles dismissal, and the panel covers the launcher anyway. */
    :host([data-open="true"]) .chat-sidebar__launcher { display: none; }
  `],
  template: `
    <div class="chat-sidebar__content"><ng-content /></div>
    <div class="chat-sidebar__launcher">
      <chat-launcher-button (clicked)="toggle()" />
    </div>
    <aside class="chat-sidebar__panel" [attr.data-open]="open() ? 'true' : 'false'" role="complementary" [attr.aria-hidden]="open() ? 'false' : 'true'">
      <div class="chat-sidebar__panel-header">
        <div class="chat-sidebar__panel-title">
          <ng-content select="[chatSidebarPanelTitle]" />
        </div>
        <button type="button" class="chat-sidebar__close" (click)="closeWindow()" aria-label="Close chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
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
    </aside>
  `,
})
export class ChatSidebarComponent {
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
  /** Close the sidebar on Escape (default true). */
  readonly closeOnEscape = input<boolean>(true);
  readonly pushContent = input<boolean>(false);
  /** Emitted when the user clicks the regenerate button on an assistant message. */
  readonly regenerate = output<void>();
  /** Emitted when the user rates an assistant message. */
  readonly rate = output<{ messageIndex: number; rating: 'up' | 'down' }>();
  /** Emitted when the user copies an assistant message. */
  readonly messageCopy = output<{ messageIndex: number; content: string }>();

  private readonly document = inject(DOCUMENT);

  constructor() {
    // Inject chat lib root CSS custom properties — see ChatComponent
    // for the full rationale. Idempotent + lifecycle-guaranteed.
    ensureChatRootStyles();
    // Publish the right-edge claim while the panel is open. Peer panels
    // (e.g. chat-debug) read --tplane-chat-occupy-right to leave room.
    effect((onCleanup) => {
      if (typeof document === 'undefined') return;
      const html = document.documentElement;
      if (this.open()) {
        html.dataset['threadplaneChatSidebar'] = 'open';
      } else {
        delete html.dataset['threadplaneChatSidebar'];
      }
      // Clear the global claim when the sidebar is destroyed (not just closed).
      // Without this, unmounting while open (e.g. switching demo modes) leaves
      // data-threadplane-chat-sidebar="open" stuck on <html>, so peer panels
      // keep reserving --tplane-chat-occupy-right and a phantom gap persists.
      onCleanup(() => { delete html.dataset['threadplaneChatSidebar']; });
    });
    effect((onCleanup) => {
      const closeOnEscape = this.closeOnEscape();
      const win = this.document.defaultView;
      if (!win) return;
      const handler = (e: KeyboardEvent): void => {
        if (closeOnEscape && this.open() && e.key === 'Escape') {
          this.closeWindow();
        }
      };
      win.addEventListener('keydown', handler);
      onCleanup(() => win.removeEventListener('keydown', handler));
    });
  }

  toggle(): void { this.open.update((v) => !v); }
  openWindow(): void { this.open.set(true); }
  closeWindow(): void { this.open.set(false); }
}
