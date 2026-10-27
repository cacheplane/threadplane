import { expect, test } from 'vitest';
import { readInboxRecoveryPaused, recoverInbox } from './inbox-recovery.ts';
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

test('final authorization globally pauses for parsed pending replies without an attributed contact', async () => {
  const { executor, calls } = executorWith({
    'read-resend-mailbox-recovery-pause': () => ({ rows: [{ paused: true }] }),
  });
  const now = new Date('2026-10-22T01:00:00Z');

  const paused = await readInboxRecoveryPaused(executor, now);

  expect(paused).toBe(true);
  expect(calls[0].sql).toMatch(
    /status = 'pending' and \(reference_ids is null or contact_id is null\)/u
  );
});

test('recovery checkpoint requires pending replies to have contact attribution even after parsing', async () => {
  const now = new Date('2026-10-22T01:00:00Z');
  const config = {
    enabled: true as const,
    address: 'brian@threadplane.ai',
    startedAt: new Date('2026-10-22T00:00:00Z'),
  };
  const { executor, calls } = executorWith({
    'inbox-ensure-mailbox': () => ({ rows: [{ address: config.address }] }),
    'inbox-recovery-start': () => ({
      rows: [
        {
          healthy_through: now,
          scan_cursor: null,
          scan_started_at: now,
          scan_complete: true,
          scan_head_id: null,
          covered_head_id: null,
        },
      ],
    }),
    'inbox-recovery-generation-lock': () => ({
      rows: [{ address: config.address }],
    }),
    'inbox-unbound': () => ({ rows: [] }),
    'inbox-list-pending': () => ({ rows: [] }),
    'inbox-list-unforwarded': () => ({ rows: [] }),
    'inbox-recovery-complete': () => ({ rows: [] }),
  });

  const result = await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getReceived: async () => {
      throw new Error('No provider work expected');
    },
    getSent: async () => {
      throw new Error('No provider work expected');
    },
    stopContact: async () => {
      throw new Error('No contact mutation expected');
    },
    now: () => now,
  });

  expect(result.complete).toBe(false);
  expect(
    calls.find(({ marker }) => marker === 'inbox-recovery-complete')?.sql
  ).toMatch(
    /status = 'pending' and \(reference_ids is null or contact_id is null\)/u
  );
});
