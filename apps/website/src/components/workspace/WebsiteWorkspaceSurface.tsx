'use client';

import {
  useCallback,
  useEffect,
  useMemo,
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
import type { WebsiteWorkspaceVariant } from '../../lib/workspace-page';

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
  readonly frontendVariants?: { readonly react?: WebsiteWorkspaceVariant };
  readonly reactDocsSlot?: ReactNode;
  readonly docsContext?: DocsControlPlaneProps;
  /** Docs routes supply their own trail; workspace routes keep the derived one. */
  readonly contextTrail?: readonly WorkspaceCrumb[];
}

interface DiscoveredRouteMode {
  readonly routePath: string;
  readonly mode: string | null;
  readonly frontend: 'angular' | 'react';
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
  frontendVariants,
  reactDocsSlot,
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
  const frontend =
    discoveredRouteMode?.routePath === routePath
      ? discoveredRouteMode.frontend
      : 'angular';
  const selectedVariant =
    frontend === 'react' ? frontendVariants?.react : undefined;
  const selectedNavigationTree = useMemo(() => {
    if (
      resolution.kind !== 'mapped' ||
      selectedVariant?.resolution.kind !== 'mapped'
    )
      return navigationTree;
    const identity = selectedVariant.resolution.identity;
    return navigationTree.map((product) => ({
      ...product,
      sections: product.sections.map((section) => ({
        ...section,
        entries: section.entries.map((entry) =>
          entry.id === resolution.identity.id
            ? {
                ...entry,
                id: identity.id,
                title: identity.title,
                availableModes: identity.availableModes,
              }
            : entry
        ),
      })),
    }));
  }, [resolution, selectedVariant, navigationTree]);
  const unavailableReact = frontend === 'react' && !selectedVariant;
  const selectedResolution: WorkspaceResolution =
    selectedVariant?.resolution ??
    (unavailableReact
      ? {
          kind: 'docs-only',
          docsPath: routePath,
          title: 'React preview unavailable',
          unavailableReason: 'no-workspace-capability',
        }
      : resolution);
  const selectedPresentation: WorkspacePresentation =
    selectedVariant?.presentation ??
    (unavailableReact
      ? {
          kind: 'docs-only',
          docsPath: routePath,
          title: 'React preview unavailable',
          runnable: false,
        }
      : presentation);
  const selectedContent =
    selectedVariant?.contentBundle ??
    (unavailableReact
      ? {
          codeFiles: {},
          codeSources: {},
          promptFiles: {},
          runtimeUrl: null,
          docSections: [],
        }
      : contentBundle);
  const frontendHref = useCallback(
    (href: string, preserveFragment = false) => {
      const url = new URL(href, 'https://threadplane.ai');
      if (frontend === 'react') url.searchParams.set('frontend', 'react');
      if (preserveFragment) url.hash = window.location.hash;
      return `${url.pathname}${url.search}${url.hash}`;
    },
    [frontend]
  );

  const synchronizeRouteMode = useCallback(
    (mode: string | null) => {
      if (requestedMode !== undefined) return;
      setDiscoveredRouteMode({ routePath, mode, frontend });
    },
    [requestedMode, routePath, frontend]
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
        frontend:
          currentUrl.searchParams.get('frontend') === 'react'
            ? 'react'
            : 'angular',
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
      href = frontendHref(href);
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
    [frontendHref]
  );

  const pushMode = useCallback(
    (mode: WorkspaceMode) => {
      const href = frontendHref(
        getCanonicalWebsiteWorkspaceHref(selectedResolution, mode),
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
        // visitor's next frontend selection and restore an older destination.
        window.history.pushState(null, '', href);
        return;
      }
      routerRef.current.push(href);
    },
    [selectedResolution, synchronizeRouteMode, frontendHref, requestedMode]
  );

  const replaceMode = useCallback(
    (mode: WorkspaceMode) => {
      const href = frontendHref(
        getCanonicalWebsiteWorkspaceHref(selectedResolution, mode),
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
    [selectedResolution, synchronizeRouteMode, frontendHref]
  );

  const renderContextPane = useCallback<WorkspaceContextPaneRenderer>(
    ({ onNavigate, onAction }) => {
      if (!docsContext) return null;
      return (
        <DocsContextContent
          {...docsContext}
          mobile={Boolean(onAction)}
          onNavigate={onNavigate}
          resolveHref={frontend === 'react' ? frontendHref : undefined}
          onSearchHandoff={onAction ? () => onAction('search-docs') : undefined}
        />
      );
    },
    [docsContext, frontend, frontendHref]
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
  }, [frontend, routePath]);

  return (
    <ThemeProvider theme="light">
      <div className="website-workspace-host" data-website-workspace-host="">
        {(Boolean(frontendVariants?.react) || frontend === 'react') && (
          <div className="website-workspace-frontend">
            <label>
              Example UI{' '}
              <select
                aria-label="Example UI"
                value={frontend}
                onChange={(event) => {
                  const next =
                    event.target.value === 'react' ? 'react' : 'angular';
                  const url = new URL(window.location.href);
                  // Mode selection is optimistic while a router response is
                  // pending. Commit the displayed mode with the frontend so a
                  // delayed response cannot restore the previous selection.
                  if (routeMode !== null) url.searchParams.set('mode', routeMode);
                  if (next === 'react')
                    url.searchParams.set('frontend', 'react');
                  else url.searchParams.delete('frontend');
                  // Both frontend variants are already loaded. Next integrates
                  // native history for query-only view changes and Back/Forward.
                  window.history.pushState(
                    null,
                    '',
                    `${url.pathname}${url.search}${url.hash}`
                  );
                  setDiscoveredRouteMode({
                    routePath,
                    mode: routeMode,
                    frontend: next,
                  });
                }}
              >
                <option value="angular">Angular</option>
                <option value="react">React preview</option>
              </select>
            </label>
          </div>
        )}
        <WorkspaceProvider
          key={frontend}
          resolution={selectedResolution}
          presentation={selectedPresentation}
          contentBundle={selectedContent}
          routePath={routePath}
          requestedMode={routeMode}
          docsSlot={
            unavailableReact ? (
              <article className="docs-workspace-article">
                <p>
                  React preview is not available for this topic. Choose Angular
                  to view its documentation and example.
                </p>
              </article>
            ) : frontend === 'react' ? (
              reactDocsSlot
            ) : (
              docsSlot
            )
          }
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
            navigationTree={selectedNavigationTree}
            entry={
              selectedVariant && selectedResolution.kind === 'mapped'
                ? selectedNavigationTree
                    .flatMap((product) =>
                      product.sections.flatMap((section) => section.entries)
                    )
                    .find(
                      (entry) => entry.id === selectedResolution.identity.id
                    )
                : undefined
            }
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
