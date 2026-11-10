import { Component, ChangeDetectionStrategy, input, computed, signal } from '@angular/core';
import type { DebugAgent, DebugAgentWithHistory } from '../debug-agent';
import { CHAT_DEBUG_TOKENS } from '../chat-debug-tokens';
import { DebugStateInspectorComponent } from '../debug-state-inspector.component';

@Component({
  selector: 'chat-debug-state-tab',
  standalone: true,
  imports: [DebugStateInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_DEBUG_TOKENS,
    `
    :host { display: flex; flex-direction: column; height: 100%; background: var(--tplane-chat-debug-bg); }
    .state__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--tplane-chat-debug-border);
      background: var(--tplane-chat-debug-bg);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tplane-chat-debug-text-subtle);
    }
    .state__copy {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--tplane-chat-debug-bg-deep);
      border: 1px solid var(--tplane-chat-debug-border);
      border-radius: var(--tplane-chat-radius-card);
      padding: 3px 8px;
      font: inherit;
      font-size: 11px;
      letter-spacing: 0;
      text-transform: none;
      color: var(--tplane-chat-debug-text-muted);
      cursor: pointer;
      transition: color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
    }
    .state__copy:hover {
      color: var(--tplane-chat-debug-text);
      border-color: var(--tplane-chat-debug-border-strong);
    }
    .state__copy.is-copied {
      color: var(--tplane-chat-debug-success);
      border-color: var(--tplane-chat-debug-success);
    }
    .state__copy svg { display: block; }
    .state__body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      color: var(--tplane-chat-debug-text);
    }
    `,
  ],
  template: `
    <div class="state__header">
      <span>Current state</span>
      <button type="button" class="state__copy" [class.is-copied]="justCopied()" (click)="copy()">
        @if (justCopied()) {
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>
          <span>Copied</span>
        } @else {
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M2 9V2.5C2 2.22 2.22 2 2.5 2H9"/></svg>
          <span>Copy</span>
        }
      </button>
    </div>
    <div class="state__body">
      <chat-debug-state-inspector [state]="state()" />
    </div>
  `,
})
export class StateInspectorComponent {
  readonly agent = input.required<DebugAgent | DebugAgentWithHistory>();

  readonly state = computed((): Record<string, unknown> => {
    return this.agent().state();
  });

  protected readonly justCopied = signal<boolean>(false);

  copy(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(JSON.stringify(this.state(), null, 2));
    this.justCopied.set(true);
    setTimeout(() => this.justCopied.set(false), 1500);
  }
}
