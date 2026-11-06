'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import {
  type CockpitManifestEntry,
  getCanonicalWebsiteWorkspaceHref,
  getWorkspaceDestinationPath,
  type WorkspaceMode,
  type WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import type {
  ContentBundle,
  NavigationProduct,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import {
  WorkspaceProvider,
  WorkspaceShell,
  readWorkspaceModeQuery,
  type RuntimeTerminalTransition,
  type TrackModeChange,
  type TrackNavigation,
  type TrackRuntimeAction,
  type TrackRuntimeTransition,
  type WorkspaceContextPaneRenderer,
  type WorkspaceCrumb,
} from '@threadplane/workspace-react';
import { ThemeProvider } from '@threadplane/ui-react';
import { useRouter } from 'next/navigation';
import { track } from '../../lib/analytics/client';
import { analyticsEvents } from '../../lib/analytics/events';
import {
  DocsContextContent,
  type DocsControlPlaneProps,
} from '../docs/DocsControlPlane';
import { WORKSPACE_PANEL_FOCUS_INTENT } from './workspace-panel-focus';
import { FrameworkSelector } from '../docs/FrameworkSelector';
import type { DocsFramework } from '@threadplane/cockpit-registry';

/*
 * The docs workspace surface: the shell, its mode/navigation/runtime wiring and
 * everything that reaches @threadplane/cockpit-registry. It is imported ONLY by
 * WebsiteWorkspace.tsx, the docs-route registrar, which hands it to the root
 * shell at registration. Never import it from WebsiteWorkspaceRoot.tsx or from
 * anything under app/layout.tsx: that ships the capability catalog to every
 * page on the site. e2e/home-bundle.spec.ts guards it.
 */

export interface WebsiteWorkspaceProps {
  readonly resolution: WorkspaceResolution;
  readonly presentation: WorkspacePresentation;
  readonly contentBundle: ContentBundle;
  readonly navigationTree: NavigationProduct[];
  readonly routePath: string;
  /** Test/alternate-host override. Website routes normally read this in-browser. */
  readonly requestedMode?: string | null;
  readonly docsSlot?: ReactNode;
  readonly framework?: DocsFramework;
  readonly docsContext?: DocsControlPlaneProps;
  /** Docs routes supply their own trail; workspace routes keep the derived one. */
  readonly contextTrail?: readonly WorkspaceCrumb[];
}

interface DiscoveredRouteMode {
  readonly routePath: string;
  readonly mode: string | null;
}

interface FrameworkNavigationIntent extends DiscoveredRouteMode {
  readonly sourcePath: string;
  readonly href: string;
}

const MODE_ANALYTICS: Record<WorkspaceMode, string> = {
  Docs: 'docs',
  Run: 'run',
  Code: 'code',
  API: 'api',
};

const RUNTIME_FRAME_TELEMETRY = {
  posthogToken: process.env.NEXT_PUBLIC_POSTHOG_TOKEN,
};

let workspaceSessionId: string | null = null;

function getWebsiteWorkspaceSessionId(): string {
  if (!workspaceSessionId) {
    workspaceSessionId = `website_workspace_${globalThis.crypto.randomUUID()}`;
  }
  return workspaceSessionId;
}

const trackNavigation: TrackNavigation = ({
  capability,
  category,
  fromCapability,
}) => {
  track(analyticsEvents.docsWorkspaceNavigation, {
    surface: 'docs',
    capability,
    category,
    from_capability: fromCapability,
  });
};

const trackModeChange: TrackModeChange = ({ capability, fromMode, toMode }) => {
  track(analyticsEvents.docsWorkspaceModeSwitched, {
    surface: 'docs',
    capability,
    from_mode: MODE_ANALYTICS[fromMode],
    to_mode: MODE_ANALYTICS[toMode],
  });
};

const trackRuntimeAction: TrackRuntimeAction = (event) => {
  track(analyticsEvents.docsWorkspaceRuntimeAction, {
    surface: 'docs',
    capability: event.capability,
    action: event.action,
    state_before: event.stateBefore,
    outcome: event.outcome,
  });
};

const trackRuntimeTransition: TrackRuntimeTransition = (
  transition: RuntimeTerminalTransition
) => {
  track(analyticsEvents.docsWorkspaceRuntimeStatusChanged, {
    surface: 'docs',
    capability: transition.capability,
    from_state: transition.fromState,
    to_state: transition.toState,
    ...(transition.elapsedMs === undefined
      ? {}
      : { elapsed_ms: transition.elapsedMs }),
    ...(transition.reasonCode === undefined
      ? {}
      : { reason_code: transition.reasonCode }),
  });
};

const resolveIdentityHref = (entry: CockpitManifestEntry): string =>
  getWorkspaceDestinationPath(entry);

export function WebsiteWorkspaceSurface({
  resolution,
  presentation,
  contentBundle,
  navigationTree,
  routePath,
  requestedMode,
  docsSlot,
  framework = 'angular',
  docsContext,
  contextTrail,
}: WebsiteWorkspaceProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [frameworkNavigationPending, startFrameworkNavigation] = useTransition();
  const [frameworkNavigationIntent, setFrameworkNavigationIntent] =
    useState<FrameworkNavigationIntent | null>(null);
  const navigateFramework = useCallback((href: string) => {
    const destination = new URL(href, window.location.origin);
    setFrameworkNavigationIntent({
      sourcePath: routePath,
      routePath: destination.pathname,
      href: `${destination.pathname}${destination.search}${destination.hash}`,
      mode: readWorkspaceModeQuery(destination.searchParams),
    });
    startFrameworkNavigation(() => routerRef.current.push(href));
  }, [routePath]);
  const [discoveredRouteMode, setDiscoveredRouteMode] =
    useState<DiscoveredRouteMode | null>(null);
  const routeMode =
    frameworkNavigationIntent?.routePath === routePath
      ? frameworkNavigationIntent.mode
      : requestedMode !== undefined
      ? requestedMode
      : discoveredRouteMode?.routePath === routePath
      ? discoveredRouteMode.mode
      : null;

  useLayoutEffect(() => {
    const intent = frameworkNavigationIntent;
    if (!intent) return;
    if (routePath !== intent.routePath) {
      if (routePath !== intent.sourcePath) setFrameworkNavigationIntent(null);
      return;
    }
    if (window.location.pathname !== intent.routePath) return;
    // A cached production route can restore the query from its first visit.
    // Keep this explicit selection authoritative without adding history or
    // navigating through that cache again. Later history visits remain free
    // to restore their own URL once this one-shot intent has been consumed.
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== intent.href) window.history.replaceState(null, '', intent.href);
    setDiscoveredRouteMode({ routePath, mode: intent.mode });
    setFrameworkNavigationIntent(null);
  }, [frameworkNavigationIntent, routePath]);
  const modeHref = useCallback((href: string, preserveFragment = false) => {
    const url = new URL(href, 'https://threadplane.ai');
    if (preserveFragment) url.hash = window.location.hash;
    return `${url.pathname}${url.search}${url.hash}`;
  }, []);

  const synchronizeRouteMode = useCallback(
    (mode: string | null) => {
      if (requestedMode !== undefined) return;
      setDiscoveredRouteMode({ routePath, mode });
    },
    [requestedMode, routePath]
  );

  useEffect(() => {
    const discoverCurrentMode = () => {
      const currentUrl = new URL(window.location.href);
      const destinationPath = new URL(routePath, window.location.origin)
        .pathname;
      if (currentUrl.pathname !== destinationPath) return;
      setDiscoveredRouteMode({
        routePath,
        mode: readWorkspaceModeQuery(currentUrl.searchParams),
      });
    };
    const restoreHistoryMode = () => {
      setFrameworkNavigationIntent(null);
      discoverCurrentMode();
    };
    discoverCurrentMode();
    window.addEventListener('popstate', restoreHistoryMode);
    return () => window.removeEventListener('popstate', restoreHistoryMode);
  }, [requestedMode, routePath]);

  const pushIdentity = useCallback(
    (
      href: string,
      options?: {
        restoreFocus?: 'mobile-navigation-trigger' | 'workspace-panel';
      }
    ) => {
      setFrameworkNavigationIntent(null);
      href = modeHref(href);
      if (options?.restoreFocus === 'workspace-panel') {
        const currentDestination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (href !== currentDestination) {
          try {
            window.sessionStorage.setItem(
              WORKSPACE_PANEL_FOCUS_INTENT,
              JSON.stringify({ destination: href, requestedAt: Date.now() })
            );
          } catch {
            // Navigation still works when storage is unavailable.
          }
        }
      }
      routerRef.current.push(href);
    },
    [modeHref]
  );

  const pushMode = useCallback(
    (mode: WorkspaceMode) => {
      setFrameworkNavigationIntent(null);
      const href = modeHref(
        getCanonicalWebsiteWorkspaceHref(resolution, mode),
        true
      );
      synchronizeRouteMode(
        readWorkspaceModeQuery(
          new URL(href, window.location.origin).searchParams
        )
      );
      if (
        requestedMode === undefined &&
        new URL(href, window.location.origin).pathname ===
          window.location.pathname
      ) {
        // Mode views are already loaded. A server navigation can outlive the
        // visitor's next navigation and restore an older destination.
        window.history.pushState(null, '', href);
        return;
      }
      routerRef.current.push(href);
    },
    [resolution, synchronizeRouteMode, modeHref, requestedMode]
  );

  const replaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setFrameworkNavigationIntent(null);
      const href = modeHref(
        getCanonicalWebsiteWorkspaceHref(resolution, mode),
        true
      );
      synchronizeRouteMode(
        readWorkspaceModeQuery(
          new URL(href, window.location.origin).searchParams
        )
      );
      if (
        mode === 'Docs' &&
        new URL(href, window.location.origin).pathname ===
          window.location.pathname
      ) {
        // This corrects the current view's query without navigating through a
        // cached static route that can retain the original invalid query.
        window.history.replaceState(null, '', href);
        return;
      }
      routerRef.current.replace(href);
    },
    [resolution, synchronizeRouteMode, modeHref]
  );

  const renderContextPane = useCallback<WorkspaceContextPaneRenderer>(
    ({ onNavigate, onAction }) => {
      if (!docsContext) return null;
      return (
        <DocsContextContent
          {...docsContext}
          showFrameworkSelector={false}
          mobile={Boolean(onAction)}
          onNavigate={onNavigate}
          onSearchHandoff={onAction ? () => onAction('search-docs') : undefined}
        />
      );
    },
    [docsContext]
  );

  const renderContextHeader = useCallback<WorkspaceContextPaneRenderer>(
    ({ onNavigate }) =>
      docsContext ? (
        <FrameworkSelector
          scope={docsContext.scope}
          documentId={docsContext.documentId}
          targets={docsContext.frameworkTargets}
          navigationPending={frameworkNavigationPending}
          navigateTo={navigateFramework}
          onNavigate={onNavigate}
        />
      ) : null,
    [docsContext, frameworkNavigationPending, navigateFramework]
  );

  const handleContextAction = useCallback((action: string) => {
    if (action !== 'search-docs') return;
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true })
    );
  }, []);

  const handleMobileModalPresenceChange = useCallback((present: boolean) => {
    const isolate = (element: HTMLElement | null) => {
      if (!element) return;
      element.inert = present;
      if (present) element.setAttribute('aria-hidden', 'true');
      else element.removeAttribute('aria-hidden');
    };
    isolate(document.querySelector<HTMLElement>('[data-site-navigation]'));
    const announcementRegion = document.querySelector<HTMLElement>(
      '[data-announcement-region]'
    );
    isolate(announcementRegion);
    announcementRegion?.toggleAttribute('data-workspace-modal-hidden', present);
  }, []);

  useEffect(
    () => () => handleMobileModalPresenceChange(false),
    [handleMobileModalPresenceChange]
  );

  /*
   * Re-apply the URL fragment once the shell owns the scrolling.
   *
   * A hard load of `/docs/…#heading` — every shared link, search result and
   * docs-search deep link takes that shape — starts with the article rendered
   * straight into the document, so the browser performs its native scroll to
   * the fragment against the page scroller. Mounting this surface then makes
   * `html:has([data-website-workspace-host])` match, which is
   * `overflow: hidden` (styles/docs.css); the page scroller disappears, that
   * scroll is discarded, and the real scroller — `.docs-workspace-article`,
   * mounted with it — starts at zero. Nothing puts the reader back, so the
   * heading they followed is left off screen with no error anywhere.
   *
   * This runs once, on the mount that takes the scrolling over. Later
   * fragment navigation is same-document and the browser handles it inside
   * the pane on its own. Guarded by e2e/docs-deep-link.spec.ts.
   */
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return;
    let id: string;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      // A malformed escape is not an element id either way.
      return;
    }
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [framework, routePath]);

  return (
    <ThemeProvider theme="light">
      <div className="website-workspace-host" data-website-workspace-host="" data-workspace-framework={framework} data-workspace-route={routePath}>
        <WorkspaceProvider
          key={framework}
          resolution={resolution}
          presentation={presentation}
          contentBundle={contentBundle}
          routePath={routePath}
          requestedMode={routeMode}
          docsSlot={docsSlot}
          pushIdentity={pushIdentity}
          pushMode={pushMode}
          replaceMode={replaceMode}
          resolveIdentityHref={resolveIdentityHref}
          getSessionId={getWebsiteWorkspaceSessionId}
          runtimeTelemetry={RUNTIME_FRAME_TELEMETRY}
          trackNavigation={trackNavigation}
          trackModeChange={trackModeChange}
          trackRuntimeAction={trackRuntimeAction}
          trackRuntimeTransition={trackRuntimeTransition}
        >
          <WorkspaceShell
            rootElement="section"
            navigationTree={navigationTree}
            entry={
              resolution.kind === 'mapped'
                ? navigationTree
                    .flatMap((product) =>
                      product.sections.flatMap((section) => section.entries)
                    )
                    .find((entry) => entry.id === resolution.identity.id)
                : undefined
            }
            contextTrail={contextTrail}
            ariaLabel="Documentation workspace"
            modeNavigationLabel="Documentation modes"
            contextPaneLabel="Documentation context"
            mobileDialogLabel="Documentation control plane"
            mobileTitle="Documentation"
            renderContextPane={docsContext ? renderContextPane : undefined}
            renderContextHeader={docsContext ? renderContextHeader : undefined}
            onContextAction={handleContextAction}
            onMobileModalPresenceChange={handleMobileModalPresenceChange}
          />
        </WorkspaceProvider>
      </div>
    </ThemeProvider>
  );
}
