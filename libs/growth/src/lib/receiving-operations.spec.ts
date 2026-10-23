import { expect, test, vi } from 'vitest';
import {
  reviewInboxReceipt,
  retireGoogleMailbox,
} from './receiving-operations.ts';
import { executorWith } from './inbox-test-support.ts';

const now = new Date('2026-10-22T20:00:00Z');

test('reviewed ignore requires an operator and evidence before touching storage', async () => {
  const { executor, calls } = executorWith({});
  await expect(
    reviewInboxReceipt(executor, {
      receiptId: 'receipt-1',
      actor: '',
      evidence: 'review-1',
      occurredAt: now,
    })
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});

test('reviewed ignore records bounded audit evidence before releasing an unread receipt', async () => {
  const { executor, calls } = executorWith({
    'inbox-review-receipt': () => ({
      rows: [{ id: 'receipt-1', status: 'pending' }],
    }),
    'inbox-review-audit': () => ({ rows: [{ event_key: 'review' }] }),
    'inbox-review-ignore': () => ({ rows: [{ id: 'receipt-1' }] }),
  });
  await reviewInboxReceipt(executor, {
    receiptId: 'receipt-1',
    actor: 'brian',
    evidence: 'review-1',
    occurredAt: now,
  });
  expect(calls.map((c) => c.marker)).toContain('inbox-review-audit');
  expect(calls.find((c) => c.marker === 'inbox-review-ignore')?.sql).toContain(
    "status = 'ignored'"
  );
  expect(JSON.stringify(calls)).not.toContain('subject');
});

test('Google retirement records the explicit cutover without historical coverage prerequisites', async () => {
  const { executor, calls } = executorWith({
    'inbox-retire-google': () => ({
      rows: [{ address: 'brian@threadplane.ai' }],
    }),
    'inbox-retire-cancel-legacy': () => ({ rows: [] }),
    'inbox-retire-audit': vi.fn(() => ({ rows: [] })),
  });
  await retireGoogleMailbox(executor, {
    actor: 'brian',
    evidence: 'cutover-1',
    occurredAt: now,
  });
  expect(calls.find((c) => c.marker === 'inbox-retire-google')?.sql).toContain(
    'google_retired_at'
  );
  expect(
    calls.find((c) => c.marker === 'inbox-retire-audit')?.params
  ).toContain('cutover-1');
  expect(
    calls.some((c) => c.marker === 'read-resend-mailbox-recovery-pause')
  ).toBe(false);
  expect(
    calls.find((c) => c.marker === 'inbox-retire-cancel-legacy')?.sql
  ).toContain("kind = 'reply_reconcile'");
});
