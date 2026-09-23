#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const MAX_REASON_CHARS = 300;

/**
 * The error Claude Code reports when an execution fails, e.g. "API Error: 400
 * ... credit balance is too low" or "Invalid API key". Without it every
 * failure reads identically, and a revoked key, an empty balance and a retired
 * model are indistinguishable from the job log.
 *
 * Only for a result that reports is_error: true. A finished review's `result`
 * is the review itself, which this script must never print. The text is
 * collapsed to one line, bounded, and anything key-shaped is redacted.
 */
function errorReason(result) {
  if (result?.is_error !== true || typeof result.result !== 'string') return '';
  return result.result
    .replace(/\s+/g, ' ')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]')
    .trim()
    .slice(0, MAX_REASON_CHARS);
}

// The pinned action considers subtype alone, even when is_error is true.
// Inspect its documented execution_file without logging the raw transcript.
try {
  const messages = JSON.parse(
    readFileSync(process.env.CLAUDE_EXECUTION_FILE, 'utf8')
  );
  const result = Array.isArray(messages) ? messages.at(-1) : undefined;
  if (
    result?.type !== 'result' ||
    result.subtype !== 'success' ||
    result.is_error !== false
  ) {
    console.error(
      'Claude review execution failed or did not finish. No completed review is verified.'
    );
    const reason = errorReason(result);
    if (reason) console.error(`Reason: ${reason}`);
    process.exitCode = 1;
  } else {
    console.log('Claude review execution completed without a reported error.');
  }
} catch {
  console.error(
    'Claude review execution could not be verified: execution output is missing or unreadable.'
  );
  process.exitCode = 1;
}
