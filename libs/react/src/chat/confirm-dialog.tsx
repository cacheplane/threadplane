'use client';
import { useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import {
  dialogPresentation as presentation,
  availableDialogTarget as available,
} from './internal/dialog-presentation.js';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: 'normal' | 'destructive';
  readonly pending?: boolean;
  readonly className?: string;
  readonly returnFocusTo?: HTMLElement | null;
}

/** Controlled synchronous intent dialog; callers own operations and pending state. */
export function ConfirmDialog({
  open,
  title,
  onConfirm,
  onCancel,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'normal',
  pending = false,
  className,
  returnFocusTo,
}: ConfirmDialogProps) {
  const id = useId();
  const marker = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onConfirm, onCancel, pending });
  callbacks.current = { onConfirm, onCancel, pending };
  const target = useRef(returnFocusTo);
  target.current = returnFocusTo;
  const [portal, setPortal] = useState<{
    document: Document;
    style: CSSProperties;
    invoker: HTMLElement | null;
  } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const anchor = marker.current;
    if (!open || !anchor) {
      setPortal(null);
      return;
    }
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    const candidate = target.current ?? doc.activeElement;
    setPortal({
      document: doc,
      style: presentation(anchor),
      invoker:
        win && candidate instanceof win.HTMLElement && available(candidate, doc)
          ? candidate
          : null,
    });
  }, [open]);

  useIsomorphicLayoutEffect(() => {
    const panel = dialog.current;
    if (!portal || !panel) return;
    const doc = portal.document;
    const win = doc.defaultView;
    let ownedFocus = false;
    let escapeHeld = false;
    let spaceTarget: EventTarget | null = null;
    let spaceBlocked = false;
    const releaseKeyboard = () => {
      escapeHeld = false;
      spaceTarget = null;
      spaceBlocked = false;
    };
    const visibility = () => {
      if (doc.visibilityState === 'hidden') releaseKeyboard();
    };
    const focus = () => {
      ownedFocus = panel.contains(doc.activeElement);
    };
    const keydown = (event: KeyboardEvent) => {
      // The modal owns keyboard bubbling; native interior Tab order is preserved.
      event.stopPropagation();
      const claimed = event.defaultPrevented;
      const ignored =
        event.repeat || event.isComposing || event.keyCode === 229;
      if (
        event.key === 'Tab' &&
        !claimed &&
        !event.isComposing &&
        event.keyCode !== 229
      ) {
        const buttons = Array.from(
          panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        );
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (
          doc.activeElement === panel ||
          (event.shiftKey
            ? doc.activeElement === first
            : doc.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // A fresh nonrepeat press supersedes a release lost to blur or another
        // modal; the latch only deduplicates this press's native cancel event.
        if (!claimed && !ignored) {
          escapeHeld = true;
          callbacks.current.onCancel();
        }
      } else if (event.key === ' ') {
        // Native buttons activate Space on release. An ignored press must also
        // own its release, even if composition has ended by then.
        if (!event.repeat) {
          spaceTarget = event.target;
          spaceBlocked = claimed || ignored;
        } else spaceBlocked = true;
        if (spaceBlocked) event.preventDefault();
      } else if (event.key === 'Enter' && ignored) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') escapeHeld = false;
      if (event.key === ' ') {
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.isComposing ||
          event.keyCode === 229 ||
          spaceBlocked ||
          spaceTarget !== event.target
        )
          event.preventDefault();
        spaceTarget = null;
        spaceBlocked = false;
      }
    };
    const nativeCancel = (event: Event) => {
      const claimed = event.defaultPrevented;
      event.preventDefault();
      event.stopPropagation();
      if (!claimed && !escapeHeld) callbacks.current.onCancel();
    };
    panel.addEventListener('keydown', keydown);
    panel.addEventListener('keyup', keyup);
    panel.addEventListener('cancel', nativeCancel);
    doc.addEventListener('focusin', focus);
    doc.addEventListener('visibilitychange', visibility);
    win?.addEventListener('blur', releaseKeyboard);
    panel.showModal();
    cancel.current?.focus();
    focus();
    return () => {
      const active = doc.activeElement;
      const restore =
        panel.contains(active) || (active === doc.body && ownedFocus);
      doc.removeEventListener('focusin', focus);
      doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', releaseKeyboard);
      panel.removeEventListener('keydown', keydown);
      panel.removeEventListener('keyup', keyup);
      panel.removeEventListener('cancel', nativeCancel);
      if (panel.open) panel.close();
      if (restore && portal.invoker && available(portal.invoker, doc))
        portal.invoker.focus();
    };
  }, [portal]);

  return (
    <>
      <span ref={marker} hidden aria-hidden="true" />
      {portal &&
        createPortal(
          <dialog
            ref={dialog}
            role="alertdialog"
            aria-modal="true"
            aria-busy={pending || undefined}
            aria-labelledby={`${id}-title`}
            aria-describedby={body ? `${id}-body` : undefined}
            dir={portal.style.direction === 'rtl' ? 'rtl' : 'ltr'}
            className={['tp-confirm-dialog', className]
              .filter(Boolean)
              .join(' ')}
            style={portal.style}
            onClick={(event) => {
              event.stopPropagation();
              if (
                event.defaultPrevented ||
                event.target !== event.currentTarget
              )
                return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                callbacks.current.onCancel();
            }}
          >
            <h2 id={`${id}-title`}>{title}</h2>
            {body && <p id={`${id}-body`}>{body}</p>}
            <div className="tp-confirm-dialog__actions">
              <button
                ref={cancel}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!event.defaultPrevented) callbacks.current.onCancel();
                }}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className={
                  tone === 'destructive'
                    ? 'tp-confirm-dialog__confirm tp-confirm-dialog__confirm--destructive'
                    : 'tp-confirm-dialog__confirm'
                }
                disabled={pending}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!event.defaultPrevented && !callbacks.current.pending)
                    callbacks.current.onConfirm();
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </dialog>,
          portal.document.body
        )}
    </>
  );
}
