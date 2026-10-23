import { expect, test } from 'vitest';
import { readInboxRecoveryPaused } from './inbox-recovery.ts';
import { executorWith } from './inbox-test-support.ts';

test('global receiving pause SQL checks singleton coverage, clock bounds and unread evidence', async () => {
  const { executor, calls } = executorWith({
    'read-resend-mailbox-recovery-pause': () => ({ rows: [{ paused: true }] }),
  });
  const now = new Date('2026-10-22T01:00:00Z');
  expect(await readInboxRecoveryPaused(executor, now)).toBe(true);
  expect(calls[0].sql).toContain('recovery_id is not null');
  expect(calls[0].sql).toContain('reference_ids is null');
  expect(calls[0].sql).toContain("interval '10 minutes'");
  expect(calls[0].sql).toContain('healthy_through > $2');
  expect(calls[0].params).toEqual(['brian@threadplane.ai', now]);
});
