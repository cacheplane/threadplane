'use client';
import { useId, useRef, type ReactNode } from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

export interface ChatPopupProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly launcherLabel?: string;
  readonly closeLabel?: string;
  readonly closeOnEscape?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** A controlled non-modal shell. Its children retain their state while hidden. */
export function ChatPopup({
  open,
  onOpenChange,
  title,
  launcherLabel = 'Chat',
  closeLabel = 'Close chat',
  closeOnEscape = true,
  className,
  children,
}: ChatPopupProps) {
  const id = useId();
  const panelId = `${id}-dialog`;
  const titleId = `${id}-title`;
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      close.current?.focus();
    } else {
      const document = panel.current?.ownerDocument;
      const active = document?.activeElement;
      if (
        active &&
        (panel.current?.contains(active) || active === document?.body)
      ) {
        launcher.current?.focus();
      }
    }
  }, [open]);

  return (
    <div
      className={['tp-chat', 'tp-chat-popup', className]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        ref={launcher}
        type="button"
        className="tp-chat-popup__launcher"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        {launcherLabel}
      </button>
      <section
        ref={panel}
        id={panelId}
        className="tp-chat-popup__panel"
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleId}
        hidden={!open}
        inert={!open}
        onKeyDown={(event) => {
          if (
            !open ||
            !closeOnEscape ||
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
      >
        <header className="tp-chat-popup__header">
          <h2 id={titleId} className="tp-chat-popup__title">
            {title}
          </h2>
          <button
            ref={close}
            type="button"
            className="tp-chat-popup__close"
            onClick={() => onOpenChange(false)}
          >
            {closeLabel}
          </button>
        </header>
        <div className="tp-chat-popup__body">{children}</div>
      </section>
    </div>
  );
}
