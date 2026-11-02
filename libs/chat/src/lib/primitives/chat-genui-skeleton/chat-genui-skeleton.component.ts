import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';

/** Displays an animated loading placeholder while generative UI is being built. */
@Component({
  selector: 'chat-genui-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, `
    :host { display: block; width: 100%; }
    .chat-genui-skeleton {
      border: 1px solid var(--tplane-chat-separator);
      border-radius: 10px;
      padding: 14px;
      background: var(--tplane-chat-surface-alt);
    }
    .chat-genui-skeleton__label {
      font-size: 12px;
      color: var(--tplane-chat-text-muted);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chat-genui-skeleton__rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-genui-skeleton__row {
      height: 10px;
      border-radius: 5px;
      background: linear-gradient(
        90deg,
        var(--tplane-chat-separator) 0%,
        color-mix(in srgb, var(--tplane-chat-separator) 70%, transparent) 50%,
        var(--tplane-chat-separator) 100%
      );
      background-size: 200% 100%;
      animation: chat-genui-skeleton-shimmer 1.4s ease-in-out infinite;
    }
    .chat-genui-skeleton__row:nth-child(1) { width: 70%; }
    .chat-genui-skeleton__row:nth-child(2) { width: 90%; }
    .chat-genui-skeleton__row:nth-child(3) { width: 50%; }
    @keyframes chat-genui-skeleton-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
  template: `
    <div class="chat-genui-skeleton" role="status" aria-live="polite">
      <div class="chat-genui-skeleton__label">
        <span aria-hidden="true">✨</span>
        <span>Building UI…</span>
      </div>
      <div class="chat-genui-skeleton__rows">
        <div class="chat-genui-skeleton__row"></div>
        <div class="chat-genui-skeleton__row"></div>
        <div class="chat-genui-skeleton__row"></div>
      </div>
    </div>
  `,
})
export class ChatGenuiSkeletonComponent {}
