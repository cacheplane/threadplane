import type { SqlExecutor } from './database.ts';
import {
  inboxProviderId,
  inboxTransactionGuard,
  INBOX_ADDRESS,
} from './inbox-replies.ts';
import { privacyLock } from './observability/store.ts';

interface Evidence {
  actor: string;
  evidence: string;
  occurredAt: Date;
}
function validateEvidence(input: Evidence): void {
  for (const value of [input.actor, input.evidence]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
      throw new Error('A bounded operator and evidence reference are required');
    }
  }
  if (!Number.isFinite(input.occurredAt.getTime()))
    throw new Error('Invalid operation clock');
}

/** Audits an operator decision to ignore one unresolved receipt. */
export async function reviewInboxReceipt(
  db: SqlExecutor,
  input: Evidence & { receiptId: string }
): Promise<void> {
  validateEvidence(input);
  const id = inboxProviderId(input.receiptId);
  await db.transaction(async (tx) => {
    await privacyLock(tx);
    await inboxTransactionGuard(tx);
    const receipt = await tx.execute<{ id: string; status: string }>(
      `/* growth:inbox-review-receipt */ select id, status from growth_reply_receipts
       where id = $1 and recipient = $2 for update`,
      [id, INBOX_ADDRESS]
    );
    if (receipt.rows.length !== 1) throw new Error('Unknown receiving receipt');
    if (receipt.rows[0].status !== 'pending')
      throw new Error('Receipt is already resolved');
    await tx.execute(
      `/* growth:inbox-review-audit */ insert into growth_activity(event_key, kind, occurred_at, data)
       values ($1, 'mailbox.receipt_reviewed', $2,
         jsonb_build_object('receipt_id', $3::text, 'actor', $4::text,
           'evidence_reference', $5::text, 'decision', 'ignore', 'policy_version', 'resend-receiving-v1'))`,
      [
        `resend:receipt:${id}:reviewed-ignore`,
        input.occurredAt,
        id,
        input.actor,
        input.evidence,
      ]
    );
    await tx.execute(
      `/* growth:inbox-review-ignore */ update growth_reply_receipts
       set status = 'ignored', reference_ids = null, rfc_message_id = null,
         contact_id = null, last_error_code = 'operator_reviewed_ignore', updated_at = $2
       where id = $1`,
      [id, input.occurredAt]
    );
  });
}

/** Retires Google's runtime gate at the operator's explicit cutover boundary. */
export async function retireGoogleMailbox(
  db: SqlExecutor,
  input: Evidence
): Promise<void> {
  validateEvidence(input);
  await db.transaction(async (tx) => {
    await privacyLock(tx);
    await inboxTransactionGuard(tx);
    const result = await tx.execute(
      `/* growth:inbox-retire-google */ update growth_reply_mailboxes
       set google_retired_at = $2 where address = $1 and enabled
         and google_retired_at is null returning address`,
      [INBOX_ADDRESS, input.occurredAt]
    );
    if (result.rows.length !== 1)
      throw new Error('Receiving mailbox missing or Google already retired');
    await tx.execute(
      `/* growth:inbox-retire-cancel-legacy */ update growth_jobs
       set status = 'cancelled', lease_token = null, lease_until = null,
         last_error_code = 'google_mailbox_retired', updated_at = $1
       where kind = 'reply_reconcile' and status in ('pending','leased')`,
      [input.occurredAt]
    );
    await tx.execute(
      `/* growth:inbox-retire-audit */ insert into growth_activity(event_key, kind, occurred_at, data)
       values ('mailbox:google-retired:v1', 'mailbox.google_retired', $1,
         jsonb_build_object('actor', $2::text, 'evidence_reference', $3::text,
           'historical_coverage_required', false, 'policy_version', 'resend-receiving-v1'))`,
      [input.occurredAt, input.actor, input.evidence]
    );
  });
}

/** Closed operational signals; no addresses, provider IDs or message content. */
export type ReceivingHealthAlert =
  | 'mailbox_coverage_stale'
  | 'mailbox_recovering'
  | 'unread_receipts'
  | 'reply_review_required'
  | 'forwarding_backlog'
  | 'reply_binding_pending'
  | 'send_outcome_unknown'
  | 'provider_attempt_expired';

/** Reads an aggregate receiving health snapshot suitable for logs and monitoring. */
export async function readReceivingHealth(
  db: SqlExecutor,
  now: Date
): Promise<{
  checkedAt: string;
  healthyThrough: string | null;
  alerts: ReceivingHealthAlert[];
  counts: {
    unread: number;
    pendingReview: number;
    unforwarded: number;
    unbound: number;
    unknownSends: number;
    expiredAttempts: number;
  };
}> {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid health clock');
  const result = await db.execute<{
    enabled: boolean;
    recovering: boolean;
    healthy_through: Date | string | null;
    unread: number;
    pending_review: number;
    unforwarded: number;
    unbound: number;
    unknown_sends: number;
    expired_attempts: number;
  }>(
    `/* growth:inbox-operator-health */
    select coalesce((select enabled from growth_reply_mailboxes where address = $1), false) as enabled,
      coalesce((select recovery_id is not null from growth_reply_mailboxes where address = $1), false) as recovering,
      (select healthy_through from growth_reply_mailboxes where address = $1) as healthy_through,
      (select count(*)::integer from growth_reply_receipts where recipient = $1 and status = 'pending' and (reference_ids is null or contact_id is null)) as unread,
      (select count(*)::integer from growth_reply_receipts where recipient = $1 and status = 'pending' and reference_ids is not null and contact_id is not null) as pending_review,
      (select count(*)::integer from growth_reply_receipts where recipient = $1 and forward_provider_id is null
        and (last_error_code is null or last_error_code not in ('contact_deleted','forward_loop_suppressed'))) as unforwarded,
      (select count(*)::integer from growth_jobs j join growth_contacts c on c.id = j.contact_id
        where c.deleted_at is null and j.kind in ('fulfill','send_step') and j.status = 'completed'
        and j.provider_email_id is not null and j.rfc_message_id is null
        and (j.created_at >= (select started_at from growth_reply_mailboxes where address = $1)
          or exists (select 1 from growth_activity a where a.event_key = 'job:' || j.id::text || ':provider-accepted'
            and a.occurred_at >= (select started_at from growth_reply_mailboxes where address = $1)))) as unbound,
      (select count(*)::integer from growth_jobs where delivery_status = 'unknown') as unknown_sends,
      (select count(*)::integer from growth_provider_attempts where provider_email_id is null
        and first_attempted_at <= $2::timestamptz - interval '23 hours') as expired_attempts`,
    [INBOX_ADDRESS, now]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Missing receiving health result');
  const count = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid health count');
    return value;
  };
  const counts = {
    unread: count(row.unread),
    pendingReview: count(row.pending_review),
    unforwarded: count(row.unforwarded),
    unbound: count(row.unbound),
    unknownSends: count(row.unknown_sends),
    expiredAttempts: count(row.expired_attempts),
  };
  const healthy =
    row.healthy_through === null ? null : new Date(row.healthy_through);
  const healthTime = healthy?.getTime() ?? NaN;
  const alerts: ReceivingHealthAlert[] = [];
  if (
    row.enabled !== true ||
    !Number.isFinite(healthTime) ||
    now.getTime() - healthTime > 600000 ||
    healthTime > now.getTime()
  )
    alerts.push('mailbox_coverage_stale');
  if (row.recovering) alerts.push('mailbox_recovering');
  if (counts.unread) alerts.push('unread_receipts');
  if (counts.pendingReview) alerts.push('reply_review_required');
  if (counts.unforwarded) alerts.push('forwarding_backlog');
  if (counts.unbound) alerts.push('reply_binding_pending');
  if (counts.unknownSends) alerts.push('send_outcome_unknown');
  if (counts.expiredAttempts) alerts.push('provider_attempt_expired');
  return {
    checkedAt: now.toISOString(),
    healthyThrough:
      healthy && Number.isFinite(healthTime) ? healthy.toISOString() : null,
    alerts,
    counts,
  };
}
