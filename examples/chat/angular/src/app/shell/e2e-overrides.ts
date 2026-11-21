import type { LangGraphClientOptions } from '@threadplane/langgraph';

/**
 * Test-only escape hatch for the LangGraph SDK client tuning.
 *
 * A session's own client never retries a request unless it is told to: a
 * retried request could start a second run, and a session that may retry
 * cannot regenerate an answer. The demo therefore runs with no retries, and a
 * connection failure surfaces at once.
 *
 * e2e specs that force a connection failure state that budget explicitly with
 * `localStorage['THREADPLANE_E2E_MAX_RETRIES'] = '0'` (via
 * `page.addInitScript`, before the app bootstraps). A spec may also set a
 * higher number to exercise the SDK's backoff.
 *
 * Returns `undefined` when the flag is absent — i.e. always in real use — so
 * the session's default applies. Never reads anything in production.
 */
const E2E_MAX_RETRIES_KEY = 'THREADPLANE_E2E_MAX_RETRIES';

export function e2eClientOptions(): LangGraphClientOptions | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(E2E_MAX_RETRIES_KEY);
  } catch {
    return undefined; // storage blocked (e.g. sandboxed iframe) — ignore
  }
  if (raw === null || raw.trim() === '') return undefined;
  const maxRetries = Number(raw);
  if (!Number.isInteger(maxRetries) || maxRetries < 0) return undefined;
  return { maxRetries };
}
