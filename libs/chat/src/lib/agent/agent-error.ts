/**
 * The failure class of an {@link AgentError}, used to drive UI and retry logic:
 *
 * - `connection` — offline / DNS / connection refused / `fetch` failed. Retryable.
 * - `auth` — `401` / `403`; credentials or API key are wrong. Not retryable.
 * - `server` — a `5xx` (retryable) or a non-auth `4xx` like `400`/`404`/`429` (not retryable).
 * - `interrupted` — the stream closed mid-response after a run had started. Retryable only
 *   when `recovery` is `retry`; see {@link AgentRecovery}.
 * - `aborted` — the user pressed stop; treated as a graceful idle, not surfaced as an error.
 */
export type AgentErrorKind = 'connection' | 'auth' | 'server' | 'interrupted' | 'aborted';

/**
 * What the adapter can safely offer after an unexpectedly closed stream:
 *
 * - `retry` — the request is known not to have been dispatched. Re-running it
 *   cannot duplicate server-side work.
 * - `check` — the outcome is uncertain and the backend supports a read-only
 *   status check, so a caller may offer one.
 * - `none` — the outcome is uncertain and nothing can verify it. Explain, and
 *   offer no action.
 */
export type AgentRecovery = 'retry' | 'check' | 'none';

/** Human-facing copy per {@link AgentRecovery}, used for `interrupted` errors. */
export const AGENT_RECOVERY_MESSAGES: Record<AgentRecovery, string> = {
  retry: 'The response was interrupted before it started. Try again.',
  check: 'The connection dropped. The request may still have completed on the server.',
  none: 'The connection dropped. We could not confirm whether the request completed.',
};

/**
 * The second line of the `interrupted` banner, per {@link AgentRecovery}. Each
 * entry is written to be read as a continuation of the matching
 * {@link AGENT_RECOVERY_MESSAGES} sentence, never on its own: the `check` entry
 * supplies only the action that follows, and the `none` entry only its cost.
 * Adapters set `AgentError.detail` from here so every transport says the same
 * thing. Keep the pairs in sync when editing either table.
 */
export const AGENT_RECOVERY_DETAILS: Record<AgentRecovery, string> = {
  retry: 'Nothing reached the server, so nothing was duplicated.',
  check: 'Checking will tell you whether it did.',
  none: 'Trying again could repeat it.',
};

/**
 * Structured, classified failure surfaced on `Agent.error`. Extends `Error`, so
 * existing `.message` / `instanceof Error` reads keep working — but adds a
 * machine-readable {@link AgentErrorKind}, a `retryable` flag, an optional HTTP
 * `status`, and the original `cause`.
 *
 * You rarely construct one yourself; adapters normalize raw failures via
 * {@link toAgentError}. Read it off the agent to render legible, cause-specific UI:
 *
 * @example
 * ```ts
 * const err = agent.error();            // AgentError | undefined
 * if (err) {
 *   console.warn(err.message);          // legible, per-kind copy
 *   if (err.kind === 'auth') showApiKeyHelp();
 *   if (err.retryable) showRetryButton(); // → agent.retry()
 * }
 * ```
 */
export class AgentError extends Error {
  /** The classified failure type. See {@link AgentErrorKind}. */
  readonly kind: AgentErrorKind;
  /** Whether retrying the same request could plausibly succeed:
   *  `connection` | `server` (5xx) → true; `auth` | `aborted` | non-auth `4xx` → false.
   *  For `interrupted`, this tracks {@link AgentRecovery}: true only when `recovery`
   *  is `retry`, because a dispatched request may already have run on the server. */
  readonly retryable: boolean;
  /** The HTTP status code when the failure came from an HTTP response. */
  readonly status?: number;
  /** The original raw error this was classified from, preserved for debugging/telemetry. */
  override readonly cause: unknown;
  /**
   * The recovery action the adapter can justify. Only set on `interrupted`
   * errors; always `undefined` for every other {@link AgentErrorKind}.
   */
  readonly recovery?: AgentRecovery;
  /**
   * A short sentence explaining the uncertainty. Adapters set this whenever
   * `recovery` is `check` or `none`, and leave it undefined otherwise. It is
   * the only thing a caller can show when `recovery` is `check` but the agent
   * exposes no `checkStatus`, so omitting it there leaves the reader with a
   * bare error and no path forward.
   */
  readonly detail?: string;

  constructor(init: {
    kind: AgentErrorKind;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
    recovery?: AgentRecovery;
    detail?: string;
  }) {
    super(init.message);
    this.name = 'AgentError';
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.cause = init.cause;
    this.recovery = init.recovery;
    this.detail = init.detail;
  }
}

/**
 * Default, human-facing copy per {@link AgentErrorKind}. Used as the message when
 * a classified error has no better text. Override by mapping `error.kind` to your
 * own strings in a custom error component.
 *
 * For `interrupted` errors, prefer `AGENT_RECOVERY_MESSAGES[recovery]` once
 * `recovery` is known — it carries the correct per-case copy. The `interrupted`
 * entry here is only the fallback for errors constructed without a recovery value.
 */
export const AGENT_ERROR_MESSAGES: Record<AgentErrorKind, string> = {
  connection: "Can't reach the server. Check your connection and try again.",
  auth: 'Authentication failed. Check your API key or credentials.',
  server: 'The server ran into an error. You can try again.',
  interrupted: 'The response was interrupted. Try again.',
  aborted: 'Stopped.',
};
