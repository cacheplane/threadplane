'use client';

import {
  useId,
  type ComponentType,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Blocks,
  BookOpen,
  Boxes,
  Braces,
  ChevronDown,
  Check,
  Circle,
  FileCode2,
  Lightbulb,
  Rocket,
  ArrowRightLeft,
} from 'lucide-react';
import {
  getFrameworkDocsConfig,
  getLibraryConfig,
  libraryIntroPath,
  specialDocsPages,
  type DocsSection,
  type LibraryGroup,
  type LibraryId,
} from '../../lib/docs-config';
import { LibraryMark } from './LibraryMark';
import { useDocsDropdown } from './use-docs-dropdown';
import type { DocsFramework } from '@threadplane/cockpit-registry/docs-routes';
import { preferredDocsHref } from '../../lib/framework-preference';
import { isDocsReadingRoute } from '../../lib/docs-presentation';

export interface DocsNavigationProps {
  framework?: DocsFramework;
  /** `null` on a library-neutral docs page. */
  activeLibrary: LibraryId | null;
  activeSection: string;
  activeSlug: string;
  expanded?: Record<string, boolean>;
  onExpandedChange?: (key: string, open: boolean) => void;
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}

const LIBRARY_GROUPS: { id: LibraryGroup; label: string }[] = [
  { id: 'adapter', label: 'Adapters' },
  { id: 'library', label: 'Libraries' },
];

function LibraryDropdown({
  framework,
  activeLibrary,
  compact = false,
  onNavigate,
  resolveHref = href => href,
}: {
  framework: DocsFramework;
  activeLibrary: LibraryId | null;
  compact?: boolean;
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}) {
  const libraries = getFrameworkDocsConfig(framework);
  const { open, setOpen, ref, triggerRef, menuRef, menuId, openMenu, closeMenu, onMenuKeyDown } = useDocsDropdown();

  const currentLibrary = activeLibrary
    ? getLibraryConfig(activeLibrary)
    : undefined;

  return (
    <div ref={ref} className="docs-sidebar-library" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      {compact ? <span className="docs-sidebar-picker-label">Library</span> : null}
      <button
        ref={triggerRef}
        type="button"
        data-docs-library-trigger
        onClick={() => {
          if (open) closeMenu(true);
          else openMenu('selected');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
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
          aria-label="Libraries"
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
              {libraries
                .filter((library) => library.group === group.id)
                .map((library) => {
                  const isActive = library.id === activeLibrary;
                  return (
                    <Link
                      role="menuitemradio"
                      aria-checked={isActive}
                      tabIndex={-1}
                      key={library.id}
                      href={resolveHref(libraryIntroPath(library.id, framework))}
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
                          data-docs-menu-title
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
                      <Check className="docs-sidebar-lib-item-check" size={16} aria-hidden="true" visibility={isActive ? 'visible' : 'hidden'} />
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
  migrations: ArrowRightLeft,
};

function SectionGroup({
  section,
  activeSection,
  activeSlug,
  open,
  compact = false,
  onOpenChange,
  onNavigate,
  resolveHref = href => href,
}: {
  section: DocsSection;
  activeSection: string;
  activeSlug: string;
  open: boolean;
  compact?: boolean;
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
          {!compact && <SectionIcon size={16} aria-hidden={true} />}
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
            if (!page.href) return null;
            const isActive =
              page.section === activeSection && page.slug === activeSlug;
            return (
              <Link
                key={`${page.section}/${page.slug}`}
                href={resolveHref(page.href)}
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
  framework = 'angular',
  activeLibrary,
  activeSection,
  activeSlug,
  expanded = {},
  onExpandedChange,
  onNavigate,
  resolveHref = href => href,
}: DocsNavigationProps) {
  const libraries = getFrameworkDocsConfig(framework);
  const library = libraries.find(candidate => candidate.id === activeLibrary);
  const migrations = libraries.find(candidate => candidate.id === 'chat')?.sections.find(section => section.id === 'migrations');
  const pathname = usePathname();
  const compact = isDocsReadingRoute(pathname);
  const supportingAtEnd = compact && Boolean(activeLibrary);

  const supportingLinks = (
      <nav
        aria-label={compact ? 'More documentation' : 'Featured documentation'}
        className="docs-sidebar-top-links"
      >
        <Link href={resolveHref(preferredDocsHref(framework))} className="docs-sidebar-top-link" onClick={onNavigate}
          data-active={pathname === preferredDocsHref(framework) || undefined}
          aria-current={pathname === preferredDocsHref(framework) ? 'page' : undefined}
          data-docs-navlink data-workspace-navigation-link>
          {compact && activeLibrary ? `${framework === 'react' ? 'React' : 'Angular'} quickstart` : 'Quickstart'}
        </Link>
        <Link
          href={resolveHref(`/docs/${framework}/getting-started/workbench`)}
          className="docs-sidebar-top-link"
          onClick={onNavigate}
          data-docs-navlink
          data-workspace-navigation-link
          aria-current={pathname === `/docs/${framework}/getting-started/workbench` ? 'page' : undefined}
        >
          Learning workbench
        </Link>
        <Link
          href={resolveHref('/docs/api')}
          className="docs-sidebar-top-link"
          onClick={onNavigate}
          data-docs-navlink
          data-workspace-navigation-link
        >
          API Reference
        </Link>
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
  );

  return (
    <div data-docs-navigation>
      {!supportingAtEnd && supportingLinks}

      <LibraryDropdown framework={framework} activeLibrary={activeLibrary} compact={compact} onNavigate={onNavigate} resolveHref={resolveHref} />

      {/* No library means no section tree. Narrowing on `activeLibrary` rather
       * than `library` keeps SectionGroup's non-null contract honest. */}
      {activeLibrary && library
        ? library.sections.filter(section => section.id !== 'migrations').map((section) => {
            const key = `Learn:${activeLibrary}:${section.id}`;
            return (
              <SectionGroup
                key={section.id}
                section={section}
                activeSection={activeSection}
                activeSlug={activeSlug}
                compact={compact}
                open={expanded[key] ?? (!compact || section.id === activeSection)}
                onOpenChange={(open) => onExpandedChange?.(key, open)}
                onNavigate={onNavigate}
                resolveHref={resolveHref}
              />
            );
          })
        : null}
      {migrations ? (
        <SectionGroup
          section={migrations}
          activeSection={activeLibrary === 'chat' ? activeSection : ''}
          activeSlug={activeSlug}
          compact={compact}
          open={expanded['Learn:migrations'] ?? (compact && activeLibrary === 'chat' && activeSection === 'migrations')}
          onOpenChange={(open) => onExpandedChange?.('Learn:migrations', open)}
          onNavigate={onNavigate}
          resolveHref={resolveHref}
        />
      ) : null}
      {supportingAtEnd && supportingLinks}
    </div>
  );
}
