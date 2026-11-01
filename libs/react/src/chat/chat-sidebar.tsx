'use client';
import type { ReactNode } from 'react';
import { ChatPopup, type ChatPopupProps } from './chat-popup.js';

/** Adds page content and optional content-pushing layout to the controlled chat popup shell. */
export interface ChatSidebarProps extends ChatPopupProps {
  readonly pageContent?: ReactNode;
  readonly pushContent?: boolean;
}

/** A controlled full-height non-modal chat shell with persistent children. */
export function ChatSidebar({
  className,
  open,
  pageContent,
  pushContent = false,
  ...props
}: ChatSidebarProps) {
  return (
    <div
      className={[
        'tp-chat-sidebar-layout',
        open && pushContent && 'tp-chat-sidebar-layout--push',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tp-chat-sidebar-layout__page">{pageContent}</div>
      <ChatPopup
        {...props}
        open={open}
        className={[
          'tp-chat-sidebar',
          open && 'tp-chat-sidebar--open',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
    </div>
  );
}
