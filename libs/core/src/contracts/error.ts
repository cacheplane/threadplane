import type { PlainValue } from './tool.js';

/** Adapter-classified failure category for connection, authentication, server, or execution termination errors. */
export type AgentErrorKind =
  | 'connection'
  | 'auth'
  | 'server'
  | 'interrupted'
  | 'aborted';
/** Suggested recovery: retry a submission, reconcile its status, or offer no recovery action. */
export type AgentRecovery = 'retry' | 'check' | 'none';

/**
 * What a failure was classified from, described as plain data for logs,
 * telemetry and debug views. Published beside the error, in a snapshot's
 * `errorDiagnostic`, so `AgentError` stays a display projection. It is a description, never the thrown value: no
 * prototype, no functions, and nested causes described the same way.
 */
export interface AgentErrorDiagnostic {
  /** The thrown value's `name`, such as `TypeError`. */
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
  /** A machine code the thrown value carried, such as `ECONNRESET`. */
  readonly code?: string | number;
  /** An HTTP status the thrown value carried. */
  readonly status?: number;
  /** Any further plain data the thrown value carried, or the value itself when it was plain data. */
  readonly data?: PlainValue;
  /** The thrown value's own `cause`, described the same way. */
  readonly cause?: AgentErrorDiagnostic;
}

/** Plain display projection. Classification and raw causes remain with the adapter. */
export interface AgentError {
  readonly kind: AgentErrorKind;
  readonly message: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly recovery?: AgentRecovery;
  readonly detail?: string;
}

const MAX_DEPTH = 6;

function plain(value: unknown, depth: number, seen: Set<object>): PlainValue {
  if (value === null || value === undefined) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value) || depth >= MAX_DEPTH) return '[omitted]';
  seen.add(value);
  let copy: PlainValue;
  if (Array.isArray(value))
    copy = Object.freeze(value.map((item) => plain(item, depth + 1, seen)));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype)
      copy = Object.prototype.toString.call(value);
    else {
      const entries: Record<string, PlainValue> = {};
      for (const [key, item] of Object.entries(value))
        if (item !== undefined && typeof item !== 'function')
          entries[key] = plain(item, depth + 1, seen);
      copy = Object.freeze(entries);
    }
  }
  seen.delete(value);
  return copy;
}

function describe(
  cause: unknown,
  depth: number,
  seen: Set<object>
): AgentErrorDiagnostic {
  if (cause === null || typeof cause !== 'object')
    return Object.freeze({ message: String(cause) });
  if (seen.has(cause) || depth >= MAX_DEPTH)
    return Object.freeze({ message: '[omitted]' });
  const source = cause as Record<string, unknown>;
  const described: {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;
    status?: number;
    data?: PlainValue;
    cause?: AgentErrorDiagnostic;
  } = {
    message:
      typeof source['message'] === 'string'
        ? source['message']
        : cause instanceof Error
        ? String(cause)
        : 'A value that is not an error was thrown.',
  };
  if (typeof source['name'] === 'string') described.name = source['name'];
  if (typeof source['stack'] === 'string') described.stack = source['stack'];
  const code = source['code'];
  if (typeof code === 'string' || typeof code === 'number')
    described.code = code;
  if (typeof source['status'] === 'number') described.status = source['status'];
  seen.add(cause);
  const rest: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source))
    if (!['name', 'message', 'stack', 'code', 'status', 'cause'].includes(key))
      rest[key] = item;
  const data = plain(
    'data' in rest && Object.keys(rest).length === 1 ? rest['data'] : rest,
    depth + 1,
    seen
  );
  if (
    data !== undefined &&
    !(typeof data === 'object' && data !== null && !Object.keys(data).length)
  )
    described.data = data;
  if (source['cause'] !== undefined)
    described.cause = describe(source['cause'], depth + 1, seen);
  seen.delete(cause);
  return Object.freeze(described);
}

/**
 * Describes any thrown value as frozen plain data for a snapshot's
 * `errorDiagnostic`.
 * Reads `name`, `message`, `stack`, `code`, `status` and `cause` where they
 * exist, copies other plain fields into `data`, and replaces functions, class
 * instances and cycles with short text. Never throws for a value it can read.
 */
export function projectErrorDiagnostic(cause: unknown): AgentErrorDiagnostic {
  return describe(cause, 0, new Set());
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
