import { buildInboxForward, INBOX_FORWARD_TO } from '../inbox-forward.ts';
import {
  INBOX_ADDRESS,
  inboxProviderId,
  inboxSenderAddress,
  type InboxReceivedEmail,
} from '../inbox-replies.ts';
import {
  completeProviderAttempt,
  providerIdempotencyKey,
  reserveProviderAttempt,
} from '../provider-attempts.ts';
import type { SqlExecutor, SqlTransaction } from '../database.ts';
import { nestedExecutor } from '../database.ts';
import type { LinkedInIngestConfig } from './config.ts';
import { matchDeny, recordDrop } from './deny.ts';
import { recordEngagement, resolvePost } from './leads.ts';
import {
  isTrustedLinkedInSender,
  type LinkedInActor,
  type LinkedInNotificationKind,
  type LinkedInParser,
  type LinkedInPostReference,
  type LinkedInUnparsedReason,
} from './parser.ts';

type EnabledConfig = Extract<LinkedInIngestConfig, { enabled: true }>;

/**
 * Unparsed reasons that still identify the mail as an engagement notification,
 * so its raw subject and body are kept for parser work until scrubbing. Every
 * other reason stores headers only.
 */
const RAW_BODY_REASONS: ReadonlySet<LinkedInUnparsedReason> = new Set([
  'unsupported_kind',
  'no_actor',
]);

/**
 * Durably admits received mail addressed to the LinkedIn ingest address. Mail
 * that also lists the reply inbox is left to the reply processor. Returns the
 * provider id, or null when the event is not ours.
 *
 * A receipt is admitted with `forward_required = true`, so mail whose
 * processing fails is still forwarded; a parsed receipt lowers it to the
 * configured value.
 */
export async function admitLinkedInReceipt(
  ex: SqlExecutor,
  payload: unknown,
  config: EnabledConfig
): Promise<string | null> {
  if (!payload || typeof payload !== 'object')
    throw new Error('Invalid inbound payload');
  const root = payload as Record<string, unknown>;
  if (root['type'] !== 'email.received') return null;
  const data = root['data'] as Record<string, unknown> | undefined;
  if (!data || !Array.isArray(data['to']))
    throw new Error('Invalid inbound recipients');
  const to = data['to'].map((a) =>
    typeof a === 'string' ? a.toLowerCase() : ''
  );
  if (!to.includes(config.address) || to.includes(INBOX_ADDRESS)) return null;
  const id = inboxProviderId(data['email_id']);
  const receivedAt = new Date(String(data['created_at'] ?? root['created_at']));
  if (!Number.isFinite(receivedAt.getTime()))
    throw new Error('Invalid received timestamp');
  await ex.execute(
    `/* growth:linkedin-receipt-admit */
insert into growth_linkedin_receipts (id, recipient, received_at, forward_required)
values ($1, $2, $3, true)
on conflict (id) do nothing`,
    [id, config.address, receivedAt]
  );
  return id;
}

/** Injectable operations for receipt processing. */
export interface LinkedInIngestDependencies {
  getReceived: (id: string) => Promise<InboxReceivedEmail>;
  parse: LinkedInParser;
  now: () => Date;
}

export type LinkedInProcessOutcome =
  | 'parsed'
  | 'unparsed'
  | 'already_processed';

function stringHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, field] of Object.entries(value))
      if (typeof field === 'string') headers[key.toLowerCase()] = field;
  }
  return headers;
}

/** Applies the deny list to each actor, then records the drop or the engagement. */
async function applyActors(
  tx: SqlTransaction,
  input: {
    receiptId: string;
    kind: LinkedInNotificationKind;
    actors: LinkedInActor[];
    post: LinkedInPostReference;
    occurredAt: Date;
    source: 'email' | 'manual';
  }
): Promise<{ recorded: number; dropped: number }> {
  const postId = await resolvePost(tx, input.post, input.occurredAt);
  let recorded = 0;
  let dropped = 0;
  for (const actor of input.actors) {
    const denyId = await matchDeny(tx, {
      profileUrl: actor.profileUrl,
      headline: actor.headline,
    });
    if (denyId) {
      await recordDrop(tx, {
        receiptId: input.receiptId,
        denyId,
        droppedAt: input.occurredAt,
      });
      dropped += 1;
      continue;
    }
    await recordEngagement(tx, {
      actor,
      kind: input.kind,
      postId,
      occurredAt: input.occurredAt,
      receiptId: input.receiptId,
      source: input.source,
    });
    recorded += 1;
  }
  return { recorded, dropped };
}

/**
 * Parses an admitted receipt, applies the deny list and records engagements.
 * Provider failures are redacted: the thrown error never carries mail content.
 */
export async function processLinkedInReceipt(
  ex: SqlExecutor,
  rawId: string,
  config: EnabledConfig,
  deps: LinkedInIngestDependencies
): Promise<LinkedInProcessOutcome> {
  const id = inboxProviderId(rawId);
  let email: InboxReceivedEmail;
  let receivedAt: Date;
  let headers: Record<string, string>;
  let result: ReturnType<LinkedInParser>;
  try {
    email = await deps.getReceived(id);
    if (
      email.id !== id ||
      !Array.isArray(email.to) ||
      !email.to.some((to) => to.toLowerCase() === config.address)
    )
      throw new Error('Received mailbox mismatch');
    receivedAt = new Date(email.created_at);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new Error('Invalid received timestamp');
    headers = stringHeaders(email.headers);
    result = deps.parse({
      from: email.from,
      subject: email.subject ?? null,
      text: email.text ?? null,
      html: email.html ?? null,
      headers,
    });
  } catch {
    try {
      await ex.execute(
        `/* growth:linkedin-receipt-failed */
update growth_linkedin_receipts
set attempts = attempts + 1, last_error_code = 'processing_failed', updated_at = now()
where id = $1 and status = 'pending'`,
        [id]
      );
    } catch {
      // A diagnostic failure must not expose the original provider error.
    }
    throw new Error('LinkedIn receipt processing failed');
  }
  const trusted = isTrustedLinkedInSender({ from: email.from, headers });
  let sender: string | null;
  try {
    sender = inboxSenderAddress(email.from);
  } catch {
    sender = null;
  }
  const headersJson = JSON.stringify(headers);
  return ex.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string }>(
      `/* growth:linkedin-receipt-lock */
select status from growth_linkedin_receipts where id = $1 and recipient = $2 for update`,
      [id, config.address]
    );
    if (!locked.rows[0]) throw new Error('Missing LinkedIn receipt');
    if (locked.rows[0].status !== 'pending') return 'already_processed';
    if (trusted && result.outcome === 'parsed' && result.actors.length > 0) {
      await applyActors(tx, {
        receiptId: id,
        kind: result.kind,
        actors: result.actors,
        post: result.post,
        occurredAt: receivedAt,
        source: 'email',
      });
      await tx.execute(
        `/* growth:linkedin-receipt-parsed */
update growth_linkedin_receipts
set status = 'parsed', kind = $2, sender = $3, headers = $4::jsonb,
  raw_subject = $5, raw_text = $6, raw_html = $7, forward_required = $8,
  attempts = attempts + 1, last_error_code = null, updated_at = now()
where id = $1`,
        [
          id,
          result.kind,
          sender,
          headersJson,
          email.subject ?? null,
          email.text ?? null,
          email.html ?? null,
          config.forwardNotifications,
        ]
      );
      return 'parsed';
    }
    const reason: LinkedInUnparsedReason = !trusted
      ? 'untrusted_sender'
      : result.outcome === 'unparsed'
      ? result.reason
      : 'no_actor';
    // Only mail recognized as an engagement notification keeps its body; a
    // sign-in code or verification mail is stored headers-only (spec §1).
    const keepBody = RAW_BODY_REASONS.has(reason);
    await tx.execute(
      `/* growth:linkedin-receipt-unparsed */
update growth_linkedin_receipts
set status = 'unparsed', unparsed_reason = $2, sender = $3, headers = $4::jsonb,
  raw_subject = $5, raw_text = $6, raw_html = $7, forward_required = $8,
  attempts = attempts + 1, last_error_code = null, updated_at = now()
where id = $1`,
      [
        id,
        reason,
        sender,
        headersJson,
        keepBody ? email.subject ?? null : null,
        keepBody ? email.text ?? null : null,
        keepBody ? email.html ?? null : null,
        true,
      ]
    );
    return 'unparsed';
  });
}

/** Operations required to forward a receipt to the operator. */
export interface LinkedInForwardDependencies {
  environment: string;
  getReceived: (id: string) => Promise<InboxReceivedEmail>;
  getRaw: (url: string) => Promise<Uint8Array>;
  send: (
    payload: ReturnType<typeof buildLinkedInForward>,
    key: string
  ) => Promise<string>;
  now?: () => Date;
}

/** Forward payload: the inbox forward with a LinkedIn subject prefix and job tag. */
export function buildLinkedInForward(
  email: InboxReceivedEmail,
  raw: Uint8Array,
  environment: string
): ReturnType<typeof buildInboxForward> {
  const base = buildInboxForward(email, raw, environment);
  return {
    ...base,
    subject: `Fwd: [LinkedIn] ${email.subject ?? '(no subject)'}`,
    tags: base.tags.map((tag) =>
      tag.name === 'job_kind' ? { ...tag, value: 'linkedin_forward' } : tag
    ),
  };
}

/**
 * Forwards a receipt that requires it, once. Returns the provider id, or null
 * when no forward is needed. Throws when a required forward fails.
 */
export async function forwardLinkedInReceipt(
  ex: SqlExecutor,
  rawId: string,
  deps: LinkedInForwardDependencies
): Promise<string | null> {
  const id = inboxProviderId(rawId);
  const key = providerIdempotencyKey(
    deps.environment,
    `linkedin-forward:${id}`
  );
  const read = await ex.execute<{
    forward_required: boolean;
    forward_provider_id: string | null;
    sender: string | null;
    headers: Record<string, unknown> | null;
  }>(
    `/* growth:linkedin-forward-receipt */
select forward_required, forward_provider_id, sender, headers
from growth_linkedin_receipts where id = $1`,
    [id]
  );
  const receipt = read.rows[0];
  if (!receipt) throw new Error('Unknown forwarding receipt');
  if (!receipt.forward_required) return null;
  if (receipt.forward_provider_id) return receipt.forward_provider_id;
  const finish = async (tx: SqlTransaction, providerId: string) => {
    inboxProviderId(providerId);
    const done = await tx.execute(
      `/* growth:linkedin-forward-complete */
update growth_linkedin_receipts set forward_provider_id = $2, updated_at = now()
where id = $1 and (forward_provider_id is null or forward_provider_id = $2)
returning id`,
      [id, providerId]
    );
    if (done.rows.length !== 1) throw new Error('Forwarding receipt conflict');
    return providerId;
  };
  const accepted = await ex.execute<{ provider_email_id: string }>(
    `/* growth:linkedin-forward-accepted */
select provider_email_id from growth_provider_attempts
where idempotency_key = $1 and provider_email_id is not null`,
    [key]
  );
  if (accepted.rows.length)
    return ex.transaction((tx) =>
      finish(tx, accepted.rows[0].provider_email_id)
    );
  const stored = stringHeaders(receipt.headers);
  if (
    stored['x-threadplane-forwarded'] !== undefined ||
    receipt.sender === INBOX_FORWARD_TO ||
    receipt.sender === INBOX_ADDRESS
  ) {
    await ex.execute(
      `/* growth:linkedin-forward-suppressed */
update growth_linkedin_receipts
set last_error_code = 'forward_loop_suppressed', updated_at = now()
where id = $1 and forward_provider_id is null`,
      [id]
    );
    return null;
  }
  const email = await deps.getReceived(id);
  if (email.id !== id || !email.raw?.download_url)
    throw new Error('Forward source mismatch or raw unavailable');
  const payload = buildLinkedInForward(
    email,
    await deps.getRaw(email.raw.download_url),
    deps.environment
  );
  const now = deps.now ?? (() => new Date());
  await reserveProviderAttempt(ex, key, payload, now());
  return ex.transaction(async (tx) => {
    const known = await reserveProviderAttempt(
      nestedExecutor(tx),
      key,
      payload,
      now()
    );
    const providerId = known ?? (await deps.send(payload, key));
    inboxProviderId(providerId);
    await completeProviderAttempt(tx, key, providerId);
    return finish(tx, providerId);
  });
}

/** Days a receipt keeps its raw subject and body before scrubbing. */
export const LINKEDIN_RAW_RETENTION_DAYS = 30;

/** Nulls raw subject/body of receipts past retention. Returns the count. */
export async function scrubLinkedInReceipts(
  ex: SqlExecutor,
  input: { now: Date }
): Promise<number> {
  const cutoff = new Date(
    input.now.getTime() - LINKEDIN_RAW_RETENTION_DAYS * 86400000
  );
  const result = await ex.execute(
    `/* growth:linkedin-receipts-scrub */
update growth_linkedin_receipts
set raw_subject = null, raw_text = null, raw_html = null,
  scrubbed_at = $2, updated_at = now()
where received_at < $1 and scrubbed_at is null
returning id`,
    [cutoff, input.now]
  );
  return result.rows.length;
}

/** Records a synthetic manual receipt and its engagements, with no provider I/O. */
export async function ingestManualEngagement(
  ex: SqlExecutor,
  input: {
    receiptId: string;
    receivedAt: Date;
    kind: LinkedInNotificationKind;
    actors: LinkedInActor[];
    post: LinkedInPostReference;
  }
): Promise<{ recorded: number; dropped: number }> {
  return ex.transaction(async (tx) => {
    const inserted = await tx.execute(
      `/* growth:linkedin-receipt-manual */
insert into growth_linkedin_receipts
  (id, recipient, received_at, source, status, kind, forward_required)
values ($1, 'manual', $2, 'manual', 'parsed', $3, false)
on conflict (id) do nothing
returning id`,
      [input.receiptId, input.receivedAt, input.kind]
    );
    // A repeat, or an id owned by another receipt, must not touch actors.
    if (inserted.rows.length === 0) return { recorded: 0, dropped: 0 };
    return applyActors(tx, {
      receiptId: input.receiptId,
      kind: input.kind,
      actors: input.actors,
      post: input.post,
      occurredAt: input.receivedAt,
      source: 'manual',
    });
  });
}
