import { expect } from 'vitest';
import type { LangGraphSnapshot } from '../langgraph-snapshot';

/** The error a session publishes when a history read fails. */
export const LOAD_ERROR = {
  kind: 'server',
  message: 'The conversation could not be loaded.',
  retryable: false,
  recovery: 'none',
} as const;

/**
 * A failed history read changes two things: the status is `error` and the
 * error says the conversation could not be loaded. Every other published
 * field keeps the reference it had, and nothing describes what was thrown.
 */
export function expectFailedLoad(
  after: LangGraphSnapshot,
  before: LangGraphSnapshot
): void {
  expect(after.status).toBe('error');
  expect(after.error).toEqual(LOAD_ERROR);
  expect(after.errorDiagnostic).toBeUndefined();
  const left = after as unknown as Record<string, unknown>;
  const right = before as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
    if (key !== 'status' && key !== 'error')
      expect(left[key], key).toBe(right[key]);
}
