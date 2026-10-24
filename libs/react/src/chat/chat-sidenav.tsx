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
  readonly collapsedContent?: ReactNode;
  readonly className?: string;
  readonly label?: string;
  readonly launcherLabel?: string;
  readonly closeLabel?: string;
  readonly expandLabel?: string;
  readonly collapseLabel?: string;
  readonly toggleShortcut?: boolean;
  readonly onSearch?: () => void;
  readonly searchLabel?: string;
  readonly searchShortcut?: boolean;
}

function composedParent(element: Element): Element | null {
  return (
    element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null
  );
}

function shortcutTargetIsEditable(event: KeyboardEvent): boolean {
  let editable: boolean | undefined;
  // The composed path retains shadow form controls that window event retargeting hides.
  for (const target of event.composedPath()) {
    if ((target as Node).nodeType !== 1) continue;
    const element = target as Element;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return true;
    if (editable !== undefined) continue;
    const value = element.getAttribute('contenteditable')?.toLowerCase();
    if (value === 'false') editable = false;
    else if (value === '' || value === 'true' || value === 'plaintext-only')
      editable = true;
  }
  return editable === true;
}

/** Controlled navigation presentation; children remain mounted in every mode. */
export function ChatSidenav({
  mode,
  open,
  onOpenChange,
  onModeChange,
  children,
  collapsedContent,
  className,
  label = 'Conversations',
  launcherLabel = 'Open conversations',
  closeLabel = 'Close conversations',
  expandLabel = 'Expand conversations',
  collapseLabel = 'Collapse conversations',
  toggleShortcut,
  onSearch,
  searchLabel = 'Search conversations',
  searchShortcut,
}: ChatSidenavProps) {
  const id = useId();
  const navId = `${id}-nav`;
  const bodyId = `${id}-body`;
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLButtonElement>(null);
  const ownedFocus = useRef<Element | null>(null);
  const previous = useRef<{ mode: ChatSidenavMode; open: boolean } | null>(
    null
  );
  const drawer = mode === 'drawer';
  const closedDrawer = drawer && !open;
  const collapsed = mode === 'collapsed';
  const shortcutEnabled = toggleShortcut === true;
  const searchShortcutEnabled = searchShortcut === true && !!onSearch;
  const listenerEnabled = shortcutEnabled || searchShortcutEnabled;
  const committed = useRef({
    mode,
    onModeChange,
    onSearch,
    shortcutEnabled,
    searchShortcutEnabled,
  });

  useIsomorphicLayoutEffect(() => {
    committed.current = {
      mode,
      onModeChange,
      onSearch,
      shortcutEnabled,
      searchShortcutEnabled,
    };
  }, [mode, onModeChange, onSearch, shortcutEnabled, searchShortcutEnabled]);

  useIsomorphicLayoutEffect(() => {
    if (!listenerEnabled) return;
    const element = root.current;
    const owner = element?.ownerDocument.defaultView;
    if (!element || !owner) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = committed.current;
      const toggleKey = event.key === 'b' || event.key === 'B';
      const searchKey = event.key === 'k' || event.key === 'K';
      if (
        !(toggleKey && current.shortcutEnabled && current.mode !== 'drawer') &&
        !(searchKey && current.searchShortcutEnabled && current.onSearch)
      )
        return;
      if (
        !element.isConnected ||
        !event.cancelable ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        shortcutTargetIsEditable(event)
      )
        return;
      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = composedParent(ancestor)
      ) {
        if (ancestor.hasAttribute('hidden') || ancestor.hasAttribute('inert'))
          return;
      }
      // Claim before calling controlled owners so later window listeners cannot also win.
      event.preventDefault();
      if (searchKey) current.onSearch?.();
      else
        current.onModeChange(
          current.mode === 'collapsed' ? 'expanded' : 'collapsed'
        );
    };
    owner.addEventListener('keydown', handleKeyDown);
    return () => owner.removeEventListener('keydown', handleKeyDown);
  }, [listenerEnabled]);

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
      (focused === search.current && closedDrawer) ||
      (body.current?.contains(focused) && (collapsed || closedDrawer)) ||
      (compact.current?.contains(focused) && !collapsed);
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
            aria-keyshortcuts={
              shortcutEnabled && !drawer ? 'Control+B Meta+B' : undefined
            }
            title={
              shortcutEnabled && !drawer
                ? `${collapsed ? expandLabel : collapseLabel} (Ctrl/Command+B)`
                : undefined
            }
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
        {onSearch && (
          <div className="tp-chat-sidenav__search-row">
            <button
              ref={search}
              type="button"
              className="tp-chat-sidenav__search"
              aria-label={searchLabel}
              aria-keyshortcuts={
                searchShortcutEnabled ? 'Control+K Meta+K' : undefined
              }
              title={
                searchShortcutEnabled
                  ? `${searchLabel} (Ctrl/Command+K)`
                  : searchLabel
              }
              onClick={() => onSearch()}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="8.5" cy="8.5" r="5.75" />
                <path d="m13 13 4.25 4.25" />
              </svg>
              <span className="tp-chat-sidenav__search-label">
                {searchLabel}
              </span>
            </button>
          </div>
        )}
        <div
          ref={body}
          id={bodyId}
          className="tp-chat-sidenav__body"
          hidden={collapsed}
          inert={collapsed}
        >
          {children}
        </div>
        {collapsedContent !== undefined && (
          <div
            ref={compact}
            className="tp-chat-sidenav__collapsed-content"
            hidden={!collapsed}
            inert={!collapsed}
          >
            {collapsedContent}
          </div>
        )}
      </nav>
    </div>
  );
}
