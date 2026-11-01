// libs/chat/src/lib/compositions/chat-timeline-slider/chat-timeline-slider.component.ts
import {
  Component, computed, input, output, signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { AgentWithHistory, AgentCheckpoint } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';

/** Lists agent checkpoints and emits replay or fork requests for their identifiers. */
@Component({
  selector: 'chat-timeline-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, `
    :host { display: block; padding: var(--tplane-chat-space-2); }
    .timeline-slider__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--tplane-chat-space-1) var(--tplane-chat-space-2);
    }
    .timeline-slider__title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tplane-chat-text-muted);
      margin: 0;
    }
    .timeline-slider__count {
      font-size: var(--tplane-chat-font-size-xs);
      color: var(--tplane-chat-text-muted);
    }
    .timeline-slider__empty {
      text-align: center;
      padding: var(--tplane-chat-space-4);
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
    }
    .timeline-slider__list {
      list-style: none;
      padding-left: 12px;
      margin: 0;
      border-left: 1px solid var(--tplane-chat-separator);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .timeline-slider__entry {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-left: -1px;
      border-left: 2px solid transparent;
      border-radius: var(--tplane-chat-radius-button);
      cursor: default;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-sm);
      transition: background 150ms ease;
    }
    .timeline-slider__entry:hover { background: color-mix(in srgb, var(--tplane-chat-text) 5%, transparent); }
    .timeline-slider__entry[data-active="true"] {
      border-left-color: var(--tplane-chat-primary);
      color: var(--tplane-chat-text);
    }
    .timeline-slider__index {
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      background: var(--tplane-chat-surface-alt);
      color: var(--tplane-chat-text-muted);
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .timeline-slider__entry[data-active="true"] .timeline-slider__index {
      background: var(--tplane-chat-primary);
      color: var(--tplane-chat-on-primary);
    }
    .timeline-slider__body { flex: 1; min-width: 0; }
    .timeline-slider__label {
      font-weight: 500;
      color: var(--tplane-chat-text);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--tplane-chat-font-size-sm);
    }
    .timeline-slider__id {
      font-family: var(--tplane-chat-font-mono);
      font-size: 11px;
      color: var(--tplane-chat-text-muted);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .timeline-slider__actions { display: flex; gap: 4px; flex-shrink: 0; }
    .timeline-slider__btn {
      padding: 2px 8px;
      font-size: var(--tplane-chat-font-size-xs);
      border-radius: var(--tplane-chat-radius-button);
      background: var(--tplane-chat-surface-alt);
      color: var(--tplane-chat-text);
      border: 0;
      cursor: pointer;
      transition: background 150ms ease;
    }
    .timeline-slider__btn:hover { background: color-mix(in srgb, var(--tplane-chat-text) 8%, transparent); }
  `],
  template: `
    <div class="timeline-slider__header">
      <h3 class="timeline-slider__title">Timeline</h3>
      <span class="timeline-slider__count">{{ history().length }} checkpoint(s)</span>
    </div>

    @if (history().length === 0) {
      <p class="timeline-slider__empty">No checkpoints yet.</p>
    } @else {
      <ul class="timeline-slider__list">
        @for (cp of history(); track $index; let i = $index) {
          <li
            class="timeline-slider__entry"
            [attr.data-active]="i === selectedIndex() ? 'true' : null"
          >
            <span class="timeline-slider__index">{{ i + 1 }}</span>
            <div class="timeline-slider__body">
              <p class="timeline-slider__label">{{ cp.label ?? 'Step ' + (i + 1) }}</p>
              @if (cp.id) {
                <p class="timeline-slider__id">{{ cp.id }}</p>
              }
            </div>
            <div class="timeline-slider__actions">
              <button type="button" class="timeline-slider__btn" title="Replay from this checkpoint" (click)="replay(cp)">Replay</button>
              <button type="button" class="timeline-slider__btn" title="Fork from this checkpoint" (click)="fork(cp, i)">Fork</button>
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class ChatTimelineSliderComponent {
  readonly agent = input.required<AgentWithHistory>();

  readonly selectedIndex = signal<number>(-1);

  readonly history = computed<AgentCheckpoint[]>(() => this.agent().history());

  readonly replayRequested = output<string>();
  readonly forkRequested = output<string>();

  replay(cp: AgentCheckpoint): void {
    if (cp.id) this.replayRequested.emit(cp.id);
  }

  fork(cp: AgentCheckpoint, index: number): void {
    this.selectedIndex.set(index);
    if (cp.id) this.forkRequested.emit(cp.id);
  }
}
