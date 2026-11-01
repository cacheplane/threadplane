/** Adapter-classified failure category for connection, authentication, server, or execution termination errors. */
export type AgentErrorKind =
  | 'connection'
  | 'auth'
  | 'server'
  | 'interrupted'
  | 'aborted';
/** Suggested recovery: retry a submission, reconcile its status, or offer no recovery action. */
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
