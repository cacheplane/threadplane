'use client';
import type { AgentSnapshot } from '@threadplane/core';

/** Whether a borrowed text-only snapshot is waiting for its first assistant text. */
export function isTyping(
  snapshot: Pick<AgentSnapshot, 'status' | 'messages'>
): boolean {
  if (snapshot.status !== 'running') return false;
  const last = snapshot.messages.at(-1);
  return (
    !last ||
    last.role === 'user' ||
    (last.role === 'assistant' && last.content.length === 0)
  );
}

/** Controlled waiting presentation; no session, execution or lifetime ownership. */
export interface TypingIndicatorProps {
  readonly active: boolean;
  readonly label?: string;
  readonly announce?: boolean;
  readonly className?: string;
}

/** Readable waiting label with decorative dots and optional polite announcement. */
export function TypingIndicator({
  active,
  label = 'Assistant is typing',
  announce = true,
  className,
}: TypingIndicatorProps) {
  if (!active) return null;
  return (
    <div
      className={['tp-typing-indicator', className].filter(Boolean).join(' ')}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? true : undefined}
    >
      <span className="tp-typing-indicator__label">{label}</span>
      <span className="tp-typing-indicator__dots">
        <span aria-hidden="true">·</span>
        <span aria-hidden="true">·</span>
        <span aria-hidden="true">·</span>
      </span>
    </div>
  );
}
