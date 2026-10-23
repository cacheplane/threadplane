import { loadInboxConfig } from './inbox-replies.ts';

/** Defines sends covered by the receiving cutover; historical gaps are waived. */
export function receivingSendScopeSql(alias: string): string {
  const config = loadInboxConfig();
  if (!config.enabled) return 'true';
  const start = `'${config.startedAt.toISOString()}'::timestamptz`;
  return `(${alias}.created_at >= ${start} or exists (
    select 1 from growth_activity accepted
    where accepted.event_key = 'job:' || ${alias}.id::text || ':provider-accepted'
      and accepted.occurred_at >= ${start}))`;
}

/** SQL gate for retiring the historical Google recovery source. */
export function legacyMailboxRecoveryGuardSql(): string {
  if (!loadInboxConfig().enabled) return 'true';
  return `not exists (select 1 from growth_reply_mailboxes
    where address = 'brian@threadplane.ai' and enabled and google_retired_at is not null)`;
}

/** SQL gate shared by campaign leasing and final submission. */
export function receivingCampaignGuardSql(
  contact: string,
  clock: string
): string {
  if (!loadInboxConfig().enabled) return 'true';
  // Both fragments are internal SQL identifiers/placeholders, never request data.
  return `(exists (select 1 from growth_reply_mailboxes
      where address = 'brian@threadplane.ai' and enabled and recovery_id is null
        and healthy_through >= ${clock}::timestamptz - interval '10 minutes'
        and healthy_through <= ${clock}::timestamptz)
    and not exists (select 1 from growth_reply_receipts
      where recipient = 'brian@threadplane.ai' and status = 'pending'
        and (reference_ids is null or contact_id = ${contact})))`;
}
