'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

const MENU_ITEM_SELECTOR = '[role="menuitemradio"]';
const MENU_VIEWPORT_GUTTER = 16;

/** Shared focus, dismissal and viewport placement for docs navigation pickers. */
export function useDocsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<'selected' | 'first' | 'last'>('selected');
  const typeaheadRef = useRef({ text: '', time: 0 });
  const menuId = useId();

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  const focusItem = useCallback((item?: HTMLElement) => {
    const menu = menuRef.current;
    if (!item || !menu) return;
    item.focus({ preventScroll: true });
    const itemRect = item.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (itemRect.top < menuRect.top + 8)
      menu.scrollTop -= menuRect.top + 8 - itemRect.top;
    else if (itemRect.bottom > menuRect.bottom - 8)
      menu.scrollTop += itemRect.bottom - menuRect.bottom + 8;
  }, []);

  // Size and position before focusing so opening never scrolls the whole pane.
  useLayoutEffect(() => {
    if (!open) return;
    const resize = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      let top = 0;
      let bottom = window.innerHeight;
      for (
        let parent = trigger.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        ) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
      }
      const gap =
        parseFloat(
          getComputedStyle(menu).getPropertyValue('--docs-menu-gap')
        ) || 4;
      const rect = trigger.getBoundingClientRect();
      // Anchor to the trigger, not the wrapper: the Library wrapper also
      // contains its label, so 100% would put an upward menu under the header.
      const anchor = (
        menu.offsetParent ?? ref.current
      )?.getBoundingClientRect();
      if (!anchor) return;
      const below = bottom - rect.bottom - gap - MENU_VIEWPORT_GUTTER;
      const above = rect.top - top - gap - MENU_VIEWPORT_GUTTER;
      const up = below < Math.min(menu.scrollHeight, 320) && above > below;
      menu.dataset.side = up ? 'top' : 'bottom';
      menu.style.top = up ? 'auto' : `${rect.bottom - anchor.top + gap}px`;
      menu.style.bottom = up ? `${anchor.bottom - rect.top + gap}px` : 'auto';
      menu.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
    };
    resize();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []
    );
    const item =
      initialFocusRef.current === 'last'
        ? items.at(-1)
        : initialFocusRef.current === 'selected'
        ? items.find((item) => item.getAttribute('aria-checked') === 'true') ??
          items[0]
        : items[0];
    focusItem(item);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
    };
  }, [open, focusItem]);

  const openMenu = (initialIndex: 'selected' | 'first' | 'last') => {
    initialFocusRef.current = initialIndex;
    typeaheadRef.current = { text: '', time: 0 };
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []
    );
    const current = Math.max(
      0,
      items.indexOf(document.activeElement as HTMLElement)
    );
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : event.key === 'ArrowUp'
        ? (current - 1 + items.length) % items.length
        : -1;
    if (nextIndex >= 0) {
      event.preventDefault();
      focusItem(items[nextIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      // Let the browser advance from the trigger, not a removed menu item.
      closeMenu(true);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key !== ' '
    ) {
      event.preventDefault();
      const now = Date.now();
      const previous =
        now - typeaheadRef.current.time < 700 ? typeaheadRef.current.text : '';
      const text = previous + event.key.toLowerCase();
      typeaheadRef.current = { text, time: now };
      const query = new Set(text).size === 1 ? text[0] : text;
      const start = query.length === 1 ? current + 1 : current;
      const match = items
        .map((_, offset) => items[(start + offset) % items.length])
        .find((item) =>
          item
            .querySelector('[data-docs-menu-title]')
            ?.textContent?.trim()
            .toLowerCase()
            .startsWith(query)
        );
      focusItem(match);
    }
  };

  return {
    open,
    setOpen,
    ref,
    triggerRef,
    menuRef,
    menuId,
    openMenu,
    closeMenu,
    onMenuKeyDown,
  };
}
