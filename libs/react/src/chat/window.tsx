'use client';
import type { ReactNode } from 'react';

/** The three regions of a chat window; the owner supplies their content. */
export interface ChatWindowProps {
  /** A fixed bar above the body. Left out, the body gets top spacing instead. */
  readonly header?: ReactNode;
  /** A fixed region below the body, usually the composer. */
  readonly footer?: ReactNode;
  readonly className?: string;
  /** The body, which takes the remaining height. */
  readonly children?: ReactNode;
}

/**
 * A full-height column with an optional header, a body that takes the
 * remaining space and an optional footer. The body does not scroll by itself:
 * put the scrolling list inside it. A soft fade sits above the footer so
 * content does not end at a hard edge. It owns no state.
 */
export function ChatWindow({
  header,
  footer,
  className,
  children,
}: ChatWindowProps) {
  return (
    <div className={['tp-chat-window', className].filter(Boolean).join(' ')}>
      {header === undefined ? null : (
        <div className="tp-chat-window__header">{header}</div>
      )}
      <div className="tp-chat-window__body">{children}</div>
      {footer === undefined ? null : (
        <div className="tp-chat-window__footer">
          <div className="tp-chat-window__fade" aria-hidden="true" />
          {footer}
        </div>
      )}
    </div>
  );
}
