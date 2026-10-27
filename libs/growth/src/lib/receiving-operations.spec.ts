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

test('receiving health surfaces stale coverage and actionable queues without identifiers', async () => {
  const { readReceivingHealth } = await import('./receiving-operations.ts');
  const { executor } = executorWith({
    'inbox-operator-health': () => ({
      rows: [
        {
          enabled: true,
          recovering: false,
          healthy_through: new Date(now.getTime() - 11 * 60000),
          unread: 1,
          pending_review: 2,
          unforwarded: 3,
          unbound: 4,
          unknown_sends: 5,
          expired_attempts: 6,
        },
      ],
    }),
  });

  const result = await readReceivingHealth(executor, now);

  expect(result.alerts).toEqual([
    'mailbox_coverage_stale',
    'unread_receipts',
    'reply_review_required',
    'forwarding_backlog',
    'reply_binding_pending',
    'send_outcome_unknown',
    'provider_attempt_expired',
  ]);
  expect(result.counts).toEqual({
    unread: 1,
    pendingReview: 2,
    unforwarded: 3,
    unbound: 4,
    unknownSends: 5,
    expiredAttempts: 6,
  });
  expect(JSON.stringify(result)).not.toContain('@');
});

test('receiving health reports healthy coverage with empty queues', async () => {
  const { readReceivingHealth } = await import('./receiving-operations.ts');
  const { executor } = executorWith({
    'inbox-operator-health': () => ({
      rows: [
        {
          enabled: true,
          recovering: false,
          healthy_through: now,
          unread: 0,
          pending_review: 0,
          unforwarded: 0,
          unbound: 0,
          unknown_sends: 0,
          expired_attempts: 0,
        },
      ],
    }),
  });

  const result = await readReceivingHealth(executor, now);

  expect(result.alerts).toEqual([]);
});

test('receiving health fails closed when the mailbox is missing or health is in the future', async () => {
  const { readReceivingHealth } = await import('./receiving-operations.ts');
  const { executor } = executorWith({
    'inbox-operator-health': () => ({
      rows: [
        {
          enabled: false,
          recovering: false,
          healthy_through: null,
          unread: 0,
          pending_review: 0,
          unforwarded: 0,
          unbound: 0,
          unknown_sends: 0,
          expired_attempts: 0,
        },
      ],
    }),
  });

  const result = await readReceivingHealth(executor, now);

  expect(result.alerts).toContain('mailbox_coverage_stale');
});
