'use client';
import type { AgentError } from '@threadplane/core';

/** Displays an already classified error and explicit application-owned recovery intents. */
export interface ChatErrorProps {
  /** Borrowed display projection; nullish errors render nothing. */
  readonly error: AgentError | null | undefined;
  /** Application-owned retry request; never inferred from a session or draft. */
  readonly onRetry?: () => void;
  /** Application-owned status reconciliation request. */
  readonly onCheckStatus?: () => void;
  /** Retains the appropriate action while preventing activation. */
  readonly disabled?: boolean;
  /** Additional class names for the alert. */
  readonly className?: string;
}

/** Passive, literal error notice with at most one supported recovery action. */
export function ChatError({
  error,
  onRetry,
  onCheckStatus,
  disabled,
  className,
}: ChatErrorProps) {
  if (error == null) return null;
  const retry =
    error.retryable &&
    (error.recovery === 'retry' || error.recovery === undefined);
  const action =
    error.recovery === 'check' ? onCheckStatus : retry ? onRetry : undefined;
  return (
    <div
      role="alert"
      className={['tp-chat-error', className].filter(Boolean).join(' ')}
    >
      <p className="tp-chat-error__message">{error.message}</p>
      {action && (
        <button type="button" disabled={disabled} onClick={() => action()}>
          {error.recovery === 'check' ? 'Check status' : 'Retry response'}
        </button>
      )}
      {error.detail && <p className="tp-chat-error__detail">{error.detail}</p>}
    </div>
  );
}
