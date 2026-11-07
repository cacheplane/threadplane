'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  cockpitManifest,
  type CockpitManifestEntry,
  type WorkspaceMode,
} from '@threadplane/cockpit-registry';
import type { WorkspaceCrumb } from './workspace-contracts';
import type { NavigationProduct } from '@threadplane/cockpit-shell';
import { Menu } from 'lucide-react';
import { ApiMode } from './components/api-mode/api-mode';
import { CodeMode } from './components/code-mode/code-mode';
import {
  CockpitControlPlane,
  type CockpitControlPlaneProps,
  type WorkspaceContextPaneRenderer,
} from './components/control-plane/cockpit-control-plane';
import { MobileNavOverlay } from './components/mobile-nav-overlay';
import { RunMode } from './components/run-mode/run-mode';
import { PRODUCT_LABELS } from './navigation-labels';
import { useWorkspace } from './workspace-provider';
import { acquireWorkspaceViewport } from './viewport/workspace-viewport';

const isTabletViewport = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 48rem) and (max-width: 63.999rem)').matches;

const toLabel = (value: string) =>
  value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

interface WorkspacePanelBoundaryProps {
  readonly mode: 'Docs' | 'Run' | 'Code' | 'API';
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface WorkspacePanelBoundaryState {
  readonly hasError: boolean;
}

class WorkspacePanelBoundary extends Component<
  WorkspacePanelBoundaryProps,
  WorkspacePanelBoundaryState
> {
  override state: WorkspacePanelBoundaryState = { hasError: false };

  static getDerivedStateFromError(): WorkspacePanelBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Panel failures stay local; applications can add telemetry at the host.
  }

  override componentDidUpdate(previous: WorkspacePanelBoundaryProps): void {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <section
          role="alert"
          aria-label={`${this.props.mode} panel unavailable`}
        >
          <p>{this.props.mode} panel unavailable.</p>
        </section>
      );
    }
    return this.props.children;
  }
}

export interface WorkspaceShellProps {
  readonly rootElement?: 'main' | 'section';
  readonly navigationTree?: NavigationProduct[];
  readonly manifest?: CockpitManifestEntry[];
  readonly entry?: CockpitManifestEntry;
  readonly themeControl?: ReactNode;
  readonly headerActions?: ReactNode;
  /**
   * An accurate location trail supplied by the host.
   *
   * Absent, the header keeps the label derived from the manifest identity —
   * which is what cockpit wants and what a docs route does not: the manifest's
   * `toLabel()` casing and `page: 'overview'` made a docs page read
   * "Ag Ui / Getting Started / Overview".
   */
  readonly contextTrail?: readonly WorkspaceCrumb[];
  readonly ariaLabel?: string;
  readonly modeNavigationLabel?: string;
  readonly contextPaneLabel?: string;
  readonly mobileDialogLabel?: string;
  readonly mobileTitle?: string;
  readonly renderContextPane?: WorkspaceContextPaneRenderer;
  readonly renderContextHeader?: WorkspaceContextPaneRenderer;
  readonly onContextAction?: (action: string) => void;
  readonly onMobileModalPresenceChange?: (present: boolean) => void;
}

export function WorkspaceShell({
  rootElement = 'main',
  navigationTree = [],
  manifest = cockpitManifest,
  entry: suppliedEntry,
  themeControl,
  headerActions,
  contextTrail,
  ariaLabel = 'Workspace shell',
  modeNavigationLabel = 'Workspace modes',
  contextPaneLabel = 'Workspace context',
  mobileDialogLabel = 'Workspace control plane',
  mobileTitle = 'Workspace',
  renderContextPane,
  renderContextHeader,
  onContextAction,
  onMobileModalPresenceChange,
}: WorkspaceShellProps) {
  const RootElement = rootElement;
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const document = rootRef.current?.ownerDocument;
    if (document) return acquireWorkspaceViewport(document);
    return undefined;
  }, []);
  const workspace = useWorkspace();
  const {
    resolution,
    presentation,
    contentBundle,
    docsSlot,
    activeMode,
    modeAvailability,
    activeUtility,
    activityOpenCycle,
    unseenProblems,
    events,
    expanded,
    hydrated,
    hostServices,
    runtimeController,
    mobileNavigationTriggerRef,
    getSessionId,
    runtimeTelemetry,
    trackNavigation,
    selectMode,
    setActiveUtility,
    setExpanded,
    clearActivity,
    recheckRuntime,
    reloadRuntime,
    openRuntime,
    copyDiagnostics,
  } = workspace;
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [isMobileOverlayPresent, setIsMobileOverlayPresent] = useState(false);
  const [isTabletContextOpen, setIsTabletContextOpen] = useState(false);
  const [isTabletContextPresent, setIsTabletContextPresent] = useState(false);
  const tabletContextTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingTabletFocusModeRef = useRef<WorkspaceMode | null>(null);
  const mappedEntry =
    suppliedEntry ??
    (resolution.kind === 'mapped'
      ? manifest.find((candidate) => candidate.id === resolution.identity.id)
      : undefined);
  const identityKey =
    resolution.kind === 'mapped' ? resolution.identity.id : resolution.docsPath;
  const capability =
    resolution.kind === 'mapped'
      ? resolution.identity.topic
      : resolution.docsPath;
  const entryTitle =
    resolution.kind === 'mapped' ? resolution.identity.title : resolution.title;
  const contextLabel =
    resolution.kind === 'mapped'
      ? [
          PRODUCT_LABELS[resolution.identity.product] ??
            toLabel(resolution.identity.product),
          toLabel(resolution.identity.section),
          toLabel(resolution.identity.topic),
        ].join(' / ')
      : resolution.title;
  const isMobileModalActive = isNavigationOpen || isMobileOverlayPresent;
  const presentationCapability =
    presentation.kind === 'capability' ? presentation : null;

  const handleActiveUtilityChange = useCallback(
    (utility: CockpitControlPlaneProps['activeUtility']) => {
      setActiveUtility(utility);
      if (utility !== null && isTabletViewport()) {
        setIsTabletContextOpen(true);
      }
    },
    [setActiveUtility]
  );

  const controlPlaneProps = useMemo<
    Omit<CockpitControlPlaneProps, 'mobile' | 'onModeSelected' | 'onNavigate'>
  >(
    () => ({
      navigationTree,
      manifest,
      entry: mappedEntry,
      resolutionTitle: entryTitle,
      modeAvailability,
      modeNavigationLabel,
      contextPaneLabel,
      hostServices,
      activeMode,
      onModeChange: selectMode,
      activeUtility,
      onActiveUtilityChange: handleActiveUtilityChange,
      activityOpenCycle,
      unseenProblems,
      runtimeSnapshot: runtimeController.snapshot,
      events,
      expanded,
      onExpandedChange: setExpanded,
      onClearActivity: clearActivity,
      onRecheck: recheckRuntime,
      onReload: reloadRuntime,
      onOpenRuntime: openRuntime,
      onCopyDiagnostics: copyDiagnostics,
      trackNavigation,
      themeControl,
      renderContextPane,
      renderContextHeader,
    }),
    [
      activeMode,
      activeUtility,
      activityOpenCycle,
      unseenProblems,
      clearActivity,
      copyDiagnostics,
      entryTitle,
      events,
      expanded,
      handleActiveUtilityChange,
      hostServices,
      manifest,
      mappedEntry,
      modeAvailability,
      modeNavigationLabel,
      navigationTree,
      openRuntime,
      recheckRuntime,
      reloadRuntime,
      runtimeController.snapshot,
      selectMode,
      setExpanded,
      themeControl,
      renderContextPane,
      renderContextHeader,
      trackNavigation,
      contextPaneLabel,
    ]
  );

  const hasPersistentRunPanel = modeAvailability.Run.available;
  const focusWorkspacePanel = useCallback((mode: WorkspaceMode) => {
    const target = document.querySelector<HTMLElement>(
      `[data-workspace-panel-target="${mode}"]`
    );
    if (!target || target.closest('[inert]')) return;
    target.focus();
  }, []);
  const focusTabletUtilityInvoker = useCallback(
    (utility: Exclude<CockpitControlPlaneProps['activeUtility'], null>) => {
      document
        .querySelector<HTMLElement>(
          `[data-workspace-desktop-navigation] [data-workspace-utility="${utility}"] button`
        )
        ?.focus();
    },
    []
  );
  const handlePrimaryModeSelected = useCallback(
    (mode: WorkspaceMode) => {
      if (!isTabletViewport()) {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => focusWorkspacePanel(mode));
        } else {
          window.setTimeout(() => focusWorkspacePanel(mode), 0);
        }
        return;
      }
      setIsTabletContextOpen(false);
      if (isTabletContextPresent) {
        pendingTabletFocusModeRef.current = mode;
      } else if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => focusWorkspacePanel(mode));
      } else {
        window.setTimeout(() => focusWorkspacePanel(mode), 0);
      }
    },
    [focusWorkspacePanel, isTabletContextOpen, isTabletContextPresent]
  );
  useEffect(() => {
    if (isTabletContextPresent) return undefined;
    const mode = pendingTabletFocusModeRef.current;
    if (!mode) return undefined;
    pendingTabletFocusModeRef.current = null;
    const focus = () => focusWorkspacePanel(mode);
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(focus);
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(focus, 0);
    return () => window.clearTimeout(timer);
  }, [focusWorkspacePanel, isTabletContextPresent]);
  const isAdaptiveSurfaceActive =
    isMobileModalActive || isTabletContextOpen || isTabletContextPresent;
  useEffect(() => {
    onMobileModalPresenceChange?.(isMobileModalActive);
    return () => {
      if (isMobileModalActive) onMobileModalPresenceChange?.(false);
    };
  }, [isMobileModalActive, onMobileModalPresenceChange]);
  const panelHeading = (mode: WorkspaceMode) => (
    <h2
      className="workspace-panel-heading"
      data-workspace-panel-target={mode}
      tabIndex={-1}
    >
      {entryTitle} {mode}
    </h2>
  );

  return (
    <RootElement
      ref={rootRef}
      aria-label={ariaLabel}
      className="workspace-shell h-screen overflow-hidden"
      data-workspace-shell=""
      data-workspace-kind={resolution.kind}
      data-workspace-mode={activeMode}
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div
        className="workspace-shell-navigation min-h-0 overflow-hidden"
        data-workspace-desktop-navigation
        inert={isMobileModalActive ? true : undefined}
        aria-hidden={isMobileModalActive ? true : undefined}
      >
        <CockpitControlPlane
          {...controlPlaneProps}
          onModeSelected={handlePrimaryModeSelected}
        />
      </div>

      <MobileNavOverlay
        controlPlaneProps={controlPlaneProps}
        dialogLabel={mobileDialogLabel}
        title={mobileTitle}
        isOpen={isNavigationOpen}
        onClose={() => setIsNavigationOpen(false)}
        onPresenceChange={setIsMobileOverlayPresent}
        triggerRef={mobileNavigationTriggerRef}
        onFocusDestination={focusWorkspacePanel}
        onContextAction={onContextAction}
      />

      <MobileNavOverlay
        controlPlaneProps={controlPlaneProps}
        dialogLabel={`${mobileDialogLabel} context`}
        title={`${mobileTitle} context`}
        variant="tablet"
        controlPlaneLayout="pane"
        isOpen={isTabletContextOpen}
        onClose={() => setIsTabletContextOpen(false)}
        onPresenceChange={setIsTabletContextPresent}
        triggerRef={tabletContextTriggerRef}
        onFocusDestination={focusWorkspacePanel}
        onUtilityDismissed={focusTabletUtilityInvoker}
        onContextAction={onContextAction}
      />

      <section
        className="grid grid-rows-[auto_1fr] grid-cols-[minmax(0,1fr)] overflow-hidden bg-[var(--ds-surface)]"
        data-workspace-surface
        inert={isAdaptiveSurfaceActive ? true : undefined}
        aria-hidden={isAdaptiveSurfaceActive ? true : undefined}
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--ds-border)]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={mobileNavigationTriggerRef}
              className="workspace-mobile-navigation-trigger"
              onClick={() => setIsNavigationOpen(true)}
              aria-label="Open navigation"
              aria-expanded={isNavigationOpen}
              tabIndex={isMobileModalActive ? -1 : undefined}
            >
              <Menu size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              ref={tabletContextTriggerRef}
              className="workspace-tablet-context-trigger"
              onClick={() => setIsTabletContextOpen(true)}
              aria-label="Open context"
              aria-expanded={isTabletContextOpen}
              tabIndex={isTabletContextPresent ? -1 : undefined}
            >
              <Menu size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            {contextTrail && contextTrail.length > 0 ? (
              <nav aria-label="Breadcrumb" data-workspace-trail>
                <ol data-workspace-trail-list>
                  {contextTrail.map((crumb, index) => {
                    const isLast = index === contextTrail.length - 1;
                    const icon = crumb.icon ? (
                      <span data-workspace-trail-icon aria-hidden="true">
                        {crumb.icon}
                      </span>
                    ) : null;
                    return (
                      <li key={`${crumb.label}-${index}`}>
                        {crumb.href && !isLast ? (
                          <a href={crumb.href} data-workspace-trail-link>
                            {icon}
                            {crumb.label}
                          </a>
                        ) : (
                          <span
                            data-workspace-trail-current={isLast || undefined}
                            aria-current={isLast ? 'page' : undefined}
                          >
                            {icon}
                            {crumb.label}
                          </span>
                        )}
                        {isLast ? null : (
                          <span
                            data-workspace-trail-separator
                            aria-hidden="true"
                          >
                            /
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            ) : (
              <p className="text-[var(--ds-text-muted)] font-mono text-xs truncate">
                {contextLabel}
              </p>
            )}
          </div>
          {headerActions ? (
            <div className="shrink-0" data-workspace-header-actions>
              {headerActions}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 relative" data-workspace-panels>
          {hasPersistentRunPanel ? (
            <div
              className={
                'h-full ' +
                (activeMode === 'Run' ? '' : 'invisible absolute inset-0')
              }
              aria-hidden={activeMode === 'Run' ? undefined : true}
              data-workspace-panel="Run"
              role="region"
              aria-label="Run workspace panel"
            >
              {panelHeading('Run')}
              <WorkspacePanelBoundary
                mode="Run"
                resetKey={`${identityKey}:${runtimeController.targetGeneration}:${runtimeController.frameGeneration}`}
              >
                <RunMode
                  entryTitle={entryTitle}
                  runtimeUrl={runtimeController.validatedRuntimeUrl}
                  capabilitySlug={capability}
                  frameRef={runtimeController.frameRef}
                  frameGeneration={runtimeController.frameGeneration}
                  targetGeneration={runtimeController.targetGeneration}
                  onFrameLoad={runtimeController.onFrameLoad}
                  runtimePhase={runtimeController.snapshot.phase}
                  getSessionId={getSessionId}
                  telemetry={runtimeTelemetry}
                />
              </WorkspacePanelBoundary>
            </div>
          ) : null}

          {activeMode === 'Code' &&
          modeAvailability.Code.available &&
          presentationCapability ? (
            <div
              role="region"
              aria-label="Code workspace panel"
              className="h-full"
            >
              {panelHeading('Code')}
              <WorkspacePanelBoundary mode="Code" resetKey={identityKey}>
                <CodeMode
                  entryTitle={entryTitle}
                  codeAssetPaths={presentationCapability.codeAssetPaths}
                  backendAssetPaths={presentationCapability.backendAssetPaths}
                  codeFiles={contentBundle.codeFiles}
                  promptFiles={contentBundle.promptFiles}
                  capability={capability}
                />
              </WorkspacePanelBoundary>
            </div>
          ) : null}

          {activeMode === 'Docs' && modeAvailability.Docs.available ? (
            <div
              role="region"
              aria-label="Docs workspace panel"
              className="h-full"
            >
              {panelHeading('Docs')}
              <WorkspacePanelBoundary mode="Docs" resetKey={identityKey}>
                {docsSlot}
              </WorkspacePanelBoundary>
            </div>
          ) : null}

          {activeMode === 'API' &&
          modeAvailability.API.available &&
          presentationCapability ? (
            <div
              role="region"
              aria-label="API workspace panel"
              className="h-full"
            >
              {panelHeading('API')}
              <WorkspacePanelBoundary mode="API" resetKey={identityKey}>
                <ApiMode
                  docSections={contentBundle.docSections}
                  hasCodeFiles={Object.keys(contentBundle.codeFiles).length > 0}
                />
              </WorkspacePanelBoundary>
            </div>
          ) : null}
        </div>
      </section>
    </RootElement>
  );
}
