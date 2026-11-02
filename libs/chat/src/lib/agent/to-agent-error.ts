import { AgentError, AGENT_ERROR_MESSAGES, type AgentErrorKind } from './agent-error';

/**
 * Whether `raw` represents an abort (a `DOMException`/`Error` named `AbortError`,
 * or an abort-ish message). Shared by the runtime adapters and {@link toAgentError}
 * so a user-requested stop settles to idle instead of surfacing as an error.
 *
 * @param raw - Any thrown/rejected value.
 * @returns `true` if it looks like an abort.
 */
export function isAbortError(raw: unknown): boolean {
  return raw instanceof Error && (raw.name === 'AbortError' || /\babort/i.test(raw.message));
}

/**
 * Reads a numeric status from `raw.status` or `raw.cause.status` only.
 * No text parsing — structured fields only.
 */
function structuredStatus(raw: unknown): number | undefined {
  const obj = raw as { status?: unknown; cause?: { status?: unknown } } | null;
  const direct = typeof obj?.status === 'number' ? obj.status : undefined;
  const viaCause = typeof obj?.cause?.status === 'number' ? obj!.cause!.status : undefined;
  if (direct !== undefined) return direct;
  if (viaCause !== undefined) return viaCause;
  return undefined;
}

function isConnectionError(raw: unknown): boolean {
  if (!(raw instanceof Error)) return false;
  return /failed to fetch|networkerror|econnrefused|enotfound|network request failed|load failed/i.test(
    `${raw.name} ${raw.message}`,
  );
}

/**
 * Extracts an HTTP status code from a message string, but ONLY when the token
 * is unambiguously HTTP-shaped:
 *  - `HTTP/502`, `HTTP 404`, `HTTP404`
 *  - `status: 503`, `status=503`, `code: 404`
 *
 * Bare 3-digit numbers (e.g. model version strings like "gpt-500") are NOT matched.
 */
function httpStatusFromMessage(raw: unknown): number | undefined {
  const msg =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
  if (!msg) return undefined;

  // "HTTP 500", "HTTP/500", "HTTP500"
  const httpToken = /\bHTTP[ /]?(\d{3})\b/i.exec(msg);
  if (httpToken) return Number(httpToken[1]);

  // "status: 503", "status=503", "status 503" (up to 4 non-digit chars between keyword and digits)
  // Also matches "code: 404", "code=404", etc.
  const prefixed = /\b(?:status|code)\b\D{0,4}(\d{3})\b/i.exec(msg);
  if (prefixed) return Number(prefixed[1]);

  return undefined;
}

function make(kind: AgentErrorKind, retryable: boolean, raw: unknown, status?: number, message?: string): AgentError {
  return new AgentError({ kind, retryable, status, cause: raw, message: message ?? AGENT_ERROR_MESSAGES[kind] });
}

function classifyByStatus(status: number, raw: unknown): AgentError {
  if (status === 401 || status === 403) return make('auth', false, raw, status);
  if (status >= 500) return make('server', true, raw, status);
  if (status >= 400) return make('server', false, raw, status, `The request was rejected (HTTP ${status}).`);
  // Stray 2xx/3xx from a status field — treat as unknown transient failure, no status.
  return make('server', true, raw, undefined, 'Something went wrong. You can try again.');
}

/**
 * Classify any raw error into a structured {@link AgentError}.
 *
 * Resolution order (first match wins): an existing `AgentError` is returned
 * unchanged (idempotent) → a user abort → a structured `status`/`cause.status`
 * → network/connection markers → an HTTP-shaped status in the message → a
 * `server` + retryable fallback. The original error is always preserved on
 * `cause`. Runtime adapters call this before setting `Agent.error`; custom
 * backends can call it too (or throw an `AgentError` directly).
 *
 * @param raw - Any thrown/rejected value — an `Error`, a `{ status }` object, a string, etc.
 * @returns The classified {@link AgentError} (kind, retryable, status?, cause).
 * @example
 * ```ts
 * const e = toAgentError(new Error('HTTP 500: Internal Server Error'));
 * e.kind;      // 'server'
 * e.retryable; // true
 * e.status;    // 500
 * ```
 */
export function toAgentError(raw: unknown): AgentError {
  if (raw instanceof AgentError) return raw;
  if (isAbortError(raw)) return make('aborted', false, raw);

  // 1. Structured status (authoritative): raw.status or raw.cause.status.
  const structured = structuredStatus(raw);
  if (structured !== undefined) return classifyByStatus(structured, raw);

  // 2. Network/connection markers are definitive — before any loose text parsing.
  if (isConnectionError(raw)) return make('connection', true, raw);

  // 3. Best-effort: only an HTTP-shaped status token in the message counts.
  const httpStatus = httpStatusFromMessage(raw);
  if (httpStatus !== undefined) return classifyByStatus(httpStatus, raw);

  // 4. Fallback: unknown failure, assume transient.
  const msg = raw instanceof Error && raw.message ? raw.message : 'Something went wrong. You can try again.';
  return make('server', true, raw, undefined, msg);
}
