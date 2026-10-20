'use client';
import { ChatPopup, type ChatPopupProps } from './chat-popup.js';

export type ChatSidebarProps = ChatPopupProps;

/** A controlled full-height non-modal chat shell with persistent children. */
export function ChatSidebar({ className, open, ...props }: ChatSidebarProps) {
  return (
    <ChatPopup
      {...props}
      open={open}
      className={['tp-chat-sidebar', open && 'tp-chat-sidebar--open', className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
