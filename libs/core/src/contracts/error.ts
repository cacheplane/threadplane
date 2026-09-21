export type AgentErrorKind =
  | 'connection'
  | 'auth'
  | 'server'
  | 'interrupted'
  | 'aborted';
export type AgentRecovery = 'retry' | 'check' | 'none';

/** Plain display projection. Classification and raw causes remain with the adapter. */
export interface AgentError {
  readonly kind: AgentErrorKind;
  readonly message: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly recovery?: AgentRecovery;
  readonly detail?: string;
}

/** Copies an already classified failure, retaining neither its prototype nor cause. */
export function projectAgentError(error: AgentError): AgentError {
  return Object.freeze({
    kind: error.kind,
    message: error.message,
    status: error.status,
    retryable: error.retryable,
    recovery: error.recovery,
    detail: error.detail,
  });
}
