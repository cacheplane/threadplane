'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  readonly docsContext?: DocsControlPlaneProps;
  /** Docs routes supply their own trail; workspace routes keep the derived one. */
  readonly contextTrail?: readonly WorkspaceCrumb[];
}

interface DiscoveredRouteMode {
  readonly routePath: string;
  readonly mode: string | null;
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
  docsContext,
  contextTrail,
}: WebsiteWorkspaceProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [discoveredRouteMode, setDiscoveredRouteMode] =
    useState<DiscoveredRouteMode | null>(null);
  const routeMode =
    requestedMode !== undefined
      ? requestedMode
      : discoveredRouteMode?.routePath === routePath
      ? discoveredRouteMode.mode
      : null;

  const synchronizeRouteMode = useCallback(
    (mode: string | null) => {
      if (requestedMode !== undefined) return;
      setDiscoveredRouteMode({ routePath, mode });
    },
    [requestedMode, routePath]
  );

  useEffect(() => {
    if (requestedMode !== undefined) return;
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
    discoverCurrentMode();
    window.addEventListener('popstate', discoverCurrentMode);
    return () => window.removeEventListener('popstate', discoverCurrentMode);
  }, [requestedMode, routePath]);

  const pushIdentity = useCallback(
    (
      href: string,
      options?: {
        restoreFocus?: 'mobile-navigation-trigger' | 'workspace-panel';
      }
    ) => {
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
    []
  );

  const pushMode = useCallback(
    (mode: WorkspaceMode) => {
      const href = getCanonicalWebsiteWorkspaceHref(resolution, mode);
      synchronizeRouteMode(
        readWorkspaceModeQuery(
          new URL(href, window.location.origin).searchParams
        )
      );
      routerRef.current.push(href);
    },
    [resolution, synchronizeRouteMode]
  );

  const replaceMode = useCallback(
    (mode: WorkspaceMode) => {
      const href = getCanonicalWebsiteWorkspaceHref(resolution, mode);
      synchronizeRouteMode(
        readWorkspaceModeQuery(
          new URL(href, window.location.origin).searchParams
        )
      );
      routerRef.current.replace(href);
    },
    [resolution, synchronizeRouteMode]
  );

  const renderContextPane = useCallback<WorkspaceContextPaneRenderer>(
    ({ onNavigate, onAction }) => {
      if (!docsContext) return null;
      return (
        <DocsContextContent
          {...docsContext}
          mobile={Boolean(onAction)}
          onNavigate={onNavigate}
          onSearchHandoff={onAction ? () => onAction('search-docs') : undefined}
        />
      );
    },
    [docsContext]
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
  }, []);

  return (
    <ThemeProvider theme="light">
      <div className="website-workspace-host" data-website-workspace-host="">
        <WorkspaceProvider
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
            contextTrail={contextTrail}
            ariaLabel="Documentation workspace"
            modeNavigationLabel="Documentation modes"
            contextPaneLabel="Documentation context"
            mobileDialogLabel="Documentation control plane"
            mobileTitle="Documentation"
            renderContextPane={docsContext ? renderContextPane : undefined}
            onContextAction={handleContextAction}
            onMobileModalPresenceChange={handleMobileModalPresenceChange}
          />
        </WorkspaceProvider>
      </div>
    </ThemeProvider>
  );
}
