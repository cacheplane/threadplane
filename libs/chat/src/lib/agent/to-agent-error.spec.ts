import { describe, it, expect } from 'vitest';
import { AgentError, AGENT_RECOVERY_MESSAGES, type AgentRecovery } from './agent-error';
import { toAgentError, isAbortError } from './to-agent-error';

describe('toAgentError', () => {
  it('classifies HTTP 500 message as server + retryable + status', () => {
    const e = toAgentError(new Error('HTTP 500: Internal Server Error'));
    expect(e).toBeInstanceOf(AgentError);
    expect(e.kind).toBe('server'); expect(e.retryable).toBe(true); expect(e.status).toBe(500);
  });
  it('classifies 401 as auth + not retryable', () => {
    const e = toAgentError(new Error('HTTP 401: Unauthorized'));
    expect(e.kind).toBe('auth'); expect(e.retryable).toBe(false); expect(e.status).toBe(401);
  });
  it('classifies non-auth 4xx as server + not retryable', () => {
    const e = toAgentError(new Error('HTTP 404: Not Found'));
    expect(e.kind).toBe('server'); expect(e.retryable).toBe(false); expect(e.status).toBe(404);
  });
  it('classifies fetch failure as connection + retryable', () => {
    const e = toAgentError(new TypeError('Failed to fetch'));
    expect(e.kind).toBe('connection'); expect(e.retryable).toBe(true);
  });
  it('classifies AbortError as aborted + not retryable', () => {
    const ab = new Error('The operation was aborted'); ab.name = 'AbortError';
    const e = toAgentError(ab);
    expect(e.kind).toBe('aborted'); expect(e.retryable).toBe(false);
    expect(isAbortError(ab)).toBe(true);
  });
  it('preserves cause and is idempotent', () => {
    const raw = new Error('HTTP 500: boom');
    const once = toAgentError(raw);
    expect(once.cause).toBe(raw);
    expect(toAgentError(once)).toBe(once);
  });
  it('falls back to server + retryable for unknown shapes', () => {
    const e = toAgentError({ weird: true });
    expect(e.kind).toBe('server'); expect(e.retryable).toBe(true);
  });
  it('reads a structured status off the error/cause', () => {
    const e = toAgentError({ status: 503, message: 'Service Unavailable' });
    expect(e.kind).toBe('server'); expect(e.status).toBe(503); expect(e.retryable).toBe(true);
  });

  // NEW: bare 3-digit tokens in model names must NOT yield a bogus status
  it('does NOT extract status from a bare 3-digit model version string', () => {
    const e = toAgentError(new Error('model gpt-500 is not available'));
    expect(e.kind).toBe('server');
    expect(e.retryable).toBe(true);
    expect(e.status).toBeUndefined();
  });

  // NEW: connection detection must fire BEFORE loose text parsing
  it('classifies "Failed to fetch (502 upstream)" as connection, not server', () => {
    const e = toAgentError(new TypeError('Failed to fetch (502 upstream)'));
    expect(e.kind).toBe('connection');
    expect(e.retryable).toBe(true);
  });

  // NEW: structured cause.status path
  it('reads structured status via cause.status', () => {
    const e = toAgentError({ cause: { status: 403 } });
    expect(e.kind).toBe('auth');
    expect(e.status).toBe(403);
    expect(e.retryable).toBe(false);
  });
});

describe('AgentError recovery', () => {
  it('defaults recovery and detail to undefined', () => {
    const err = new AgentError({ kind: 'server', message: 'boom', retryable: true });
    expect(err.recovery).toBeUndefined();
    expect(err.detail).toBeUndefined();
  });

  it('carries an explicit recovery and detail', () => {
    const err = new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES.check,
      retryable: false,
      recovery: 'check',
      detail: 'The reservation may already exist.',
    });
    expect(err.recovery).toBe('check');
    expect(err.detail).toBe('The reservation may already exist.');
    expect(err.retryable).toBe(false);
  });

  it('has distinct copy for each recovery value', () => {
    const values: AgentRecovery[] = ['retry', 'check', 'none'];
    const copy = values.map(value => AGENT_RECOVERY_MESSAGES[value]);
    expect(new Set(copy).size).toBe(3);
    for (const line of copy) expect(line.length).toBeGreaterThan(0);
  });

  it('leaves toAgentError classification untouched', () => {
    expect(toAgentError(new Error('HTTP 500')).recovery).toBeUndefined();
    expect(toAgentError(new Error('HTTP 401')).recovery).toBeUndefined();
  });
});
