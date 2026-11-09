'use client';

import type { ReactNode } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import {
  ControlPlaneActionBar,
  ControlPlaneIconButton,
  ControlPlaneSection,
  useControlPlanePreferences,
} from '@threadplane/ui-react';
import { getLibraryConfig, type LibraryId } from '../../lib/docs-config';
import { usePathname } from 'next/navigation';
import type { DocsScope } from '../../lib/docs-catalog';
import { useDocsFramework } from '../../lib/use-docs-framework';
import { isDocsReadingRoute } from '../../lib/docs-presentation';
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
  const compact = isDocsReadingRoute(pathname);
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

      {!apiContext && (frameworkSelector ?? (showFrameworkSelector && <FrameworkSelector scope={scope} documentId={documentId} targets={frameworkTargets} onNavigate={onNavigate} />))}

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
