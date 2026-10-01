'use client';

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
import { DocsNavigation } from './DocsSidebar';

export interface DocsControlPlaneProps {
  /** `null` on a library-neutral docs page, e.g. /docs/choosing-an-adapter. */
  activeLibrary: LibraryId | null;
  activeSection: string;
  activeSlug: string;
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
  mobile = false,
  onNavigate,
  onSearchHandoff,
  resolveHref,
}: DocsControlPlaneProps & {
  mobile?: boolean;
  onNavigate?: () => void;
  onSearchHandoff?: () => void;
  resolveHref?: (href: string) => string;
}) {
  const preferences = useControlPlanePreferences('docs');
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
  return (
    <div data-docs-control-plane-context data-mobile={mobile || undefined}>
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

      <ControlPlaneSection
        title="Learn"
        open={preferences.expanded.Learn ?? true}
        onOpenChange={(open) => preferences.setExpanded('Learn', open)}
      >
        <DocsNavigation
          activeLibrary={activeLibrary}
          activeSection={activeSection}
          activeSlug={activeSlug}
          expanded={preferences.expanded}
          onExpandedChange={preferences.setExpanded}
          onNavigate={onNavigate}
          resolveHref={resolveHref}
        />
      </ControlPlaneSection>

      {library?.demoUrl ? (
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
  const currentPath = props.activeLibrary
    ? `/docs/${props.activeLibrary}/${props.activeSection}/${props.activeSlug}`
    : '/docs';
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
              href={props.runHref}
              disabled={!props.runHref}
              disabledReason={disabledReason('Run')}
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
              disabled
              disabledReason={disabledReason('API')}
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
