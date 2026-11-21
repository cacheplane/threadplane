import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CHAT_DEBUG_TOKENS } from './chat-debug-tokens';

export interface DebugCheckpoint {
  node?: string;
  duration?: number;
  tokenCount?: number;
  checkpointId?: string;
}

@Component({
  selector: 'chat-debug-checkpoint-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_DEBUG_TOKENS,
    `
    .debug-checkpoint-card {
      width: 100%;
      text-align: left;
      border-radius: var(--tplane-chat-radius-card);
      border: 1px solid var(--tplane-chat-separator);
      padding: 8px 12px;
      cursor: pointer;
      background: var(--tplane-chat-bg);
      transition: background var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease), border-color var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
    }
    .debug-checkpoint-card:hover {
      background: color-mix(in srgb, var(--tplane-chat-text) 5%, transparent);
    }
    .debug-checkpoint-card--selected {
      border-color: var(--tplane-chat-text-muted);
      background: color-mix(in srgb, var(--tplane-chat-text) 5%, transparent);
    }
    .debug-checkpoint-card__title {
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 500;
      color: var(--tplane-chat-text);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .debug-checkpoint-card__meta {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .debug-checkpoint-card__badge {
      font-size: var(--tplane-chat-font-size-xs);
      padding: 2px 6px;
      border-radius: var(--tplane-chat-radius-sm);
      background: var(--tplane-chat-surface-alt);
      color: var(--tplane-chat-text-muted);
    }
    `,
  ],
  template: `
    <button
      class="debug-checkpoint-card"
      [class.debug-checkpoint-card--selected]="isSelected()"
      (click)="selected.emit()"
    >
      <p class="debug-checkpoint-card__title">{{ checkpoint().node ?? 'Unknown' }}</p>
      <div class="debug-checkpoint-card__meta">
        @if (checkpoint().duration !== null && checkpoint().duration !== undefined) {
          <span class="debug-checkpoint-card__badge">{{ checkpoint().duration }}ms</span>
        }
        @if (checkpoint().tokenCount !== null && checkpoint().tokenCount !== undefined) {
          <span class="debug-checkpoint-card__badge">{{ checkpoint().tokenCount }} tok</span>
        }
      </div>
    </button>
  `,
})
export class DebugCheckpointCardComponent {
  readonly checkpoint = input.required<DebugCheckpoint>();
  readonly isSelected = input<boolean>(false);
  readonly selected = output<void>();
}
