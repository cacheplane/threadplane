'use client';
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

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

const tokens = [
  '--tp-chat-text',
  '--tp-chat-muted',
  '--tp-chat-border',
  '--tp-chat-surface',
  '--tp-chat-accent',
  '--tp-chat-on-accent',
  '--tp-chat-danger',
  '--ds-text-primary',
  '--ds-text-secondary',
  '--ds-border',
  '--ds-surface',
  '--ds-accent',
];
function ancestors(anchor: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let node: HTMLElement | null = anchor; node; node = node.parentElement)
    result.push(node);
  return result;
}
function available(anchor: HTMLElement): boolean {
  if (
    !anchor.isConnected ||
    anchor.matches(':disabled') ||
    !anchor.getClientRects().length
  )
    return false;
  const win = anchor.ownerDocument.defaultView;
  return (
    !!win &&
    ancestors(anchor).every((node) => {
      const style = win.getComputedStyle(node);
      return (
        !node.hidden &&
        !node.hasAttribute('inert') &&
        style.display !== 'none' &&
        !['hidden', 'collapse'].includes(style.visibility)
      );
    })
  );
}
function snapshot(anchor: HTMLElement): CSSProperties {
  const win = anchor.ownerDocument.defaultView;
  if (!win) return {};
  const chain = ancestors(anchor).map((node) => win.getComputedStyle(node));
  const resolved = (name: string) =>
    chain
      .map((style) => style.getPropertyValue(name))
      .find((value) => value.trim()) ?? '';
  const result: Record<string, string> = {};
  for (const token of tokens) result[token] = resolved(token);
  for (const name of [
    'direction',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color-scheme',
  ])
    result[name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] =
      resolved(name);
  if (!result['direction'])
    result['direction'] = anchor.closest('[dir]')?.getAttribute('dir') ?? 'ltr';
  return result;
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
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onOpenChange, onSelect });
  callbacks.current = { onOpenChange, onSelect };
  const [portal, setPortal] = useState<{
    document: Document;
    style: CSSProperties;
  } | null>(null);
  const [placement, setPlacement] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  const focusedPortal = useRef<typeof portal>(null);
  const suppressed = useRef(false);
  const restore = useRef(false);
  const context = useRef({ anchorPoint, returnFocusTo });
  context.current = { anchorPoint, returnFocusTo };
  const restoreTarget = useRef<HTMLElement | null | undefined>(null);
  const returningFocus = useRef(false);
  const focusInvoker = (target = context.current.returnFocusTo) => {
    const anchor = trigger.current;
    if (!anchor) return;
    returningFocus.current = true;
    try {
      if (
        target &&
        target.ownerDocument === anchor.ownerDocument &&
        available(target)
      ) {
        try {
          target.focus();
        } catch {
          /* Fall back when an invoker refuses focus. */
        }
        if (anchor.ownerDocument.activeElement === target) return;
      }
      if (available(anchor)) anchor.focus();
    } finally {
      returningFocus.current = false;
    }
  };
  const initial = useRef<'first' | 'last'>('first');
  const [openingRequest, setOpeningRequest] = useState(0);
  const focused = useRef<string | null>(null);
  const ownedFocus = useRef(false);
  const enabled = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)'
      ) ?? []
    );
  const focusEdge = (edge: 'first' | 'last') => {
    const buttons = enabled();
    (
      buttons[edge === 'first' ? 0 : buttons.length - 1] ?? menu.current
    )?.focus();
  };
  const close = (returnFocus = false) => {
    restore.current = returnFocus;
    if (returnFocus) restoreTarget.current = context.current.returnFocusTo;
    callbacks.current.onOpenChange(false);
  };
  const measure = () => {
    const anchor = trigger.current;
    const panel = menu.current;
    const win = portal?.document.defaultView;
    if (!anchor || !panel || !win) return;
    const rect = anchor.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const width = Math.min(box.width, Math.max(0, win.innerWidth - 16));
    const height = Math.min(box.height, Math.max(0, win.innerHeight - 16));
    const point = context.current.anchorPoint;
    const usePoint =
      point && Number.isFinite(point.x) && Number.isFinite(point.y);
    const aligned = usePoint
      ? point.x - (portal.style.direction === 'rtl' ? width : 0)
      : portal.style.direction === 'rtl'
      ? rect.left
      : rect.right - width;
    const below = (usePoint ? point.y : rect.bottom) + 4;
    const preferred =
      below + height > win.innerHeight - 8
        ? (usePoint ? point.y : rect.top) - height - 4
        : below;
    const left = Math.max(8, Math.min(aligned, win.innerWidth - width - 8));
    const top = Math.max(8, Math.min(preferred, win.innerHeight - height - 8));
    setPlacement((previous) =>
      previous.visibility !== 'hidden' &&
      previous.left === left &&
      previous.top === top
        ? previous
        : { left, top }
    );
  };

  useIsomorphicLayoutEffect(() => {
    const anchor = trigger.current;
    if (!open) {
      if (restore.current && anchor) {
        const active = anchor.ownerDocument.activeElement;
        if (
          active === anchor.ownerDocument.body ||
          (active && menu.current?.contains(active))
        )
          focusInvoker(restoreTarget.current);
      }
      restoreTarget.current = null;
      restore.current = false;
      suppressed.current = false;
      ownedFocus.current = false;
      focused.current = null;
      focusedPortal.current = null;
      initial.current = 'first';
      setPortal(null);
      return;
    }
    if (!anchor || suppressed.current) return;
    if (!available(anchor)) {
      suppressed.current = true;
      setPortal(null);
      callbacks.current.onOpenChange(false);
      return;
    }
    setPlacement({ visibility: 'hidden' });
    setPortal({ document: anchor.ownerDocument, style: snapshot(anchor) });
  }, [open, disabled, openingRequest]);

  useIsomorphicLayoutEffect(() => {
    measure();
    // Item updates can change the portal dimensions without a new open cycle.
  }, [portal, items, anchorPoint?.x, anchorPoint?.y]);

  useIsomorphicLayoutEffect(() => {
    if (!portal || !menu.current || !trigger.current) return;
    const anchor = trigger.current;
    const panel = menu.current;
    const doc = portal.document;
    const win = doc.defaultView;
    if (!win) return;
    const chain = ancestors(anchor);
    // Scroll events can arrive after the motion that preceded this opening.
    // Snapshot once, before menu focus, so only later ancestor motion dismisses.
    const openingScroll = new Map<Element, { top: number; left: number }>(
      chain.map((node) => [
        node,
        { top: node.scrollTop, left: node.scrollLeft },
      ])
    );
    const inside = (target: EventTarget | null) =>
      target instanceof win.Node &&
      (panel.contains(target) || anchor.contains(target));
    const outside = (event: Event) => {
      if (
        !returningFocus.current &&
        !event.defaultPrevented &&
        !inside(event.target)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof win.Node && panel.contains(event.target))
      )
        return;
      const target =
        event.target === doc ? doc.scrollingElement : event.target;
      if (target instanceof win.Element) {
        const original = openingScroll.get(target);
        if (
          original &&
          target.scrollTop === original.top &&
          target.scrollLeft === original.left
        )
          return;
      }
      close();
    };
    const suppress = () => {
      if (!suppressed.current) {
        suppressed.current = true;
        restore.current = false;
        setPortal(null);
        callbacks.current.onOpenChange(false);
      }
    };
    const check = () => {
      if (!available(anchor)) suppress();
      else measure();
    };
    const observer = new win.MutationObserver((records) => {
      if (!available(anchor)) suppress();
      else {
        const presentation = snapshot(anchor);
        const presentationChanged = Object.entries(portal.style).some(
          ([name, value]) => Reflect.get(presentation, name) !== value
        );
        const themeAttributeChanged = records.some(
          (record) =>
            record.type === 'attributes' &&
            (record.attributeName === 'dir' ||
              record.attributeName === 'data-theme') &&
            record.oldValue !==
              (record.target as Element).getAttribute(record.attributeName)
        );
        if (presentationChanged || themeAttributeChanged) close();
        else measure();
      }
    });
    for (const node of chain)
      observer.observe(node, {
        attributes: true,
        attributeOldValue: true,
        childList: true,
      });
    const layout =
      typeof win.ResizeObserver === 'function'
        ? new win.ResizeObserver(check)
        : null;
    for (const node of chain) layout?.observe(node);
    layout?.observe(panel);
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('focusin', outside);
    doc.addEventListener('scroll', scroll, true);
    const resize = () => {
      check();
      close();
    };
    win.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      layout?.disconnect();
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('focusin', outside);
      doc.removeEventListener('scroll', scroll, true);
      win.removeEventListener('resize', resize);
    };
    // Opening is the focus boundary; callback/item rerenders must preserve focus.
  }, [portal]);

  useIsomorphicLayoutEffect(() => {
    if (
      !portal ||
      placement.visibility === 'hidden' ||
      focusedPortal.current === portal
    )
      return;
    focusedPortal.current = portal;
    focusEdge(initial.current);
    initial.current = 'first';
    // Placement must be visible in the committed DOM before browser focus.
  }, [portal, placement]);

  useIsomorphicLayoutEffect(() => {
    if (!portal || !ownedFocus.current || !menu.current) return;
    const doc = portal.document;
    const active = doc.activeElement;
    if (
      active !== doc.body &&
      active !== menu.current &&
      !menu.current.contains(active)
    )
      return;
    const survivor = enabled().find(
      (button) => button.dataset['itemId'] === focused.current
    );
    if (!survivor) focusEdge('first');
  }, [items, portal]);

  const effective = open && portal !== null && !suppressed.current;
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
        onClick={(event) => {
          event.stopPropagation();
          if (!event.defaultPrevented) {
            initial.current = 'first';
            restore.current = true;
            callbacks.current.onOpenChange(!open);
          }
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            initial.current = event.key === 'ArrowUp' ? 'last' : 'first';
            if (effective) focusEdge(initial.current);
            else {
              // A render also settles refused requests, so their focus intent
              // cannot leak into a later ordinary or external opening.
              setOpeningRequest((request) => request + 1);
              callbacks.current.onOpenChange(true);
            }
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {effective &&
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
            onFocus={(event) => {
              ownedFocus.current = true;
              focused.current =
                (event.target as HTMLElement).dataset['itemId'] ?? null;
              for (const button of enabled())
                button.tabIndex =
                  button === (event.target as HTMLElement) ? 0 : -1;
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') {
                focusInvoker();
                close();
              } else if (
                ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                const buttons = enabled();
                const index = buttons.indexOf(
                  portal.document.activeElement as HTMLButtonElement
                );
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                    ? buttons.length - 1
                    : (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
                (buttons[next] ?? menu.current)?.focus();
              }
            }}
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
                      callbacks.current.onSelect(item.id, event);
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
