import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  signal,
  HostListener,
} from '@angular/core';
import type { DebugAgentWithHistory } from '../debug-agent';
import { CHAT_DEBUG_TOKENS } from '../chat-debug-tokens';
import { DebugCheckpointCardComponent, type DebugCheckpoint } from '../debug-checkpoint-card.component';
import { DebugStateDiffComponent } from '../debug-state-diff.component';
import { toDebugCheckpoint, extractStateValues } from '../debug-utils';

export type Direction = 'up' | 'down' | 'home' | 'end';

/**
 * Pure selection-step function. Exported for unit testing — the component's
 * keyboard handler delegates to it.
 */
export function stepSelection(dir: Direction, current: number, count: number): number {
  if (count === 0) return -1;
  switch (dir) {
    case 'down': return Math.min(current + 1, count - 1);
    case 'up':   return Math.max(current - 1, 0);
    case 'home': return 0;
    case 'end':  return count - 1;
  }
}

@Component({
  selector: 'chat-debug-timeline-inspector',
  standalone: true,
  imports: [DebugCheckpointCardComponent, DebugStateDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_DEBUG_TOKENS,
    `
    :host { display: flex; flex-direction: column; height: 100%; outline: none; }
    .timeline__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--tplane-chat-debug-border);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tplane-chat-debug-text-subtle);
      background: var(--tplane-chat-debug-bg);
    }
    .timeline__count { display: inline-flex; align-items: center; gap: 6px; }
    .timeline__count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 18px;
      padding: 0 6px;
      border-radius: var(--tplane-chat-radius-card);
      background: var(--tplane-chat-debug-surface);
      border: 1px solid var(--tplane-chat-debug-border);
      color: var(--tplane-chat-debug-text);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      font-variant-numeric: tabular-nums;
    }
    .timeline__clear {
      background: transparent;
      border: 0;
      cursor: pointer;
      color: var(--tplane-chat-debug-text-subtle);
      font: inherit;
      font-size: 11px;
      letter-spacing: 0;
      text-transform: none;
      padding: 2px 6px;
      border-radius: var(--tplane-chat-radius-card);
      transition: color 120ms ease, background 120ms ease;
    }
    .timeline__clear:hover:not(:disabled) {
      color: var(--tplane-chat-debug-text);
      background: var(--tplane-chat-debug-surface);
    }
    .timeline__clear:disabled { opacity: 0.4; cursor: default; }
    .timeline__list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--tplane-chat-debug-bg);
    }
    .timeline__empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--tplane-chat-debug-text-subtle);
      font-size: 13px;
    }
    .timeline__row { display: flex; flex-direction: column; gap: 8px; }
    .timeline__row-actions {
      display: none;
      gap: 8px;
      padding-left: 12px;
    }
    .timeline__row:hover .timeline__row-actions { display: flex; }
    .timeline__row button.row-action {
      background: var(--tplane-chat-debug-bg-deep);
      border: 1px solid var(--tplane-chat-debug-border);
      border-radius: var(--tplane-chat-radius-card);
      padding: 3px 8px;
      font: inherit;
      font-size: 11px;
      color: var(--tplane-chat-debug-text-muted);
      cursor: pointer;
      transition: color 120ms ease, border-color 120ms ease;
    }
    .timeline__row button.row-action:hover {
      color: var(--tplane-chat-debug-text);
      border-color: var(--tplane-chat-debug-border-strong);
    }
    .timeline__diff {
      padding: 12px;
      background: var(--tplane-chat-debug-bg-deep);
      border: 1px solid var(--tplane-chat-debug-border);
      border-radius: var(--tplane-chat-debug-radius-input);
      color: var(--tplane-chat-debug-text);
    }
    `,
  ],
  template: `
    <div class="timeline__header">
      <span class="timeline__count">
        <span class="timeline__count-badge">{{ checkpoints().length }}</span>
        <span>checkpoint{{ checkpoints().length === 1 ? '' : 's' }}</span>
      </span>
      <button
        type="button"
        class="timeline__clear"
        [disabled]="selectedIndex() < 0"
        (click)="selectedIndex.set(-1)"
      >Clear selection</button>
    </div>
    <div
      class="timeline__list"
      tabindex="0"
      role="listbox"
      aria-label="Checkpoint timeline"
    >
      @if (checkpoints().length === 0) {
        <div class="timeline__empty">No checkpoints yet. Send a message to populate the timeline.</div>
      }
      @for (cp of checkpoints(); let i = $index; track cp.checkpointId ?? i) {
        <div class="timeline__row">
          <chat-debug-checkpoint-card
            [checkpoint]="cp"
            [isSelected]="i === selectedIndex()"
            (selected)="selectedIndex.set(i)"
          />
          @if (i === selectedIndex() && cp.checkpointId) {
            <div class="timeline__row-actions">
              <button class="row-action" type="button" (click)="replayRequested.emit(cp.checkpointId!)">Replay</button>
              <button class="row-action" type="button" (click)="forkRequested.emit(cp.checkpointId!)">Fork</button>
            </div>
          }
          @if (i === selectedIndex()) {
            <div class="timeline__diff">
              <chat-debug-state-diff
                [before]="previousStateAt(i)"
                [after]="currentStateAt(i)"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class TimelineInspectorComponent {
  readonly agent = input.required<DebugAgentWithHistory>();
  readonly replayRequested = output<string>();
  readonly forkRequested = output<string>();

  readonly selectedIndex = signal<number>(-1);

  readonly checkpoints = computed((): DebugCheckpoint[] =>
    this.agent().history().map((cp, i) => toDebugCheckpoint(cp, i)),
  );

  currentStateAt(i: number): Record<string, unknown> {
    return extractStateValues(this.agent().history()[i]);
  }

  previousStateAt(i: number): Record<string, unknown> {
    if (i <= 0) return {};
    return extractStateValues(this.agent().history()[i - 1]);
  }

  @HostListener('keydown', ['$event'])
  protected onKey(ev: KeyboardEvent): void {
    const map: Record<string, Direction | undefined> = {
      ArrowDown: 'down',
      ArrowUp: 'up',
      Home: 'home',
      End: 'end',
    };
    const dir = map[ev.key];
    if (!dir) return;
    ev.preventDefault();
    this.selectedIndex.set(stepSelection(dir, this.selectedIndex(), this.checkpoints().length));
  }
}
