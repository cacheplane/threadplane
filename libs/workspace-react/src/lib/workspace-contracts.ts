import type { ReactNode, RefObject } from 'react';
import type {
  CockpitManifestEntry,
  WorkspaceMode,
  WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import type {
  ContentBundle,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import type {
  RuntimeFrameTelemetry,
  TrackModeChange,
  TrackNavigation,
  WorkspaceSessionIdProvider,
} from './host-services';
import type { RuntimeController } from './runtime-contracts';
import type { SessionActivityEvent } from './runtime/session-activity';

export interface WorkspaceNavigationRequest {
  readonly path: string;
  readonly mode?: WorkspaceMode;
  readonly history?: 'push' | 'replace';
  readonly restoreFocus?: 'mobile-navigation-trigger' | 'workspace-panel';
}

export interface WorkspaceHostServices {
  resolveEntryHref(entry: CockpitManifestEntry): string;
  navigate(request: WorkspaceNavigationRequest): void;
}

export type WorkspaceUtility = 'activity' | 'settings' | null;

export interface WorkspaceModeAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export type WorkspaceModeAvailabilityMap = Readonly<
  Record<WorkspaceMode, WorkspaceModeAvailability>
>;

export interface WorkspaceContextValue {
  readonly resolution: WorkspaceResolution;
  readonly presentation: WorkspacePresentation;
  readonly contentBundle: ContentBundle;
  readonly docsSlot: ReactNode;
  readonly runFallbackSlot?: ReactNode;
  readonly apiSlot?: ReactNode;
  readonly activeMode: WorkspaceMode;
  readonly modeAvailability: WorkspaceModeAvailabilityMap;
  readonly activeUtility: WorkspaceUtility;
  readonly activityOpenCycle: number;
  readonly unseenProblems: number;
  readonly events: readonly SessionActivityEvent[];
  readonly expanded: Record<string, boolean>;
  readonly hydrated: boolean;
  readonly hostServices: WorkspaceHostServices;
  readonly runtimeController: RuntimeController;
  readonly mobileNavigationTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly getSessionId: WorkspaceSessionIdProvider;
  readonly runtimeTelemetry?: RuntimeFrameTelemetry;
  readonly trackNavigation?: TrackNavigation;
  readonly trackModeChange?: TrackModeChange;
  selectMode(mode: WorkspaceMode): void;
  setActiveUtility(utility: WorkspaceUtility): void;
  setExpanded(section: string, open: boolean): void;
  clearActivity(): void;
  recheckRuntime(): 'requested';
  reloadRuntime(): 'requested';
  openRuntime(): 'requested' | 'failed';
  copyDiagnostics(): Promise<'succeeded' | 'failed'>;
}

/**
 * One rung of the shell header's location trail.
 *
 * A rung with no `href` is plain text. That is not an oversight: the docs
 * tree has no section index route, so its section rung has nowhere to point,
 * and inventing a URL for it would 404.
 */
export interface WorkspaceCrumb {
  readonly label: string;
  readonly href?: string;
  /**
   * Decorative adornment rendered before the label — a product or library
   * mark. Purely visual: the label already names the thing, so the shell
   * hides it from assistive tech.
   */
  readonly icon?: ReactNode;
}
