import { Component, ChangeDetectionStrategy } from '@angular/core';

/** Built-in loading skeleton used when a render entry does not provide its own fallback component. */
@Component({
  selector: 'render-default-fallback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }
    .render-default-fallback {
      border: 1px solid var(--tplane-chat-separator, #303540);
      border-radius: 10px;
      padding: 14px;
      background: var(--tplane-chat-surface-alt, #1a1d23);
    }
    .render-default-fallback__label {
      font-size: 12px;
      color: var(--tplane-chat-text-muted, #9aa0aa);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .render-default-fallback__rows {
      display: flex; flex-direction: column; gap: 8px;
    }
    .render-default-fallback__row {
      height: 10px; border-radius: 5px;
      background: linear-gradient(
        90deg,
        var(--tplane-chat-separator, #303540) 0%,
        color-mix(in srgb, var(--tplane-chat-separator, #303540) 70%, transparent) 50%,
        var(--tplane-chat-separator, #303540) 100%
      );
      background-size: 200% 100%;
      animation: render-default-fallback-shimmer 1.4s ease-in-out infinite;
    }
    .render-default-fallback__row:nth-child(1) { width: 70%; }
    .render-default-fallback__row:nth-child(2) { width: 90%; }
    .render-default-fallback__row:nth-child(3) { width: 50%; }
    @keyframes render-default-fallback-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
  template: `
    <div class="render-default-fallback" role="status" aria-live="polite">
      <div class="render-default-fallback__label">
        <span aria-hidden="true">✨</span>
        <span>Building UI…</span>
      </div>
      <div class="render-default-fallback__rows">
        <div class="render-default-fallback__row"></div>
        <div class="render-default-fallback__row"></div>
        <div class="render-default-fallback__row"></div>
      </div>
    </div>
  `,
})
export class DefaultFallbackComponent {}
