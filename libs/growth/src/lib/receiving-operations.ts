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
