import { afterEach, expect, test, vi } from 'vitest';
import {
  legacyMailboxRecoveryGuardSql,
  receivingCampaignGuardSql,
  receivingSendScopeSql,
} from './receiving-control.ts';

afterEach(() => vi.unstubAllEnvs());

function enableReceiving() {
  vi.stubEnv('RESEND_RECEIVING_ENABLED', 'true');
  vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', 'production');
  vi.stubEnv('RESEND_RECEIVING_STARTED_AT', '2026-10-22T19:00:00Z');
}

test('disabled receiving leaves legacy recovery authoritative without new tables', () => {
  vi.stubEnv('RESEND_RECEIVING_ENABLED', 'false');
  expect(legacyMailboxRecoveryGuardSql()).toBe('true');
  expect(receivingCampaignGuardSql('j.contact_id', '$2')).toBe('true');
});

test('Google recovery remains authoritative until an audited retirement is recorded', () => {
  enableReceiving();
  const sql = legacyMailboxRecoveryGuardSql();
  expect(sql).toContain('google_retired_at is not null');
  expect(sql).toContain("address = 'brian@threadplane.ai'");
  expect(sql).toMatch(/^not exists/u);
});

test('campaign leasing requires fresh coverage, no unread mail and no unresolved contact reply', () => {
  enableReceiving();
  const sql = receivingCampaignGuardSql('j.contact_id', '$2');
  expect(sql).toContain('healthy_through');
  expect(sql).toContain("interval '10 minutes'");
  expect(sql).toContain('recovery_id is null');
  expect(sql).toContain('reference_ids is null');
  expect(sql).toContain('contact_id = j.contact_id');
  expect(sql).toContain("status = 'pending'");
  expect(sql).toContain('$2::timestamptz');
});

test('an invalid enabled receiving environment cannot silently bypass gates', () => {
  enableReceiving();
  vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', 'preview');
  expect(() => receivingCampaignGuardSql('j.contact_id', '$2')).toThrow();
});

test('the historical waiver excludes old unbound sends but includes pre-created jobs accepted after cutover', () => {
  enableReceiving();
  const sql = receivingSendScopeSql('unbound');
  expect(sql).toContain('2026-10-22T19:00:00.000Z');
  expect(sql).toContain('unbound.created_at');
  expect(sql).toContain('accepted.occurred_at');
  expect(sql).toContain(':provider-accepted');
});
