// libs/chat/src/lib/primitives/chat-select/chat-select.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  DOCUMENT,
} from '@angular/core';
import { ChatConnectedOverlayDirective, ChatOverlayOriginDirective } from '../overlay/connected-overlay.directive';
import type { ConnectedPosition } from '../overlay/connected-position';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_SELECT_STYLES } from '../../styles/chat-select.styles';

/** A selectable dropdown value and label with an optional description and disabled state. */
export interface ChatSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

// Unique listbox id per instance, for aria-controls (multiple selects per page).
let nextChatSelectId = 0;

/**
 * Generic single-select dropdown. The menu renders through the chat
 * connected-overlay primitive (a body-level portal), so it is never clipped by
 * an ancestor's `overflow` and never trapped by an ancestor `transform`.
 *
 * Inputs: options (required), value (two-way), placeholder, disabled, menuLabel,
 * panelClass (extra class(es) on the overlay pane — the menu is portaled, so
 * `::ng-deep chat-select .chat-select__menu` no longer reaches it).
 */
@Component({
  selector: 'chat-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatConnectedOverlayDirective, ChatOverlayOriginDirective],
  styles: [CHAT_HOST_TOKENS, CHAT_SELECT_STYLES],
  template: `
    <button
      type="button"
      class="chat-select__trigger"
      chatOverlayOrigin
      #origin="chatOverlayOrigin"
      [class.is-open]="open()"
      [disabled]="disabled()"
      [attr.aria-haspopup]="'listbox'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? menuId : null"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
    >
      <span class="chat-select__label">{{ currentLabel() }}</span>
      <svg class="chat-select__chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <ng-template
      chatConnectedOverlay
      [chatOverlayOrigin]="origin"
      [chatOverlayOpen]="open()"
      [chatOverlayPositions]="overlayPositions"
      [chatOverlayPanelClass]="panelClasses()"
      (chatOverlayAttached)="onAttached($event)"
      (chatOverlayOutsideClick)="open.set(false)"
      (chatOverlayDetach)="open.set(false)"
    >
      <div
        class="chat-select__menu"
        role="listbox"
        tabindex="-1"
        [id]="menuId"
        [attr.aria-label]="menuLabel() ?? placeholder()"
        (keydown)="onMenuKeydown($event)"
      >
        @for (opt of options(); track opt.value) {
          <button
            type="button"
            class="chat-select__option"
            [class.is-active]="opt.value === value()"
            [disabled]="opt.disabled === true"
            role="option"
            [attr.aria-selected]="opt.value === value()"
            (click)="selectOption(opt)"
          >
            <span class="chat-select__option-label">{{ opt.label }}</span>
            @if (opt.description) {
              <span class="chat-select__option-desc">{{ opt.description }}</span>
            }
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class ChatSelectComponent {
  readonly options = input.required<readonly ChatSelectOption[]>();
  readonly value = model<string>('');
  readonly placeholder = input<string>('Select');
  readonly disabled = input<boolean>(false);
  readonly menuLabel = input<string | undefined>(undefined);
  readonly panelClass = input<string | string[]>('');

  protected readonly open = signal(false);
  protected readonly menuId = `chat-select-menu-${nextChatSelectId++}`;

  // Above-right preferred (input pill sits at the bottom), then below, then the
  // left-aligned variants. The positioner flips/clamps to keep it in view.
  protected readonly overlayPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  ];

  protected readonly panelClasses = computed<string[]>(() => {
    const extra = this.panelClass();
    const list = Array.isArray(extra) ? extra : extra ? [extra] : [];
    return ['chat-select__overlay', ...list];
  });

  protected readonly currentLabel = computed(() => {
    const v = this.value();
    return this.options().find((o) => o.value === v)?.label ?? this.placeholder();
  });

  private readonly hostEl = inject(ElementRef).nativeElement as HTMLElement;
  private readonly document = inject(DOCUMENT);
  // The overlay primitive emits the pane element on attach; options live there
  // (portaled out of the host), so option queries go through it.
  private menuPane: HTMLElement | null = null;

  protected onAttached(pane: HTMLElement): void {
    this.menuPane = pane;
    this.focusOption(0);
  }

  protected toggle(): void {
    if (this.disabled()) return;
    this.open.update((v) => !v);
  }

  protected selectOption(opt: ChatSelectOption): void {
    if (opt.disabled) return;
    this.value.set(opt.value);
    this.open.set(false);
  }

  protected onTriggerKeydown(e: KeyboardEvent): void {
    if (this.disabled()) return;
    if (e.key === 'Escape' && this.open()) {
      e.preventDefault();
      this.open.set(false);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.open.set(true);
      // focus happens in onAttached once the pane is live
    }
  }

  protected onMenuKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.open.set(false);
      this.queryTrigger()?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const t = e.target as HTMLElement;
      if (t.classList.contains('chat-select__option')) {
        e.preventDefault();
        (t as HTMLButtonElement).click();
      }
    }
  }

  private focusOption(index: number): void {
    this.queryOptions()[index]?.focus();
  }

  private moveFocus(dir: 1 | -1): void {
    const opts = this.queryOptions().filter((b) => !b.disabled);
    if (!opts.length) return;
    const active = this.document.activeElement as HTMLElement | null;
    const idx = active ? opts.indexOf(active as HTMLButtonElement) : -1;
    opts[(idx + dir + opts.length) % opts.length]?.focus();
  }

  private queryOptions(): HTMLButtonElement[] {
    const root = this.menuPane;
    return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('.chat-select__option')) : [];
  }

  private queryTrigger(): HTMLButtonElement | null {
    return this.hostEl.querySelector<HTMLButtonElement>('.chat-select__trigger');
  }
}
