import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ɵCHAT_RUNTIME } from '@threadplane/angular/chat';

@Component({
  selector: 'a2ui-default-fallback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The chat UI's host typography. The `--tplane-chat-*` token defaults are on
  // `:root`, which the chat runtime below installs.
  styles: [`
    :host {
      font-family: var(--tplane-chat-font-family);
      color: var(--tplane-chat-text);
    }
    :host { display: block; width: 100%; }
    .a2ui-default-fallback {
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-card);
      padding: 14px;
      background: var(--tplane-chat-surface-alt);
    }
    .a2ui-default-fallback__label {
      font-size: 12px;
      color: var(--tplane-chat-text-muted);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .a2ui-default-fallback__rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .a2ui-default-fallback__row {
      height: 10px;
      border-radius: var(--tplane-chat-radius-sm);
      background: linear-gradient(
        90deg,
        var(--tplane-chat-separator) 0%,
        color-mix(in srgb, var(--tplane-chat-separator) 70%, transparent) 50%,
        var(--tplane-chat-separator) 100%
      );
      background-size: 200% 100%;
      animation: a2ui-default-fallback-shimmer 1.4s ease-in-out infinite;
    }
    .a2ui-default-fallback__row:nth-child(1) { width: 70%; }
    .a2ui-default-fallback__row:nth-child(2) { width: 90%; }
    .a2ui-default-fallback__row:nth-child(3) { width: 50%; }
    @keyframes a2ui-default-fallback-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
  template: `
    <div class="a2ui-default-fallback" role="status" aria-live="polite">
      <div class="a2ui-default-fallback__label">
        <span aria-hidden="true">&#10024;</span>
        <span>Building UI&hellip;</span>
      </div>
      <div class="a2ui-default-fallback__rows">
        <div class="a2ui-default-fallback__row"></div>
        <div class="a2ui-default-fallback__row"></div>
        <div class="a2ui-default-fallback__row"></div>
      </div>
    </div>
  `,
})
export class A2uiDefaultFallbackComponent {
  protected readonly chatRuntime = inject(ɵCHAT_RUNTIME);
}
