#!/usr/bin/env node
import { readFileSync } from 'node:fs';

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
