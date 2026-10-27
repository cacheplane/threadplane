'use client';

export interface ChatSidenavScrimProps {
  readonly open: boolean;
  readonly onDismiss: () => void;
  readonly label?: string;
  readonly className?: string;
}

/** Controlled backdrop; the owner decides whether to accept dismissal. */
export function ChatSidenavScrim({
  open,
  onDismiss,
  label = 'Close conversation navigation backdrop',
  className,
}: ChatSidenavScrimProps) {
  if (!open) return null;
  return (
    <button
      type="button"
      aria-label={label}
      className={['tp-chat', 'tp-chat-sidenav-scrim', className]
        .filter(Boolean)
        .join(' ')}
      onClick={onDismiss}
    />
  );
}
