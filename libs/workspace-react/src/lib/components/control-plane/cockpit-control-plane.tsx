'use client';

import React, { useRef } from 'react';
import type { CockpitManifestEntry } from '@threadplane/cockpit-registry';
import {
  Activity as ActivityIcon,
  BookOpen,
  Braces,
  Code2,
  Play,
  Settings,
} from 'lucide-react';
import {
  ControlPlanePane,
  ControlPlaneRail,
  ControlPlaneRailItem,
  ControlPlaneUtilityPanel,
  type ControlPlaneMode,
} from '@threadplane/ui-react';
import type { NavigationProduct } from '@threadplane/cockpit-shell';
import { PRODUCT_LABELS } from '../../navigation-labels';
import type { SessionActivityEvent } from '../../runtime/session-activity';
import { useRuntimeTargetView } from '../../runtime/runtime-target-provider';
import {
  runtimeRailStatus,
  type RuntimeSnapshot,
} from '../../runtime/runtime-state';
import type { TrackNavigation } from '../../host-services';
import type {
  WorkspaceHostServices,
  WorkspaceModeAvailabilityMap,
} from '../../workspace-contracts';
import { CockpitSidebar } from '../sidebar/cockpit-sidebar';
import { LanguagePicker } from '../sidebar/language-picker';
import { ActivityPanel } from './activity-panel';
import { ActivityPanelBoundary } from './activity-panel-boundary';
import { RuntimeSection } from './runtime-section';
import { RuntimeTargetSettings } from './runtime-target-settings';

const MODES: Array<{
  label: ControlPlaneMode;
  icon: typeof Play;
}> = [
  { label: 'Docs', icon: BookOpen },
  { label: 'Run', icon: Play },
  { label: 'Code', icon: Code2 },
  { label: 'API', icon: Braces },
];

type RuntimeCommandOutcome = void | 'requested' | 'succeeded' | 'failed';
type RuntimeCommand = () =>
  | RuntimeCommandOutcome
  | PromiseLike<RuntimeCommandOutcome>;

export type CockpitUtility = 'activity' | 'settings' | null;

export interface WorkspaceContextPaneOptions {
  readonly mobile: boolean;
  readonly onNavigate?: () => void;
  readonly onAction?: (action: string) => void;
}

export type WorkspaceContextPaneRenderer = (
  options: WorkspaceContextPaneOptions
) => React.ReactNode;

export interface CockpitControlPlaneProps {
  navigationTree: NavigationProduct[];
  manifest: CockpitManifestEntry[];
  entry?: CockpitManifestEntry;
  resolutionTitle?: string;
  modeAvailability?: WorkspaceModeAvailabilityMap;
  modeNavigationLabel?: string;
  contextPaneLabel?: string;
  hostServices: WorkspaceHostServices;
  activeMode: ControlPlaneMode;
  onModeChange(mode: ControlPlaneMode): void;
  activeUtility: CockpitUtility;
  onActiveUtilityChange(utility: CockpitUtility): void;
  activityOpenCycle: number;
  runtimeSnapshot: RuntimeSnapshot;
  events: readonly SessionActivityEvent[];
  unseenProblems: number;
  expanded: Record<string, boolean>;
  onExpandedChange(key: string, open: boolean): void;
  onClearActivity(): void;
  onRecheck: RuntimeCommand;
  onReload: RuntimeCommand;
  onOpenRuntime: RuntimeCommand;
  onCopyDiagnostics: RuntimeCommand;
  mobile?: boolean;
  layout?: 'full' | 'pane';
  onModeSelected?: (mode: ControlPlaneMode) => void;
  onNavigate?: () => void;
  onUtilityDismissed?: (utility: Exclude<CockpitUtility, null>) => void;
  renderContextPane?: WorkspaceContextPaneRenderer;
  onContextAction?: (action: string) => void;
  trackNavigation?: TrackNavigation;
  themeControl?: React.ReactNode;
}

function focusUtilityInvoker(ref: React.RefObject<HTMLSpanElement | null>) {
  ref.current?.querySelector('button')?.focus();
}

export function CockpitControlPlane({
  navigationTree,
  manifest,
  entry,
  resolutionTitle,
  modeAvailability = {
    Docs: { available: true },
    Run: { available: true },
    Code: { available: true },
    API: { available: true },
  },
  modeNavigationLabel = 'Workspace modes',
  contextPaneLabel = 'Workspace context',
  hostServices,
  activeMode,
  onModeChange,
  activeUtility,
  onActiveUtilityChange,
  activityOpenCycle,
  runtimeSnapshot,
  events,
  unseenProblems,
  expanded,
  onExpandedChange,
  onClearActivity,
  onRecheck,
  onReload,
  onOpenRuntime,
  onCopyDiagnostics,
  mobile = false,
  layout = 'full',
  onModeSelected,
  onNavigate,
  onUtilityDismissed,
  renderContextPane,
  onContextAction,
  trackNavigation,
  themeControl,
}: CockpitControlPlaneProps) {
  const activityRef = useRef<HTMLSpanElement>(null);
  const settingsRef = useRef<HTMLSpanElement>(null);
  const railStatus = runtimeRailStatus(runtimeSnapshot.phase);
  const runtimeAdapter = entry?.runtimeAdapter ?? 'none';
  const runtimeTargetView = useRuntimeTargetView(runtimeAdapter);
  const runtimeOrigin =
    runtimeSnapshot.target.kind === 'configured'
      ? runtimeSnapshot.target.origin
      : null;
  const attention = unseenProblems > 0;
  const activityLabel = attention
    ? `Activity, ${unseenProblems} unread problem${
        unseenProblems === 1 ? '' : 's'
      }`
    : 'Activity';
  const product = entry
    ? PRODUCT_LABELS[entry.product] ?? entry.product
    : 'Documentation';
  const language =
    entry?.runtimeAdapter === 'none'
      ? 'Browser'
      : entry?.language === 'typescript'
      ? 'TypeScript'
      : 'Python';
  const currentCapability = entry?.topic ?? resolutionTitle ?? 'Documentation';

  const closeUtility = (
    utility: Exclude<CockpitUtility, null>,
    invokerRef: React.RefObject<HTMLSpanElement | null>
  ) => {
    if (activeUtility !== utility) return;
    onActiveUtilityChange(null);
    if (invokerRef.current) focusUtilityInvoker(invokerRef);
    else onUtilityDismissed?.(utility);
  };

  const selectUtility = (
    utility: Exclude<CockpitUtility, null>,
    invokerRef: React.RefObject<HTMLSpanElement | null>
  ) => {
    if (activeUtility === utility) {
      closeUtility(utility, invokerRef);
      return;
    }
    onActiveUtilityChange(utility);
  };

  const selectMode = (mode: ControlPlaneMode) => {
    if (activeUtility !== null) {
      onActiveUtilityChange(null);
    }
    onModeChange(mode);
    onModeSelected?.(mode);
  };

  let paneContent: React.ReactNode;
  if (activeUtility === 'activity') {
    paneContent = (
      <ActivityPanelBoundary
        resetKey={activityOpenCycle}
        onClose={() => closeUtility('activity', activityRef)}
      >
        <ActivityPanel
          events={events}
          currentCapability={currentCapability}
          attention={attention}
          onClose={() => closeUtility('activity', activityRef)}
          onClear={onClearActivity}
        />
      </ActivityPanelBoundary>
    );
  } else if (activeUtility === 'settings') {
    paneContent = (
      <ControlPlaneUtilityPanel
        title="Settings"
        onClose={() => closeUtility('settings', settingsRef)}
      >
        <div className="workspace-control-plane-setting">
          <span>Language</span>
          {entry ? (
            <LanguagePicker
              manifest={manifest}
              entry={entry}
              hostServices={hostServices}
              onNavigate={onNavigate}
            />
          ) : (
            <span>Not available</span>
          )}
        </div>
        <RuntimeTargetSettings
          adapter={runtimeAdapter}
          runtimeOrigin={runtimeOrigin}
        />
        {themeControl ? (
          <div className="workspace-control-plane-setting">
            <span>Theme</span>
            {themeControl}
          </div>
        ) : null}
      </ControlPlaneUtilityPanel>
    );
  } else if (activeMode === 'Docs' && renderContextPane) {
    paneContent = renderContextPane({
      mobile,
      onNavigate,
      onAction: onContextAction,
    });
  } else {
    paneContent = (
      <>
        {entry ? (
          <>
            <CockpitSidebar
              navigationTree={navigationTree}
              entry={entry}
              hostServices={hostServices}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
              onNavigate={onNavigate}
              trackNavigation={trackNavigation}
            />
            <RuntimeSection
              snapshot={runtimeSnapshot}
              product={product}
              language={language}
              open={expanded.Runtime ?? true}
              onOpenChange={(open) => onExpandedChange('Runtime', open)}
              onRecheck={onRecheck}
              onReload={onReload}
              onOpenRuntime={onOpenRuntime}
              onCopyDiagnostics={onCopyDiagnostics}
              runtimeTargetView={runtimeTargetView}
            />
          </>
        ) : (
          <p data-workspace-docs-only-context>
            This docs page has no mapped workspace capability.
          </p>
        )}
      </>
    );
  }

  return (
    <div
      className="workspace-control-plane"
      data-workspace-control-plane
      data-mobile={mobile || undefined}
    >
      {layout === 'full' ? (
        <ControlPlaneRail
          label={modeNavigationLabel}
          primary={MODES.map(({ label, icon: Icon }) => (
            <ControlPlaneRailItem
              key={label}
              label={label}
              icon={<Icon size={18} aria-hidden="true" />}
              active={label === activeMode}
              disabled={!modeAvailability[label].available}
              disabledReason={modeAvailability[label].reason}
              onSelect={() => selectMode(label)}
              status={label === 'Run' ? railStatus ?? undefined : undefined}
            />
          ))}
          utilities={
            <>
              <span
                ref={activityRef}
                className="workspace-control-plane-utility-anchor"
                data-workspace-utility="activity"
              >
                <ControlPlaneRailItem
                  label={activityLabel}
                  icon={
                    <span data-workspace-activity-icon>
                      <ActivityIcon size={18} aria-hidden="true" />
                      {attention ? (
                        <span
                          aria-hidden="true"
                          data-workspace-activity-attention
                        />
                      ) : null}
                    </span>
                  }
                  iconOnly
                  active={activeUtility === 'activity'}
                  onSelect={() => selectUtility('activity', activityRef)}
                />
              </span>
              <span
                ref={settingsRef}
                className="workspace-control-plane-utility-anchor"
                data-workspace-utility="settings"
              >
                <ControlPlaneRailItem
                  label="Settings"
                  icon={<Settings size={18} aria-hidden="true" />}
                  iconOnly
                  active={activeUtility === 'settings'}
                  onSelect={() => selectUtility('settings', settingsRef)}
                />
              </span>
            </>
          }
        />
      ) : null}

      <ControlPlanePane label={contextPaneLabel}>
        {paneContent}
      </ControlPlanePane>
    </div>
  );
}
