import { randomUUID } from 'node:crypto';

let cached: string | null = null;

/** Return a lazily generated `anon_` UUID cached in this module's memory without persistence. */
export function getAnonId(): string {
  if (!cached) cached = `anon_${randomUUID()}`;
  return cached;
}

// @internal — for tests only
export function _resetAnonIdForTesting(): void {
  cached = null;
}
