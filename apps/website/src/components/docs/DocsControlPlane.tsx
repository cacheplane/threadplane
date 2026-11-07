'use client';

import type { ReactNode } from 'react';
import {
  BookOpen,
  Braces,
  Code2,
  ExternalLink,
  Play,
  Search,
} from 'lucide-react';
import {
  ControlPlaneActionBar,
  ControlPlaneIconButton,
  ControlPlanePane,
  ControlPlaneRail,
  ControlPlaneRailItem,
  ControlPlaneSection,
  useControlPlanePreferences,
} from '@threadplane/ui-react';
import { getLibraryConfig, type LibraryId } from '../../lib/docs-config';
import { usePathname } from 'next/navigation';
import type { DocsScope } from '../../lib/docs-catalog';
import { useDocsFramework } from '../../lib/use-docs-framework';
import { FrameworkSelector, type FrameworkSelectorProps } from './FrameworkSelector';
import { DocsNavigation } from './DocsSidebar';
import { ApiNavigation, type ApiNavigationProps } from './api/ApiNavigation';

export interface DocsControlPlaneProps {
  scope?: DocsScope;
  documentId?: string;
  frameworkTargets?: FrameworkSelectorProps['targets'];
  currentPath?: string;
  /** `null` on a library-neutral docs page, e.g. /docs/choosing-an-adapter. */
  activeLibrary: LibraryId | null;
  activeSection: string;
  activeSlug: string;
  /** Generated reference navigation, used by both the desktop pane and mobile sheet. */
  apiContext?: ApiNavigationProps;
  /**
   * Where the Run rail item goes on a page that has no example of its own.
   *
   * Only the docs index supplies this. Run normally means "run the example on
   * this page", and a docs-only page correctly has none — but the index is not
   * a capability page at all, so the canonical example is the only meaningful
   * target. Absent, Run stays disabled.
   */
  runHref?: string;
}

const dispatchSearch = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true })
  );

export function DocsContextContent({
  activeLibrary,
  activeSection,
  activeSlug,
  apiContext,
  scope,
  documentId,
  frameworkTargets,
  mobile = false,
  showFrameworkSelector = true,
  frameworkSelector,
  onNavigate,
  onSearchHandoff,
  resolveHref,
}: DocsControlPlaneProps & {
  mobile?: boolean;
  showFrameworkSelector?: boolean;
  frameworkSelector?: ReactNode;
  onNavigate?: () => void;
  onSearchHandoff?: () => void;
  resolveHref?: (href: string) => string;
}) {
  const preferences = useControlPlanePreferences('docs');
  const pathname = usePathname();
  const framework = useDocsFramework(pathname);
  const compact = pathname?.startsWith('/docs/angular/') ?? false;
  const library = activeLibrary ? getLibraryConfig(activeLibrary) : undefined;
  const openSearch = () => {
    if (!mobile) {
      dispatchSearch();
      return;
    }
    if (onSearchHandoff) {
      onSearchHandoff();
      return;
    }
    onNavigate?.();
    window.requestAnimationFrame(dispatchSearch);
  };
  const navigation = apiContext ? (
    <ApiNavigation {...apiContext} onNavigate={onNavigate} resolveHref={resolveHref} />
  ) : (
    <DocsNavigation
      framework={framework}
      activeLibrary={activeLibrary}
      activeSection={activeSection}
      activeSlug={activeSlug}
      expanded={preferences.expanded}
      onExpandedChange={preferences.setExpanded}
      onNavigate={onNavigate}
      resolveHref={resolveHref}
    />
  );

  return (
    <div data-docs-control-plane-context data-docs-navigation-compact={compact || undefined} data-mobile={mobile || undefined}>
      <button
        type="button"
        className="docs-control-plane-search-trigger"
        onClick={openSearch}
      >
        <span className="docs-control-plane-search-inner">
          <Search size={14} aria-hidden="true" />
          <span className="docs-control-plane-search-label">Search docs</span>
        </span>
        {/* Hidden where there is no keyboard to press it — see docs.css. */}
        <kbd className="docs-control-plane-search-kbd" aria-hidden="true">⌘K</kbd>
      </button>

      {frameworkSelector ?? (showFrameworkSelector && <FrameworkSelector scope={scope} documentId={documentId} targets={frameworkTargets} onNavigate={onNavigate} />)}

      {compact ? navigation : (
        <ControlPlaneSection
          title={apiContext ? 'API Reference' : 'Learn'}
          open={preferences.expanded.Learn ?? true}
          onOpenChange={(open) => preferences.setExpanded('Learn', open)}
        >
          {navigation}
        </ControlPlaneSection>
      )}

      {library?.demoUrl ? compact ? (
        <a className="docs-sidebar-supporting-demo" href={library.demoUrl} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
          {library.demoLabel ?? 'Open live demo'}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : (
        <ControlPlaneSection title="Actions" collapsible={false}>
          <ControlPlaneActionBar label="Docs actions">
            <ControlPlaneIconButton
              label={library.demoLabel ?? 'Open live demo'}
              icon={<ExternalLink size={16} aria-hidden="true" />}
              href={library.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          </ControlPlaneActionBar>
        </ControlPlaneSection>
      ) : null}
    </div>
  );
}

export function DocsControlPlane(props: DocsControlPlaneProps) {
  const pathname = usePathname();
  const currentPath = props.apiContext?.activeHref ?? props.currentPath ?? pathname;
  const disabledReason = (mode: 'Run' | 'Code' | 'API') =>
    `${mode} is unavailable because this page has no workspace capability.`;

  return (
    <div className="docs-control-plane" data-docs-control-plane>
      <ControlPlaneRail
        label="Docs modes"
        primary={
          <>
            <ControlPlaneRailItem
              label="Docs"
              icon={<BookOpen size={18} aria-hidden="true" />}
              href={currentPath}
              active
            />
            <ControlPlaneRailItem
              label="Run"
              icon={<Play size={18} aria-hidden="true" />}
              href={props.runHref ?? '/docs/examples'}
            />
            <ControlPlaneRailItem
              label="Code"
              icon={<Code2 size={18} aria-hidden="true" />}
              disabled
              disabledReason={disabledReason('Code')}
            />
            <ControlPlaneRailItem
              label="API"
              icon={<Braces size={18} aria-hidden="true" />}
              href="/docs/api"
            />
          </>
        }
      />
      <ControlPlanePane label="Docs context">
        <DocsContextContent {...props} />
      </ControlPlanePane>
    </div>
  );
}
