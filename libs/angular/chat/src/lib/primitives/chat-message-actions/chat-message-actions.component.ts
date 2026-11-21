// libs/angular/chat/src/lib/primitives/chat-message-actions/chat-message-actions.component.ts
import { Component, ChangeDetectionStrategy, input, output, signal, inject, DOCUMENT } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_MESSAGE_ACTIONS_STYLES } from '../../styles/chat-message-actions.styles';
import { injectChatRuntime } from '../../styles/chat-runtime';

/**
 * Default action buttons that appear under each assistant message:
 * regenerate, copy-to-clipboard, thumbs up, thumbs down.
 *
 * Hidden by default, fades in on `:hover`/`:focus-within` of the parent
 * `chat-message`, and stays visible on the current/last assistant message
 * and on mobile.
 */
@Component({
  selector: 'chat-message-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_ACTIONS_STYLES],
  host: {
    'role': 'toolbar',
    '[attr.aria-label]': '"Message actions"',
  },
  template: `
    @if (canRegenerate()) {
    <button
      type="button"
      class="chat-message-actions__btn"
      aria-label="Regenerate response"
      title="Regenerate"
      [disabled]="disabled()"
      [attr.aria-disabled]="disabled() || null"
      (click)="regenerate.emit()"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
    }
    <button
      type="button"
      class="chat-message-actions__btn"
      [class.is-active]="copied()"
      [attr.aria-label]="copied() ? 'Copied' : 'Copy to clipboard'"
      [title]="copied() ? 'Copied' : 'Copy'"
      (click)="onCopy()"
    >
      @if (copied()) {
        <span class="chat-message-actions__check" aria-hidden="true">✓</span>
      } @else {
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      }
    </button>
    <button
      type="button"
      class="chat-message-actions__btn"
      [class.is-active]="rating() === 'up'"
      [attr.aria-pressed]="rating() === 'up'"
      aria-label="Thumbs up"
      title="Good response"
      (click)="onRate('up')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 11V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1h3z" />
        <path d="M7 11l4-7a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1.5H7" />
      </svg>
    </button>
    <button
      type="button"
      class="chat-message-actions__btn"
      [class.is-active]="rating() === 'down'"
      [attr.aria-pressed]="rating() === 'down'"
      aria-label="Thumbs down"
      title="Poor response"
      (click)="onRate('down')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17 13V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3z" />
        <path d="M17 13l-4 7a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-4H4a2 2 0 0 1-2-2l2-7A2 2 0 0 1 6 5h11" />
      </svg>
    </button>
  `,
})
export class ChatMessageActionsComponent {
  protected readonly chatRuntime = injectChatRuntime();
  /** Plain text content to copy. Required for the copy button to function. */
  readonly content = input<string>('');
  /** When true, the regenerate button is disabled (e.g. while the agent is streaming). */
  readonly disabled = input<boolean>(false);

  /**
   * Whether to offer Regenerate at all. `regenerate` is an optional agent
   * command: bind `!!agent.regenerate` so no control is shown for an agent
   * that cannot do it. Defaults to true.
   */
  readonly canRegenerate = input<boolean>(true);

  /** Emitted when the user clicks regenerate. Wire this to `agent.regenerate(message.id)`. */
  readonly regenerate = output<void>();
  /** Emitted with 'up' or 'down' when the user rates the response. */
  readonly rate = output<'up' | 'down'>();
  /** Emitted with the copied content after a successful clipboard write. */
  readonly contentCopied = output<string>();

  protected readonly copied = signal(false);
  protected readonly rating = signal<'up' | 'down' | null>(null);
  private readonly document = inject(DOCUMENT);

  protected async onCopy(): Promise<void> {
    const text = this.content();
    if (!text) return;
    let succeeded = false;
    const win = this.document.defaultView;
    // Prefer Async Clipboard API; fall back to execCommand if it rejects
    // (e.g. permissions, non-secure context, document-not-focused). The
    // prior impl gated the fallback only on API absence, so a rejecting
    // API silently failed with no user feedback.
    if (win?.navigator?.clipboard?.writeText) {
      try {
        await win.navigator.clipboard.writeText(text);
        succeeded = true;
      } catch {
        // Async API failed — fall through to legacy path below.
      }
    }
    if (!succeeded) {
      try {
        const ta = this.document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        this.document.body.appendChild(ta);
        ta.select();
        succeeded = !!this.document.execCommand?.('copy');
        ta.remove();
      } catch {
        // Both paths failed — leave copied state unchanged.
      }
    }
    if (succeeded) {
      this.copied.set(true);
      this.contentCopied.emit(text);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  protected onRate(value: 'up' | 'down'): void {
    // Toggle off when clicking the same rating.
    this.rating.set(this.rating() === value ? null : value);
    this.rate.emit(value);
  }
}
