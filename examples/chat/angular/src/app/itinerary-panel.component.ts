import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DEMO_AGENT } from './shell/shell-tokens';
import { ItineraryStop, ItineraryStore } from './itinerary-store';

@Component({
  selector: 'app-itinerary-panel',
  standalone: true,
  imports: [DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'itin',
    role: 'region',
    'aria-label': 'Trip itinerary',
    '[class.itin--collapsed]': 'collapsed()',
  },
  template: `
    <div class="itin__head">
      <h2 class="itin__title">
        Trip itinerary
        <span class="itin__total">· {{ totalLabel() }}</span>
      </h2>
      <div class="itin__head-actions">
        <button
          type="button"
          class="itin__collapse"
          [attr.aria-expanded]="!collapsed()"
          aria-label="Toggle itinerary details"
          (click)="toggleCollapsed()"
        >{{ collapsed() ? 'expand_more' : 'expand_less' }}</button>
        <button
          type="button"
          class="itin__overflow"
          [attr.aria-expanded]="menuOpen()"
          aria-label="Itinerary actions"
          (click)="toggleMenu()"
        >more_vert</button>
      </div>
      @if (menuOpen()) {
        <div class="itin__menu" role="menu">
          <button type="button" class="itin__menu-item" role="menuitem" (click)="reset()">
            Reset demo data
          </button>
        </div>
      }
    </div>

    <div cdkDropListGroup>
      @for (g of store.days(); track g.day) {
        <section class="itin__day">
          <header class="itin__day-head">
            <h3 class="itin__day-title">Day {{ g.day }}</h3>
            <span class="itin__day-count">{{ g.stops.length }} stop{{ g.stops.length === 1 ? '' : 's' }}</span>
            <button
              type="button"
              class="itin__day-add"
              [class.is-active]="composer() === g.day"
              (click)="openComposer(g.day)"
            >
              <span class="itin__icon" aria-hidden="true">add</span>
              <span>Add stop</span>
            </button>
          </header>
          <ul
            class="itin__stops"
            cdkDropList
            [cdkDropListData]="g.stops"
            [id]="'itin-day-' + g.day"
            (cdkDropListDropped)="onDrop($event, g.day)"
          >
            @for (s of g.stops; track s.id; let i = $index) {
              <li
                class="itin__stop"
                [class.itin__stop--pulse]="store.recentlyChangedId() === s.id || store.focusedStopId() === s.id"
                (click)="onRowClick(s.id, $event)"
                cdkDrag
                [cdkDragData]="s"
              >
                <span class="itin__handle" cdkDragHandle aria-label="Reorder">drag_indicator</span>
                <span class="itin__index">{{ i + 1 }}</span>
                <span class="itin__place">
                  <span class="itin__place-name">{{ s.place }}</span>
                  @if (s.note) { <span class="itin__note">{{ s.note }}</span> }
                </span>
                <button
                  type="button"
                  class="itin__remove"
                  [attr.aria-label]="'Remove ' + s.place"
                  (click)="remove(s.id)"
                >close</button>
              </li>
            }
          </ul>
          @if (composer() === g.day) {
            <form class="itin__composer" (submit)="commitComposer($event, g.day)">
              <input
                class="itin__composer-input"
                type="text"
                placeholder="Add a place"
                [value]="composerText()"
                (input)="composerText.set($any($event.target).value)"
                (blur)="commitComposer($event, g.day)"
                aria-label="Add a place"
                autofocus
              />
            </form>
          }
        </section>
      } @empty {
        <div class="itin__empty" role="status">
          <span class="itin__empty-icon" aria-hidden="true">luggage</span>
          <p class="itin__empty-title">No trip yet</p>
          <p class="itin__empty-sub">Ask the assistant to plan one — try a suggestion in the chat.</p>
          <div class="itin__empty-chips">
            <button
              type="button"
              class="itin__empty-chip"
              (click)="suggestion('Plan a Paris weekend')"
            >Plan a Paris weekend</button>
            <button
              type="button"
              class="itin__empty-chip"
              (click)="suggestion('Add a Day 1 stop')"
            >Add a Day 1 stop</button>
          </div>
        </div>
      }
    </div>

    @if (showFooterAdd()) {
      <button type="button" class="itin__add-day-btn" (click)="addNewDay()">
        <span class="itin__icon" aria-hidden="true">add</span>
        <span>Add a day</span>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 16px;
        font-size: var(--tplane-chat-font-size-sm);
        color: var(--tplane-chat-text);
        font-family: var(--tplane-chat-font-family);
        position: relative;
      }
      .itin__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 16px;
        position: relative;
      }
      .itin__title {
        margin: 0;
        font-size: 1rem;
        color: var(--tplane-chat-text);
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .itin__total {
        font-size: 0.8rem;
        color: var(--tplane-chat-text-muted);
        font-weight: normal;
      }
      .itin__overflow {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 18px;
        background: transparent;
        border: none;
        color: var(--tplane-chat-text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--tplane-chat-radius-card);
        line-height: 1;
      }
      .itin__overflow:hover {
        background: var(--tplane-chat-surface-alt);
        color: var(--tplane-chat-text);
      }
      .itin__menu {
        position: absolute;
        top: 100%;
        right: 0;
        background: var(--tplane-chat-bg);
        border: 1px solid var(--tplane-chat-separator);
        border-radius: var(--tplane-chat-radius-card);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        z-index: 10;
        min-width: 160px;
      }
      .itin__menu-item {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: var(--tplane-chat-text);
        padding: 8px 12px;
        cursor: pointer;
        font: inherit;
      }
      .itin__menu-item:hover {
        background: var(--tplane-chat-surface-alt);
      }
      .itin__day {
        margin-bottom: 14px;
      }
      .itin__day-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .itin__day-title {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--tplane-chat-text);
      }
      .itin__day-count {
        font-size: 0.75rem;
        color: var(--tplane-chat-text-muted);
      }
      .itin__day-add {
        font-family: inherit;
        font-size: 0.75rem;
        background: transparent;
        border: 1px dashed var(--tplane-chat-separator);
        color: var(--tplane-chat-text-muted);
        border-radius: var(--tplane-chat-radius-card);
        padding: 2px 8px;
        cursor: pointer;
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .itin__day-add:hover, .itin__day-add.is-active {
        color: var(--tplane-chat-text);
        border-color: var(--tplane-chat-text);
      }
      .itin__icon {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 16px;
        line-height: 1;
        vertical-align: -3px;
      }
      .itin__stops {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .itin__stop {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border: 1px solid var(--tplane-chat-separator);
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-bg);
        transition: box-shadow 200ms ease, transform 200ms ease;
      }
      .itin__handle {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 16px;
        color: var(--tplane-chat-text-muted);
        cursor: grab;
        opacity: 0;
        transition: opacity 100ms ease;
        line-height: 1;
        flex: none;
      }
      .itin__stop:hover .itin__handle { opacity: 1; }
      .itin__index {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: var(--tplane-chat-text);
        color: var(--tplane-chat-bg);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7rem;
        font-weight: 600;
      }
      .itin__place {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .itin__place-name {
        color: var(--tplane-chat-text);
        font-weight: 500;
      }
      .itin__note {
        color: var(--tplane-chat-text-muted);
        font-size: 0.8rem;
      }
      .itin__remove {
        flex: none;
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 16px;
        background: transparent;
        border: none;
        color: var(--tplane-chat-text-muted);
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        opacity: 0;
        transition: opacity 100ms ease;
        border-radius: 4px;
      }
      .itin__stop:hover .itin__remove { opacity: 0.7; }
      .itin__remove:hover { opacity: 1 !important; color: var(--tplane-chat-text); }
      .itin__composer {
        margin-top: 6px;
      }
      .itin__composer-input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--tplane-chat-text);
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-bg);
        color: var(--tplane-chat-text);
        font-family: inherit;
        font-size: inherit;
        box-sizing: border-box;
      }
      .itin__add-day-btn {
        margin-top: 12px;
        font-family: inherit;
        font-size: 0.8rem;
        background: transparent;
        border: 1px dashed var(--tplane-chat-separator);
        color: var(--tplane-chat-text-muted);
        border-radius: var(--tplane-chat-radius-card);
        padding: 6px 12px;
        cursor: pointer;
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .itin__add-day-btn:hover {
        color: var(--tplane-chat-text);
        border-color: var(--tplane-chat-text);
      }
      .itin__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 8px;
        padding: 24px 8px;
        color: var(--tplane-chat-text-muted);
      }
      .itin__empty-icon {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 48px;
        color: var(--tplane-chat-text-muted);
        line-height: 1;
      }
      .itin__empty-title {
        margin: 0;
        font-size: 0.95rem;
        color: var(--tplane-chat-text);
        font-weight: 500;
      }
      .itin__empty-sub {
        margin: 0;
        font-size: 0.8rem;
      }
      .itin__empty-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: center;
        margin-top: 4px;
      }
      .itin__empty-chip {
        font-family: inherit;
        font-size: 0.8rem;
        background: transparent;
        border: 1px solid var(--tplane-chat-separator);
        color: var(--tplane-chat-text);
        border-radius: 999px;
        padding: 4px 12px;
        cursor: pointer;
      }
      .itin__empty-chip:hover {
        background: var(--tplane-chat-surface-alt);
        border-color: var(--tplane-chat-text);
      }
      .itin__stop.cdk-drag-preview {
        box-shadow:
          0 5px 5px -3px rgba(0, 0, 0, 0.2),
          0 8px 10px 1px rgba(0, 0, 0, 0.14),
          0 3px 14px 2px rgba(0, 0, 0, 0.12);
        background: var(--tplane-chat-bg);
      }
      .itin__stop.cdk-drag-placeholder {
        opacity: 0.3;
      }
      .itin__stops.cdk-drop-list-dragging .itin__stop:not(.cdk-drag-placeholder) {
        transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
      }
      @keyframes itinPulse {
        0%   { box-shadow: 0 0 0 0 var(--tplane-chat-primary); transform: scale(1); }
        20%  { box-shadow: 0 0 0 3px color-mix(in srgb, var(--tplane-chat-primary) 50%, transparent); transform: scale(1.015); }
        100% { box-shadow: 0 0 0 0 transparent; transform: scale(1); }
      }
      .itin__stop--pulse {
        animation: itinPulse 1600ms ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .itin__stop--pulse {
          animation: none;
        }
      }
      .itin__handle.cdk-keyboard-focused,
      .itin__handle:focus-visible {
        opacity: 1;
        outline: 2px solid var(--tplane-chat-text);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .itin__head-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .itin__collapse {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-size: 18px;
        background: transparent;
        border: none;
        color: var(--tplane-chat-text-muted);
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        border-radius: var(--tplane-chat-radius-card);
      }
      .itin__collapse:hover {
        background: var(--tplane-chat-surface-alt);
        color: var(--tplane-chat-text);
      }
      :host(.itin--collapsed) [cdkDropListGroup],
      :host(.itin--collapsed) .itin__add-day-btn {
        display: none;
      }
      :host(.itin--collapsed) .itin__head {
        margin-bottom: 0;
      }
    `,
  ],
})
export class ItineraryPanelComponent {
  protected readonly store = inject(ItineraryStore);
  protected readonly menuOpen = signal(false);
  protected readonly collapsed = signal(false);
  protected readonly composer = signal<number | null>(null);
  protected readonly composerText = signal('');
  protected readonly totalLabel = computed(() => {
    const n = this.store.stops().length;
    return `${n} stop${n === 1 ? '' : 's'}`;
  });
  protected readonly showFooterAdd = computed(() => this.store.days().length > 0);
  /** The shell's agent, so a suggestion carries the shell's model and
   *  itinerary state like any other message sent from the chat. */
  private readonly agent = inject(DEMO_AGENT);

  protected suggestion(prompt: string): void {
    void this.agent.submit({ message: prompt });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  protected reset(): void {
    this.store.reset({ source: 'user' });
    this.menuOpen.set(false);
  }

  protected openComposer(day: number): void {
    this.composer.set(day);
    this.composerText.set('');
  }

  protected commitComposer(event: Event, day: number): void {
    event.preventDefault();
    const text = this.composerText().trim();
    if (text) {
      this.store.add(day, text, undefined, { source: 'user' });
    }
    this.composer.set(null);
    this.composerText.set('');
  }

  protected addNewDay(): void {
    const maxDay = Math.max(0, ...this.store.days().map((g) => g.day));
    this.openComposer(maxDay + 1);
  }

  protected remove(id: string): void {
    this.store.remove(id, { source: 'user' });
  }

  protected onRowClick(id: string, event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('.itin__handle') || target.closest('.itin__remove')) return;
    this.store.focus(id);
  }

  protected onDrop(event: CdkDragDrop<ItineraryStop[]>, toDay: number): void {
    const stop = event.item.data as ItineraryStop;
    this.store.reorder(stop.id, toDay, event.currentIndex, { source: 'user' });
  }
}
