'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Blocks,
  BookOpen,
  Boxes,
  Braces,
  ChevronDown,
  Circle,
  FileCode2,
  Lightbulb,
  Rocket,
} from 'lucide-react';
import {
  docsConfig,
  getLibraryConfig,
  libraryIntroPath,
  specialDocsPages,
  type DocsSection,
  type LibraryGroup,
  type LibraryId,
} from '../../lib/docs-config';
import { LibraryMark } from './LibraryMark';

export interface DocsNavigationProps {
  /** `null` on a library-neutral docs page. */
  activeLibrary: LibraryId | null;
  activeSection: string;
  activeSlug: string;
  expanded?: Record<string, boolean>;
  onExpandedChange?: (key: string, open: boolean) => void;
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}

/**
 * Menu entries are `menuitemradio` (single-select from a set), not `menuitem`.
 * Keyboard traversal reads this — if it drifts from the rendered role, arrow
 * keys and Escape silently stop finding anything.
 */
const MENU_ITEM_SELECTOR = '[role="menuitemradio"]';

/** Breathing room between the open menu and the bottom of the viewport. */
const MENU_VIEWPORT_GUTTER = 16;
/** Below this the menu is uselessly short; let the pane scroll instead. */
const MENU_MIN_HEIGHT = 180;

const LIBRARY_GROUPS: { id: LibraryGroup; label: string }[] = [
  { id: 'adapter', label: 'Adapters' },
  { id: 'library', label: 'Libraries' },
];

function LibraryDropdown({
  activeLibrary,
  onNavigate,
  resolveHref = href => href,
}: {
  activeLibrary: LibraryId | null;
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef(0);
  const menuId = useId();

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const items =
      menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR);
    items?.[initialFocusRef.current]?.focus();
  }, [open]);

  /**
   * Cap the menu to the room actually left below the trigger. A CSS `vh` cap
   * cannot do this: the menu opens ~340px down the pane, so even `60vh` still
   * overflows a short window by ~100px. Measured from the trigger, it never
   * runs past the fold — it scrolls internally instead.
   */
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const available =
        window.innerHeight -
        trigger.getBoundingClientRect().bottom -
        MENU_VIEWPORT_GUTTER;
      menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT, available)}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [open]);

  const openMenu = (initialIndex: number) => {
    initialFocusRef.current = initialIndex;
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
      items[nextIndex]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  };

  const currentLibrary = activeLibrary
    ? getLibraryConfig(activeLibrary)
    : undefined;

  return (
    <div ref={ref} className="docs-sidebar-library">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) closeMenu(true);
          else openMenu(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowDown' ? 0 : docsConfig.length - 1);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="docs-sidebar-lib-trigger"
      >
        <span className="docs-sidebar-lib-trigger-inner">
          {activeLibrary ? (
            <LibraryMark library={activeLibrary} size={20} />
          ) : null}
          <span
            className="docs-sidebar-lib-trigger-label"
            data-placeholder={activeLibrary ? undefined : ''}
          >
            {currentLibrary?.title ?? 'Choose a library'}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          data-open={open || undefined}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="docs-sidebar-lib-menu"
          onKeyDown={onMenuKeyDown}
        >
          {LIBRARY_GROUPS.map((group, groupIndex) => (
            <div role="group" aria-label={group.label} key={group.id}>
              {groupIndex > 0 ? (
                <span className="docs-sidebar-lib-divider" aria-hidden="true" />
              ) : null}
              <span className="docs-sidebar-lib-group" aria-hidden="true">
                {group.label}
              </span>
              {docsConfig
                .filter((library) => library.group === group.id)
                .map((library) => {
                  const isActive = library.id === activeLibrary;
                  return (
                    <Link
                      role="menuitemradio"
                      aria-checked={isActive}
                      tabIndex={-1}
                      key={library.id}
                      href={resolveHref(libraryIntroPath(library.id))}
                      data-workspace-navigation-link
                      onClick={() => {
                        closeMenu();
                        onNavigate?.();
                      }}
                      className="docs-sidebar-lib-item"
                      data-active={isActive || undefined}
                    >
                      <span className="docs-sidebar-lib-item-icon">
                        <LibraryMark library={library.id} size={20} />
                      </span>
                      <span className="docs-sidebar-lib-item-text">
                        <span
                          className="docs-sidebar-lib-item-title"
                          data-active={isActive || undefined}
                        >
                          {library.title}
                        </span>
                        {library.tagline ? (
                          <span className="docs-sidebar-lib-item-desc">
                            {library.tagline}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SECTION_ICONS: Record<
  string,
  ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
> = {
  'getting-started': Rocket,
  guides: BookOpen,
  concepts: Lightbulb,
  components: Boxes,
  a2ui: Blocks,
  api: Braces,
  reference: FileCode2,
};

function SectionGroup({
  section,
  activeLibrary,
  activeSection,
  activeSlug,
  open,
  onOpenChange,
  onNavigate,
  resolveHref = href => href,
}: {
  section: DocsSection;
  activeLibrary: LibraryId;
  activeSection: string;
  activeSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}) {
  const SectionIcon = SECTION_ICONS[section.id] ?? Circle;
  const contentId = useId();

  return (
    <div className="docs-sidebar-section">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={contentId}
        className="docs-sidebar-section-toggle"
      >
        <span className="docs-sidebar-section-labelrow">
          <SectionIcon size={16} aria-hidden={true} />
          <span className="docs-sidebar-section-label">{section.title}</span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="docs-sidebar-section-caret"
          data-open={open || undefined}
        />
      </button>

      {open ? (
        <nav
          id={contentId}
          aria-label={`${section.title} pages`}
          className="docs-sidebar-section-links"
        >
          {section.pages.map((page) => {
            const isActive =
              page.section === activeSection && page.slug === activeSlug;
            return (
              <Link
                key={`${page.section}/${page.slug}`}
                href={resolveHref(`/docs/${activeLibrary}/${page.section}/${page.slug}`)}
                onClick={onNavigate}
                data-docs-navlink
                data-workspace-navigation-link
                data-active={isActive || undefined}
                aria-current={isActive ? 'page' : undefined}
                className="docs-sidebar-section-link"
              >
                {page.title}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

export function DocsNavigation({
  activeLibrary,
  activeSection,
  activeSlug,
  expanded = {},
  onExpandedChange,
  onNavigate,
  resolveHref = href => href,
}: DocsNavigationProps) {
  const library = activeLibrary ? getLibraryConfig(activeLibrary) : undefined;
  const pathname = usePathname();

  return (
    <div data-docs-navigation>
      <nav
        aria-label="Featured documentation"
        className="docs-sidebar-top-links"
      >
        {specialDocsPages.map((page) => (
          <Link
            key={page.path}
            href={resolveHref(page.path)}
            onClick={onNavigate}
            data-docs-navlink
            data-workspace-navigation-link
            data-active={pathname === page.path || undefined}
            aria-current={pathname === page.path ? 'page' : undefined}
            className="docs-sidebar-top-link"
          >
            {page.title}
          </Link>
        ))}
      </nav>

      <LibraryDropdown activeLibrary={activeLibrary} onNavigate={onNavigate} resolveHref={resolveHref} />

      {/* No library means no section tree. Narrowing on `activeLibrary` rather
       * than `library` keeps SectionGroup's non-null contract honest. */}
      {activeLibrary && library
        ? library.sections.map((section) => {
            const key = `Learn:${activeLibrary}:${section.id}`;
            return (
              <SectionGroup
                key={section.id}
                section={section}
                activeLibrary={activeLibrary}
                activeSection={activeSection}
                activeSlug={activeSlug}
                open={expanded[key] ?? true}
                onOpenChange={(open) => onExpandedChange?.(key, open)}
                onNavigate={onNavigate}
                resolveHref={resolveHref}
              />
            );
          })
        : null}
    </div>
  );
}
