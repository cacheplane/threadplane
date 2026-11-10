'use client';
import { useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from './internal/use-anchored-menu.js';

/** Menu option identified on selection, with a display label, optional disabled state, and visual tone. */
export interface OverflowMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly tone?: 'normal' | 'destructive';
}
/** Controls menu visibility, item selection, optional pointer anchoring, and focus restoration. */
export interface OverflowMenuProps {
  readonly items: readonly OverflowMenuItem[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (
    itemId: string,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  readonly label: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly anchorPoint?: { readonly x: number; readonly y: number } | null;
  readonly returnFocusTo?: HTMLElement | null;
}

/** A controlled command menu. The owner supplies commands and owns async work. */
export function OverflowMenu({
  items,
  open,
  onOpenChange,
  onSelect,
  label,
  className,
  disabled,
  anchorPoint,
  returnFocusTo,
}: OverflowMenuProps) {
  const selection = useRef(onSelect);
  selection.current = onSelect;
  const {
    id,
    trigger,
    menu,
    portal,
    placement,
    effective,
    close,
    ...handlers
  } = useAnchoredMenu({
    open,
    onOpenChange,
    disabled,
    items,
    anchorPoint,
    returnFocusTo,
  });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={['tp-overflow-menu__trigger', className]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        title={label}
        disabled={disabled === true}
        aria-haspopup="menu"
        aria-expanded={effective}
        aria-controls={effective ? `${id}-menu` : undefined}
        id={`${id}-trigger`}
        {...handlers.triggerProps}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {effective &&
        portal &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-labelledby={`${id}-trigger`}
            tabIndex={-1}
            dir={portal.style.direction === 'rtl' ? 'rtl' : 'ltr'}
            className="tp-overflow-menu"
            style={{ ...portal.style, ...placement }}
            {...handlers.menuProps}
          >
            <ul role="presentation">
              {items.map((item) => (
                <li key={item.id} role="presentation">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    data-item-id={item.id}
                    disabled={item.disabled === true}
                    className={
                      item.tone === 'destructive'
                        ? 'tp-overflow-menu__item tp-overflow-menu__item--destructive'
                        : 'tp-overflow-menu__item'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (event.defaultPrevented || item.disabled === true)
                        return;
                      close(true);
                      selection.current(item.id, event);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          portal.document.body
        )}
    </>
  );
}
