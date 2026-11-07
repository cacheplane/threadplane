'use client';

import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Activity,
  BookOpen,
  Braces,
  Code2,
  Ellipsis,
  Play,
  Settings,
} from 'lucide-react';
import type { WorkspaceMode } from '@threadplane/cockpit-registry';
import type {
  WorkspaceCrumb,
  WorkspaceModeAvailabilityMap,
  WorkspaceUtility,
} from '../workspace-contracts';

const modes = [
  { label: 'Docs', icon: BookOpen },
  { label: 'Run', icon: Play },
  { label: 'Code', icon: Code2 },
  { label: 'API', icon: Braces },
] as const;

export function WorkspaceToolbar({
  activeMode,
  availability,
  modeLabel,
  onModeChange,
  onUtilityChange,
  utilityTriggerRef,
  unseenProblems,
  contextTrail,
  navigationTriggers,
  children,
}: {
  activeMode: WorkspaceMode;
  availability: WorkspaceModeAvailabilityMap;
  modeLabel: string;
  onModeChange: (mode: WorkspaceMode) => void;
  onUtilityChange: (utility: Exclude<WorkspaceUtility, null>) => void;
  utilityTriggerRef: RefObject<HTMLButtonElement | null>;
  unseenProblems: number;
  contextTrail?: readonly WorkspaceCrumb[];
  navigationTriggers: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <header data-workspace-toolbar>
      <div data-workspace-browse>{navigationTriggers}</div>
      <nav aria-label={modeLabel} data-workspace-toolbar-modes>
        {modes.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            data-workspace-toolbar-mode={label}
            aria-pressed={activeMode === label}
            aria-disabled={!availability[label].available || undefined}
            aria-describedby={
              !availability[label].available
                ? `${id}-${label}-reason`
                : undefined
            }
            title={availability[label].reason}
            onClick={() => {
              if (availability[label].available) onModeChange(label);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
            {!availability[label].available ? (
              <span
                className="workspace-panel-heading"
                id={`${id}-${label}-reason`}
              >
                {availability[label].reason ??
                  `${label} is unavailable for this page.`}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {contextTrail?.length ? (
        <nav aria-label="Documentation section" data-workspace-toolbar-context>
          <ol>
            {contextTrail.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? (
                  <a href={crumb.href}>{crumb.label}</a>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {children}
      <div
        ref={root}
        data-workspace-toolbar-tools
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setOpen(false);
        }}
      >
        <button
          ref={utilityTriggerRef}
          type="button"
          aria-label="Workspace tools"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Ellipsis size={18} aria-hidden="true" />
        </button>
        {open ? (
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-label="Workspace tools"
            // Safari does not focus buttons on pointer activation. Keep focus
            // in the menu until click runs so blur cannot remove the action.
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                }
                setOpen(false);
                utilityTriggerRef.current?.focus();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>('button') ??
                  []
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement
              );
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                  ? items.length - 1
                  : (current +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      items.length) %
                    items.length;
              items[next]?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onUtilityChange('activity');
              }}
            >
              <Activity size={17} aria-hidden="true" />
              Activity
              {unseenProblems > 0 ? (
                <span data-workspace-toolbar-unread>
                  {unseenProblems}
                  <span className="workspace-panel-heading">
                    {' '}
                    unread problems
                  </span>
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onUtilityChange('settings');
              }}
            >
              <Settings size={17} aria-hidden="true" />
              Settings
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
