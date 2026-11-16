'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

/** One explicitly authored presentation action; IDs must be unique per card. The first action is the primary one. */
export interface ApprovalCardAction {
  readonly id: string;
  /** Name the action, such as "Save note", and the alternative, such as "Don't save". */
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

/** Borrowed decision presentation; matching, commands and pending state belong to the app. */
export interface ApprovalCardProps {
  readonly children: ReactNode;
  readonly actions: readonly ApprovalCardAction[];
  /** The request in plain words, such as "Save the comparison note to your workspace?" */
  readonly title?: string;
  readonly disabled?: boolean;
  /**
   * Marks an action that cannot be undone: danger tint, the lead "This can't be undone." and a danger
   * primary button. Name the exact effect in the first action, such as "Delete 12 drafts".
   */
  readonly destructive?: boolean;
  /** Moves focus to the first action when the card appears. Defaults to true. */
  readonly autoFocus?: boolean;
  /**
   * `inline` (default) renders the panel where the card is placed. `dialog` shows the same content
   * in a modal over the page for as long as the card is mounted: the rest of the page is inert,
   * and focus returns to where it was when the card unmounts.
   */
  readonly presentation?: 'inline' | 'dialog';
  /**
   * Dialog only: called when the user presses Escape. The dialog stays open until you unmount the
   * card, so answer the request here, usually the same way as your declining action. Without it,
   * Escape does nothing.
   */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

/**
 * Inline approval panel with an app-authored body and explicit actions: a warning panel led by
 * "Waiting for your approval.", or a danger panel for a destructive action. Place it at the end of
 * the transcript, for example through `Chat`'s `approval` slot. With `presentation="dialog"` the
 * same content opens as a modal instead.
 */
export function ApprovalCard({
  children,
  actions,
  title = 'Approval request',
  disabled = false,
  destructive = false,
  autoFocus = true,
  presentation = 'inline',
  onDismiss,
  className,
}: ApprovalCardProps) {
  const heading = useId();
  const firstAction = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const modal = presentation === 'dialog';
  // Before the focus effect below, so the first action is focusable inside the open modal.
  useIsomorphicLayoutEffect(() => {
    const panel = dialog.current;
    if (!modal || !panel) return;
    // Escape asks the app; only unmounting the card closes it.
    const cancel = (event: Event) => {
      event.preventDefault();
      dismiss.current?.();
    };
    panel.addEventListener('cancel', cancel);
    if (!panel.open) panel.showModal();
    return () => {
      panel.removeEventListener('cancel', cancel);
      if (panel.open) panel.close();
    };
  }, [modal]);
  useEffect(() => {
    // Once, when the card appears.
    if (autoFocus) firstAction.current?.focus();
  }, []);
  const Panel = modal ? 'dialog' : 'section';
  return (
    <Panel
      ref={modal ? dialog : undefined}
      className={[
        'tp-approval-card',
        'tp-status-panel',
        modal && 'tp-approval-card--dialog',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-tone={destructive ? 'danger' : 'warning'}
      aria-labelledby={heading}
    >
      <p className="tp-status-panel__lead">
        {destructive ? "This can't be undone." : 'Waiting for your approval.'}
      </p>
      <h2 id={heading} className="tp-approval-card__title">
        {title}
      </h2>
      <div className="tp-approval-card__body">{children}</div>
      <div className="tp-approval-card__actions">
        {actions.map((action, index) => (
          <button
            key={action.id}
            ref={index === 0 ? firstAction : undefined}
            type="button"
            className={[
              'tp-approval-card__action',
              index === 0 &&
                (destructive
                  ? 'tp-approval-card__action--danger'
                  : 'tp-approval-card__action--primary'),
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={disabled || action.disabled}
            onClick={() => {
              if (!disabled && !action.disabled) action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** The one-line record an answered approval leaves in the transcript: "Approved: Save note". */
export interface ApprovalRecordProps {
  readonly verdict: 'approved' | 'declined';
  /** What was approved, such as "Save note". Omit for just "Approved" or "Declined". */
  readonly label?: string;
  readonly className?: string;
}

/**
 * One answered approval for `MessageList`'s and `Chat`'s `approvalRecords`: rendered as an
 * `ApprovalRecord` directly after the row whose id is `afterId`, usually the assistant message the
 * approval followed. Without `afterId`, or when that row is gone, it renders after the last row.
 */
export interface ApprovalRecordEntry extends ApprovalRecordProps {
  readonly afterId?: string;
}

/**
 * Groups records by the row they follow; a record whose `afterId` names no present row goes under
 * `undefined`, rendered after the last row.
 * @internal
 */
export function approvalRecordsByRow(
  records: readonly ApprovalRecordEntry[] | undefined,
  rowIds: Iterable<string>
): ReadonlyMap<string | undefined, readonly ApprovalRecordEntry[]> {
  const after = new Map<string | undefined, ApprovalRecordEntry[]>();
  if (!records?.length) return after;
  const ids = new Set(rowIds);
  for (const record of records) {
    const anchor =
      record.afterId !== undefined && ids.has(record.afterId)
        ? record.afterId
        : undefined;
    after.set(anchor, [...(after.get(anchor) ?? []), record]);
  }
  return after;
}

/** Renders the records grouped under one anchor. @internal */
export function renderApprovalRecords(
  grouped: ReadonlyMap<string | undefined, readonly ApprovalRecordEntry[]>,
  anchor: string | undefined
): ReactNode {
  return grouped
    .get(anchor)
    ?.map((record, index) => (
      <ApprovalRecord
        key={`record-${index}`}
        verdict={record.verdict}
        label={record.label}
        className={record.className}
      />
    ));
}

/** Muted transcript line for an answered approval. The app decides when to render it. */
export function ApprovalRecord({
  verdict,
  label,
  className,
}: ApprovalRecordProps) {
  const verb = verdict === 'approved' ? 'Approved' : 'Declined';
  return (
    <p
      className={['tp-approval-record', className].filter(Boolean).join(' ')}
      data-verdict={verdict}
    >
      {label?.trim() ? `${verb}: ${label.trim()}` : verb}
    </p>
  );
}
