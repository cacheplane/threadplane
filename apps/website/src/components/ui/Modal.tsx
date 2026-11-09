'use client';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Ignored when `labelledBy` is set. */
  label: string;
  /**
   * Id of an element (typically the dialog's own heading) that already
   * renders the same text as `label`. When set, the dialog is labelled via
   * `aria-labelledby` instead of duplicating the string into `aria-label`.
   */
  labelledBy?: string;
  children: ReactNode;
  /** Optional class for the inner frame (size). */
  frameClassName?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"])';

function isTabStop(element: HTMLElement) {
  if (element.tabIndex < 0 || element.closest('[hidden], [inert]'))
    return false;
  for (
    let parent: HTMLElement | null = element;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = parent.querySelector(':scope > summary');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

/**
 * Minimal modal: role=dialog, focus trap, Esc, backdrop click, body scroll
 * lock, focus restore. Extracted from DemoModal (2026-09-02).
 */
export function Modal({
  open,
  onClose,
  label,
  labelledBy,
  children,
  frameClassName,
}: ModalProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = Array.from(
        frameRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      ).filter(isTabStop);
      if (!f || f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      {...(labelledBy
        ? { 'aria-labelledby': labelledBy }
        : { 'aria-label': label })}
      data-ui="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={frameRef} data-ui="modal-frame" className={frameClassName}>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-ui="modal-close"
        >
          &#215;
        </button>
        {children}
      </div>
    </div>
  );
}
