// libs/chat/src/lib/primitives/chat-overflow-menu/chat-overflow-menu.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_OVERFLOW_MENU_STYLES } from '../../styles/chat-overflow-menu.styles';

/** An action menu item with an identifier, label, optional tone, and disabled state. */
export interface OverflowMenuItem {
  /** Stable id emitted via (itemSelected). */
  id: string;
  label: string;
  /** 'destructive' renders the label in red. Default 'normal'. */
  tone?: 'normal' | 'destructive';
  /** Disabled items render muted and ignore clicks/keypresses. */
  disabled?: boolean;
}

/** Displays a keyboard-navigable action menu anchored to an element or viewport coordinates. */
@Component({
  selector: 'chat-overflow-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_OVERFLOW_MENU_STYLES],
  template: `
    @if (open()) {
      <button
        type="button"
        class="chat-overflow-menu__scrim"
        aria-label="Close menu"
        (click)="closed.emit()"
      ></button>
      <ul
        class="chat-overflow-menu"
        role="menu"
        tabindex="-1"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        (keydown)="onMenuKeydown($event)"
      >
        @for (item of items(); track item.id) {
          <li
            role="menuitem"
            tabindex="0"
            class="chat-overflow-menu__item"
            [class.chat-overflow-menu__item--destructive]="item.tone === 'destructive'"
            [class.chat-overflow-menu__item--disabled]="item.disabled"
            [attr.aria-disabled]="item.disabled ? 'true' : null"
            [attr.tabindex]="item.disabled ? -1 : 0"
            (click)="onItemClick(item)"
            (keydown.enter)="onItemClick(item)"
            (keydown.space)="onItemClick(item)"
          >
            {{ item.label }}
          </li>
        }
      </ul>
    }
  `,
})
export class ChatOverflowMenuComponent {
  readonly open = input<boolean>(false);
  readonly items = input<OverflowMenuItem[]>([]);
  /** Element the menu anchors against (positions just below its bottom-right corner). */
  readonly anchor = input<HTMLElement | null>(null);
  /** Alternative anchor: explicit viewport coordinates (e.g. cursor position
   *  from a right-click). Takes precedence over `anchor` when set. */
  readonly anchorPos = input<{ x: number; y: number } | null>(null);
  readonly itemSelected = output<string>();
  readonly closed = output<void>();

  protected readonly position = computed<{ top: number; left: number }>(() => {
    if (!this.open()) return { top: 0, left: 0 };
    const pos = this.anchorPos();
    if (pos) {
      return { top: pos.y + 4, left: Math.max(pos.x, 8) };
    }
    const el = this.anchor();
    if (!el) {
      const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
      const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
      return { top: Math.max(vh / 3, 0), left: Math.max(vw / 2 - 80, 0) };
    }
    const rect = el.getBoundingClientRect();
    return { top: rect.bottom + 4, left: Math.max(rect.right - 160, 8) };
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      queueMicrotask(() => {
        const root = document.querySelector('.chat-overflow-menu');
        const first = root?.querySelector<HTMLElement>('.chat-overflow-menu__item:not(.chat-overflow-menu__item--disabled)');
        first?.focus();
      });
    });
  }

  protected onItemClick(item: OverflowMenuItem): void {
    if (item.disabled) return;
    this.itemSelected.emit(item.id);
    this.closed.emit();
  }

  protected onMenuKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closed.emit();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const root = (e.currentTarget as HTMLElement);
      const items = Array.from(root.querySelectorAll<HTMLElement>('.chat-overflow-menu__item:not(.chat-overflow-menu__item--disabled)'));
      if (items.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = current ? items.indexOf(current) : -1;
      const next = e.key === 'ArrowDown'
        ? Math.min((idx < 0 ? 0 : idx + 1), items.length - 1)
        : Math.max(idx - 1, 0);
      items[next]?.focus();
    }
  }
}
