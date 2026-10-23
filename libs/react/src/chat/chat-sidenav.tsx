'use client';
import { useId, useRef, type ReactNode } from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

export type ChatSidenavMode = 'expanded' | 'collapsed' | 'drawer';

export interface ChatSidenavProps {
  readonly mode: ChatSidenavMode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onModeChange: (mode: Exclude<ChatSidenavMode, 'drawer'>) => void;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly label?: string;
  readonly launcherLabel?: string;
  readonly closeLabel?: string;
  readonly expandLabel?: string;
  readonly collapseLabel?: string;
}

/** Controlled navigation presentation; children remain mounted in every mode. */
export function ChatSidenav({
  mode,
  open,
  onOpenChange,
  onModeChange,
  children,
  className,
  label = 'Conversations',
  launcherLabel = 'Open conversations',
  closeLabel = 'Close conversations',
  expandLabel = 'Expand conversations',
  collapseLabel = 'Collapse conversations',
}: ChatSidenavProps) {
  const id = useId();
  const navId = `${id}-nav`;
  const bodyId = `${id}-body`;
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const ownedFocus = useRef<Element | null>(null);
  const previous = useRef<{ mode: ChatSidenavMode; open: boolean } | null>(
    null
  );
  const drawer = mode === 'drawer';
  const closedDrawer = drawer && !open;
  const collapsed = mode === 'collapsed';

  useIsomorphicLayoutEffect(() => {
    const prior = previous.current;
    previous.current = { mode, open };
    if (prior?.mode === mode && prior.open === open) return;
    if (drawer && open && (!prior || prior.mode !== 'drawer' || !prior.open)) {
      close.current?.focus();
      return;
    }
    if (!prior) return;
    const document = root.current?.ownerDocument;
    const active = document?.activeElement;
    // Browsers can blur a newly hidden element before layout effects run.
    // Remember local ownership, but never override an external focused control.
    const focused = active === document?.body ? ownedFocus.current : active;
    if (!focused || !root.current?.contains(focused)) return;
    const disappeared =
      (focused === launcher.current && !closedDrawer) ||
      (focused === close.current && !(drawer && open)) ||
      (focused === toggle.current && drawer) ||
      (body.current?.contains(focused) && (collapsed || closedDrawer));
    if (disappeared) {
      (closedDrawer ? launcher.current : toggle.current)?.focus();
    }
  }, [mode, open, drawer, closedDrawer, collapsed]);

  return (
    <div
      ref={root}
      className={[
        'tp-chat',
        'tp-chat-sidenav',
        `tp-chat-sidenav--${mode}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onFocusCapture={(event) => {
        ownedFocus.current = event.target;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          ownedFocus.current = null;
        }
      }}
    >
      <button
        ref={launcher}
        type="button"
        className="tp-chat-sidenav__launcher"
        aria-label={launcherLabel}
        aria-controls={navId}
        aria-expanded={drawer && open}
        hidden={!closedDrawer}
        onClick={() => onOpenChange(true)}
      >
        {launcherLabel}
      </button>
      <nav
        id={navId}
        aria-label={label}
        className="tp-chat-sidenav__panel"
        hidden={closedDrawer}
        inert={closedDrawer}
        onKeyDown={(event) => {
          if (
            !drawer ||
            !open ||
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
      >
        <div className="tp-chat-sidenav__header">
          <button
            ref={toggle}
            type="button"
            className="tp-chat-sidenav__toggle"
            aria-label={collapsed ? expandLabel : collapseLabel}
            aria-controls={bodyId}
            aria-expanded={!collapsed}
            hidden={drawer}
            onClick={() => onModeChange(collapsed ? 'expanded' : 'collapsed')}
          >
            {collapsed ? expandLabel : collapseLabel}
          </button>
          <button
            ref={close}
            type="button"
            className="tp-chat-sidenav__close"
            aria-label={closeLabel}
            hidden={!drawer || !open}
            onClick={() => onOpenChange(false)}
          >
            {closeLabel}
          </button>
        </div>
        <div
          ref={body}
          id={bodyId}
          className="tp-chat-sidenav__body"
          hidden={collapsed}
          inert={collapsed}
        >
          {children}
        </div>
      </nav>
    </div>
  );
}
