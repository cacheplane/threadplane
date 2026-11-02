// libs/chat/src/lib/primitives/chat-history-search-palette/chat-history-search-palette.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  effect,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_HISTORY_SEARCH_PALETTE_STYLES } from '../../styles/chat-history-search-palette.styles';

/** A conversation search result with an identifier, title, and optional secondary text. */
export interface ThreadMatch {
  id: string;
  title: string;
  /** Optional secondary line, rendered muted under the title. */
  subtitle?: string;
}

let paletteInstanceCounter = 0;

/** Displays a conversation search dialog with a bound query, supplied results, and keyboard selection. */
@Component({
  selector: 'chat-history-search-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_HISTORY_SEARCH_PALETTE_STYLES],
  template: `
    @if (open()) {
      <button
        type="button"
        class="chat-history-search-palette__scrim"
        aria-label="Close search"
        (click)="closed.emit()"
      ></button>
      <div
        class="chat-history-search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search conversations"
      >
        <div class="chat-history-search-palette__input-row">
          <svg class="chat-history-search-palette__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            #inputEl
            class="chat-history-search-palette__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            [attr.aria-controls]="listId"
            [attr.aria-activedescendant]="activeRowId()"
            [placeholder]="placeholder()"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onInputKeydown($event)"
          />
          <button
            type="button"
            class="chat-history-search-palette__close"
            aria-label="Close"
            (click)="closed.emit()"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        @if (loading() && results().length === 0) {
          <div class="chat-history-search-palette__skeleton" aria-hidden="true">
            <div class="chat-history-search-palette__skeleton-row"></div>
            <div class="chat-history-search-palette__skeleton-row"></div>
            <div class="chat-history-search-palette__skeleton-row"></div>
          </div>
        } @else if (results().length === 0 && query().length === 0) {
          <div class="chat-history-search-palette__hint">Type to search your conversations.</div>
        } @else if (results().length === 0) {
          <div class="chat-history-search-palette__empty">No conversations match.</div>
        } @else {
          <ul class="chat-history-search-palette__list" role="listbox" [id]="listId">
            @for (row of results(); let i = $index; track row.id) {
              <li
                class="chat-history-search-palette__row"
                role="option"
                tabindex="-1"
                [id]="rowId(i)"
                [attr.aria-selected]="i === activeIndex() ? 'true' : 'false'"
                (click)="onRowClick(row.id)"
                (keydown.enter)="onRowClick(row.id)"
                (keydown.space)="onRowClick(row.id)"
              >
                <span class="chat-history-search-palette__row-title">{{ row.title }}</span>
                @if (row.subtitle) {
                  <span class="chat-history-search-palette__row-subtitle">{{ row.subtitle }}</span>
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class ChatHistorySearchPaletteComponent {
  readonly open = model<boolean>(false);
  readonly query = model<string>('');
  readonly results = input<ThreadMatch[]>([]);
  readonly loading = input<boolean>(false);
  readonly placeholder = input<string>('Search conversations');

  readonly threadSelected = output<string>();
  readonly closed = output<void>();

  protected readonly activeIndex = signal<number>(0);
  protected readonly listId = `chat-history-search-palette__results-${++paletteInstanceCounter}`;

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    effect(() => {
      if (this.open()) {
        this.activeIndex.set(0);
        queueMicrotask(() => this.inputEl()?.nativeElement.focus());
      }
    });
    effect(() => {
      const max = this.results().length - 1;
      if (max >= 0 && this.activeIndex() > max) {
        this.activeIndex.set(max);
      }
    });
  }

  protected rowId(index: number): string {
    return `${this.listId}__row-${index}`;
  }

  protected activeRowId(): string | null {
    return this.results().length > 0 ? this.rowId(this.activeIndex()) : null;
  }

  protected onInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.query.set(value);
  }

  protected onInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closed.emit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = this.results().length - 1;
      if (max < 0) return;
      this.activeIndex.set(Math.min(this.activeIndex() + 1, max));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const rows = this.results();
      if (rows.length === 0) return;
      const row = rows[this.activeIndex()];
      this.threadSelected.emit(row.id);
      return;
    }
  }

  protected onRowClick(id: string): void {
    this.threadSelected.emit(id);
  }
}
