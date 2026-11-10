'use client';
import type { ReactNode } from 'react';

/** Meaning of a status panel: a failure, something waiting on the person, a confirmed write, or plain information. */
export type StatusPanelTone = 'danger' | 'warning' | 'success' | 'neutral';
/** A lead sentence, detail and actions for something the person must read or act on. */
export interface StatusPanelProps {
  /** Defaults to `neutral`. The lead sentence carries the meaning; colour only reinforces it. */
  readonly tone?: StatusPanelTone;
  /** Short statement ending in a period, such as "Saved." */
  readonly lead?: ReactNode;
  /** Detail, in ordinary text. */
  readonly children?: ReactNode;
  /** Buttons or links shown after the detail. Name the action and its object. */
  readonly actions?: ReactNode;
  /** Use `alert` for failures only; receipts and approvals are announced politely by their owner. */
  readonly role?: 'alert' | 'status';
  readonly className?: string;
}
/** The one container for a failed call, a run error, an approval or a receipt. Displays only; it runs nothing. */
export function StatusPanel({
  tone = 'neutral',
  lead,
  children,
  actions,
  role,
  className,
}: StatusPanelProps) {
  return (
    <div
      className={['tp-status-panel', className].filter(Boolean).join(' ')}
      data-tone={tone}
      role={role}
    >
      {lead !== undefined && lead !== null && lead !== false && (
        <p className="tp-status-panel__lead">{lead}</p>
      )}
      {children}
      {actions !== undefined && actions !== null && actions !== false && (
        <div className="tp-status-panel__actions">{actions}</div>
      )}
    </div>
  );
}
