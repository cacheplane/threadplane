'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getRouteDefaultMode,
  type CockpitManifestEntry,
  type WorkspaceMode,
  type WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import type {
  ContentBundle,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import {
  parseControlPlaneMode,
  useControlPlanePreferences,
} from '@threadplane/ui-react';
import type {
  RuntimeFrameTelemetry,
  TrackModeChange,
  TrackNavigation,
  TrackRuntimeAction,
  TrackRuntimeTransition,
  WorkspaceSessionIdProvider,
} from './host-services';
import {
  activityReducer,
  countUnseenProblems,
  createSessionActivityEvent,
  type ActivityMode,
  type RuntimeActivityInput,
} from './runtime/session-activity';
import { copyRuntimeDiagnostics } from './runtime/runtime-diagnostics';
import { useEffectiveRuntimeTarget } from './runtime/runtime-target-provider';
import { useRuntimeController } from './runtime/use-runtime-controller';
import type {
  WorkspaceContextValue,
  WorkspaceHostServices,
  WorkspaceNavigationRequest,
  WorkspaceModeAvailabilityMap,
  WorkspaceUtility,
} from './workspace-contracts';
import { readWorkspaceModeQuery } from './workspace-navigation';

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export interface WorkspaceProviderProps {
  readonly resolution: WorkspaceResolution;
  readonly presentation: WorkspacePresentation;
  readonly contentBundle: ContentBundle;
  /** Path represented by resolution; popstate for any other path belongs to the host router. */
  readonly routePath: string;
  readonly requestedMode: string | null;
  readonly docsSlot?: ReactNode;
  /** Host content enables these modes even without a mapped example. */
  readonly runFallbackSlot?: ReactNode;
  readonly apiSlot?: ReactNode;
  readonly defaultMode?: WorkspaceMode;
  readonly pushIdentity: (
    href: string,
    options?: Pick<WorkspaceNavigationRequest, 'restoreFocus'>
  ) => void;
  readonly pushMode: (mode: WorkspaceMode) => void;
  readonly replaceMode: (mode: WorkspaceMode) => void;
  readonly resolveIdentityHref?: (entry: CockpitManifestEntry) => string;
  readonly getSessionId: WorkspaceSessionIdProvider;
  readonly runtimeTelemetry?: RuntimeFrameTelemetry;
  readonly trackNavigation?: TrackNavigation;
  readonly trackModeChange?: TrackModeChange;
  readonly trackRuntimeAction?: TrackRuntimeAction;
  readonly trackRuntimeTransition?: TrackRuntimeTransition;
  readonly children: ReactNode;
}

const modeSpecificReason = (
  mode: Exclude<WorkspaceMode, 'Docs'>,
  resolution: WorkspaceResolution
): string =>
  resolution.kind === 'docs-only'
    ? `${mode} is unavailable because this page has no workspace capability.`
    : `${mode} is unavailable for ${resolution.identity.title}.`;

export function getWorkspaceModeAvailability(
  resolution: WorkspaceResolution,
  presentation: WorkspacePresentation
): WorkspaceModeAvailabilityMap {
  if (resolution.kind === 'docs-only') {
    return {
      Docs: { available: true },
      Run: { available: false, reason: modeSpecificReason('Run', resolution) },
      Code: {
        available: false,
        reason: modeSpecificReason('Code', resolution),
      },
      API: { available: false, reason: modeSpecificReason('API', resolution) },
    };
  }

  const descriptorBacked = presentation.kind === 'capability';
  const isAvailable = (mode: WorkspaceMode): boolean =>
    resolution.identity.availableModes.includes(mode) &&
    (mode === 'Docs' || descriptorBacked);
  const unavailable = (mode: WorkspaceMode) => ({
    available: false as const,
    reason:
      mode === 'Docs'
        ? `Docs is unavailable for ${resolution.identity.title}.`
        : modeSpecificReason(mode, resolution),
  });

  return {
    Docs: isAvailable('Docs') ? { available: true } : unavailable('Docs'),
    Run: isAvailable('Run') ? { available: true } : unavailable('Run'),
    Code: isAvailable('Code') ? { available: true } : unavailable('Code'),
    API: isAvailable('API') ? { available: true } : unavailable('API'),
  };
}

const routeIdentityKey = (resolution: WorkspaceResolution): string =>
  resolution.kind === 'mapped'
    ? resolution.identity.id
    : `docs:${resolution.docsPath}`;

const normalizedMode = (
  rawMode: string | null,
  resolution: WorkspaceResolution,
  availability: WorkspaceModeAvailabilityMap,
  defaultMode?: WorkspaceMode
): WorkspaceMode => {
  const requested = parseControlPlaneMode(rawMode);
  if (requested && availability[requested].available) return requested;
  return defaultMode && availability[defaultMode].available
    ? defaultMode
    : getRouteDefaultMode(resolution);
};

const createLocalActivityInput = (
  capability: string,
  input:
    | { kind: 'mode_changed'; mode: ActivityMode }
    | { kind: 'diagnostics_copied' | 'diagnostics_copy_failed' }
): RuntimeActivityInput => ({
  id: globalThis.crypto.randomUUID(),
  at: new Date().toISOString(),
  capability,
  ...input,
});

export function WorkspaceProvider({
  resolution,
  presentation,
  contentBundle,
  routePath,
  requestedMode,
  docsSlot = null,
  runFallbackSlot,
  apiSlot,
  defaultMode,
  pushIdentity,
  pushMode,
  replaceMode,
  resolveIdentityHref = (entry) => entry.docsPath,
  getSessionId,
  runtimeTelemetry,
  trackNavigation,
  trackModeChange,
  trackRuntimeAction,
  trackRuntimeTransition,
  children,
}: WorkspaceProviderProps) {
  const preferences = useControlPlanePreferences('cockpit');
  const modeAvailability = useMemo(
    () => ({
      ...getWorkspaceModeAvailability(resolution, presentation),
      ...(runFallbackSlot != null ? { Run: { available: true } } : {}),
      ...(apiSlot != null ? { API: { available: true } } : {}),
    }),
    [presentation, resolution, runFallbackSlot, apiSlot]
  );
  const [activeMode, setActiveMode] = useState<WorkspaceMode>(() =>
    normalizedMode(requestedMode, resolution, modeAvailability, defaultMode)
  );
  const [activeUtility, setActiveUtilityState] =
    useState<WorkspaceUtility>(null);
  const [activityOpenCycle, setActivityOpenCycle] = useState(0);
  const [seenActivityCount, setSeenActivityCount] = useState(0);
  const [events, dispatchActivity] = useReducer(activityReducer, []);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const lastNormalizationRef = useRef<string | null>(null);
  const capability =
    resolution.kind === 'mapped'
      ? resolution.identity.topic
      : resolution.docsPath;
  const runtimeAdapter =
    resolution.kind === 'mapped' ? resolution.identity.runtimeAdapter : 'none';
  const effectiveRuntimeTarget = useEffectiveRuntimeTarget(runtimeAdapter);

  const appendActivity = useCallback((input: RuntimeActivityInput) => {
    dispatchActivity({
      type: 'add',
      event: createSessionActivityEvent(input),
    });
  }, []);

  const handleTerminalTransition = useCallback(
    (transition: Parameters<TrackRuntimeTransition>[0]) => {
      trackRuntimeTransition?.(transition);
    },
    [trackRuntimeTransition]
  );

  const runtimeController = useRuntimeController({
    runtimeUrl: modeAvailability.Run.available
      ? contentBundle.runtimeUrl
      : null,
    capability,
    effectiveTarget: effectiveRuntimeTarget,
    onActivity: appendActivity,
    onTerminalTransition: handleTerminalTransition,
  });

  const applyRouteMode = useCallback(
    (rawMode: string | null, normalizeUrl: boolean) => {
      const requested = parseControlPlaneMode(rawMode);
      const nextMode = normalizedMode(
        rawMode,
        resolution,
        modeAvailability,
        defaultMode
      );
      setActiveMode(nextMode);
      if (
        normalizeUrl &&
        rawMode !== null &&
        (!requested || !modeAvailability[requested].available)
      ) {
        const normalizationKey = `${routeIdentityKey(
          resolution
        )}:${rawMode}:${nextMode}`;
        if (lastNormalizationRef.current !== normalizationKey) {
          lastNormalizationRef.current = normalizationKey;
          replaceMode(nextMode);
        }
      } else {
        lastNormalizationRef.current = null;
      }
    },
    [modeAvailability, replaceMode, resolution, defaultMode]
  );

  const resolutionKey = routeIdentityKey(resolution);
  useEffect(() => {
    applyRouteMode(requestedMode, true);
  }, [applyRouteMode, requestedMode, resolutionKey]);

  useEffect(() => {
    const restoreHistoryMode = () => {
      const location = new URL(window.location.href);
      const resolvedPathname = new URL(routePath, window.location.origin)
        .pathname;
      if (location.pathname !== resolvedPathname) return;
      const rawMode = readWorkspaceModeQuery(location.searchParams);
      applyRouteMode(rawMode, true);
    };
    window.addEventListener('popstate', restoreHistoryMode);
    return () => window.removeEventListener('popstate', restoreHistoryMode);
  }, [applyRouteMode, routePath]);

  const hostServices = useMemo<WorkspaceHostServices>(
    () => ({
      resolveEntryHref: resolveIdentityHref,
      navigate: ({ path, mode, history = 'push', restoreFocus }) => {
        if (mode) {
          if (history === 'replace') replaceMode(mode);
          else pushMode(mode);
          return;
        }
        pushIdentity(path, { restoreFocus });
      },
    }),
    [pushIdentity, pushMode, replaceMode, resolveIdentityHref]
  );

  const selectMode = useCallback(
    (mode: WorkspaceMode) => {
      if (!modeAvailability[mode].available) return;
      setActiveUtilityState(null);
      if (mode === activeMode) return;
      setActiveMode(mode);
      appendActivity(
        createLocalActivityInput(capability, {
          kind: 'mode_changed',
          mode,
        })
      );
      trackModeChange?.({
        capability,
        fromMode: activeMode,
        toMode: mode,
      });
      pushMode(mode);
    },
    [
      activeMode,
      appendActivity,
      capability,
      modeAvailability,
      pushMode,
      trackModeChange,
    ]
  );

  const setActiveUtility = useCallback(
    (utility: WorkspaceUtility) => {
      if (utility === 'activity' && activeUtility !== 'activity') {
        setActivityOpenCycle((cycle) => cycle + 1);
        setSeenActivityCount(events.length);
      }
      setActiveUtilityState(utility);
    },
    [activeUtility, events.length]
  );

  const clearActivity = useCallback(() => {
    dispatchActivity({ type: 'clear' });
    setSeenActivityCount(0);
  }, []);

  const recheckRuntime = useCallback(() => {
    const stateBefore = runtimeController.snapshot.phase;
    runtimeController.recheck();
    trackRuntimeAction?.({
      capability,
      action: 'recheck',
      stateBefore,
      outcome: 'requested',
    });
    return 'requested' as const;
  }, [capability, runtimeController, trackRuntimeAction]);

  const reloadRuntime = useCallback(() => {
    const stateBefore = runtimeController.snapshot.phase;
    runtimeController.reload();
    trackRuntimeAction?.({
      capability,
      action: 'reload',
      stateBefore,
      outcome: 'requested',
    });
    return 'requested' as const;
  }, [capability, runtimeController, trackRuntimeAction]);

  const openRuntime = useCallback(() => {
    const stateBefore = runtimeController.snapshot.phase;
    const outcome = runtimeController.open();
    trackRuntimeAction?.({
      capability,
      action: 'open',
      stateBefore,
      outcome,
    });
    return outcome;
  }, [capability, runtimeController, trackRuntimeAction]);

  const copyDiagnostics = useCallback(async () => {
    const snapshot = runtimeController.snapshot;
    const outcome = await copyRuntimeDiagnostics(
      snapshot,
      events,
      undefined,
      runtimeController.runtimeContext
    );
    appendActivity(
      createLocalActivityInput(capability, {
        kind:
          outcome === 'succeeded'
            ? 'diagnostics_copied'
            : 'diagnostics_copy_failed',
      })
    );
    trackRuntimeAction?.({
      capability,
      action: 'copy_diagnostics',
      stateBefore: snapshot.phase,
      outcome,
    });
    return outcome;
  }, [
    appendActivity,
    capability,
    events,
    runtimeController.snapshot,
    trackRuntimeAction,
  ]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      resolution,
      presentation,
      contentBundle,
      docsSlot,
      runFallbackSlot,
      apiSlot,
      activeMode,
      modeAvailability,
      activeUtility,
      activityOpenCycle,
      unseenProblems: countUnseenProblems(events, seenActivityCount),
      events,
      expanded: preferences.expanded,
      hydrated: preferences.hydrated,
      hostServices,
      runtimeController,
      mobileNavigationTriggerRef,
      getSessionId,
      runtimeTelemetry,
      trackNavigation,
      trackModeChange,
      selectMode,
      setActiveUtility,
      setExpanded: preferences.setExpanded,
      clearActivity,
      recheckRuntime,
      reloadRuntime,
      openRuntime,
      copyDiagnostics,
    }),
    [
      activeMode,
      activeUtility,
      activityOpenCycle,
      seenActivityCount,
      clearActivity,
      contentBundle,
      copyDiagnostics,
      docsSlot,
      runFallbackSlot,
      apiSlot,
      events,
      getSessionId,
      hostServices,
      modeAvailability,
      openRuntime,
      preferences.expanded,
      preferences.hydrated,
      preferences.setExpanded,
      presentation,
      recheckRuntime,
      reloadRuntime,
      resolution,
      runtimeController,
      runtimeTelemetry,
      selectMode,
      setActiveUtility,
      trackModeChange,
      trackNavigation,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return value;
}
