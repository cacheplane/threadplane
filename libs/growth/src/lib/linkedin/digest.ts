import type { SqlTransaction } from '../database.ts';
import {
  type LeadListRow,
  type LinkedInLeadSummary,
  mapLeadRow,
} from './leads.ts';
import { excludeDeniedCompanies, LEAD_PROFILE_NOT_DENIED_SQL } from './deny.ts';

/** Counts only; the digest context never carries identities. */
export interface LinkedInDigestContext {
  since: Date;
  unparsedCount: number;
  dropCount: number;
  ingestCount: number;
  forwardBacklog: number;
}

/**
 * Reads the digest context. `since` is the sent_at of the latest digest, else
 * now - 24h. ingestCount = receipts received since; unparsedCount = unparsed
 * receipts since; dropCount = drops since; forwardBacklog = receipts older
 * than 15 minutes that need forwarding with no provider id, or that are still
 * pending (processing never finished).
 */
export async function readLinkedInDigestContext(
  ex: SqlTransaction,
  input: { now: Date }
): Promise<LinkedInDigestContext> {
  const result = await ex.execute<{
    since: Date;
    unparsed: number | string;
    drops: number | string;
    ingest: number | string;
    forward_backlog: number | string;
  }>(
    `/* growth:linkedin-digest-context */
with bounds as (
  select coalesce((select max(sent_at) from growth_linkedin_digests),
    $1::timestamptz - interval '24 hours') as since
)
select b.since,
  (select count(*) from growth_linkedin_receipts r
    where r.status = 'unparsed' and r.received_at > b.since) as unparsed,
  (select count(*) from growth_linkedin_drops d
    where d.dropped_at > b.since) as drops,
  (select count(*) from growth_linkedin_receipts r
    where r.received_at > b.since) as ingest,
  (select count(*) from growth_linkedin_receipts r
    where ((r.forward_required and r.forward_provider_id is null) or r.status = 'pending')
      and r.received_at < $1::timestamptz - interval '15 minutes') as forward_backlog
from bounds b`,
    [input.now]
  );
  const row = result.rows[0];
  return {
    since: new Date(row.since),
    unparsedCount: Number(row.unparsed),
    dropCount: Number(row.drops),
    ingestCount: Number(row.ingest),
    forwardBacklog: Number(row.forward_backlog),
  };
}

/** A digest lead; `previouslyRejected` marks a rejected lead that engaged again. */
export interface LinkedInDigestLead extends LinkedInLeadSummary {
  previouslyRejected: boolean;
}

const DIGEST_LEAD_LIMIT = 100;

/**
 * New leads plus rejected leads seen since their rejection, excluding active
 * profile_url and company_name deny matches. Ordered by score then recency.
 */
export async function readLinkedInDigestLeads(
  ex: SqlTransaction
): Promise<LinkedInDigestLead[]> {
  const result = await ex.execute<LeadListRow>(
    `/* growth:linkedin-digest-leads */
select l.id, l.profile_url, l.display_name, l.headline, l.company_name,
  l.status, l.score, l.first_seen_at, l.last_seen_at, l.decided_at,
  l.approved_variant, l.approved_text,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', e.kind, 'comment_text', e.comment_text,
      'occurred_at', e.occurred_at, 'post_urn', p.urn, 'post_url', p.url)
    order by e.occurred_at) filter (where e.id is not null), '[]'::jsonb) as engagements
from growth_linkedin_leads l
left join growth_linkedin_engagements e on e.lead_id = l.id
left join growth_linkedin_posts p on p.id = e.post_id
where (l.status = 'new'
    or (l.status = 'rejected' and l.last_seen_at > l.decided_at))
  and ${LEAD_PROFILE_NOT_DENIED_SQL}
group by l.id
order by l.score desc, l.last_seen_at desc
limit $1`,
    [DIGEST_LEAD_LIMIT]
  );
  return (await excludeDeniedCompanies(ex, result.rows)).map((row) => ({
    ...mapLeadRow(row),
    previouslyRejected: row.status === 'rejected',
  }));
}

/**
 * Enqueues the day's LinkedIn digest job when there is something to report.
 * Returns the job id, or null when the job exists, nothing is reportable, or
 * the insert lost a race.
 */
export async function enqueueLinkedInDigestJob(
  ex: SqlTransaction,
  input: { now: Date; idempotencyKey: string; businessDate: string }
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.businessDate)) {
    throw new Error('LinkedIn digest business date must be YYYY-MM-DD');
  }
  if (!input.idempotencyKey.startsWith('linkedin_digest:')) {
    throw new Error(
      'LinkedIn digest idempotency key must start with linkedin_digest:'
    );
  }
  const existing = await ex.execute(
    `/* growth:linkedin-digest-job-exists */
select 1 from growth_jobs where idempotency_key = $1`,
    [input.idempotencyKey]
  );
  if (existing.rows.length > 0) return null;
  const leads = await readLinkedInDigestLeads(ex);
  const context = await readLinkedInDigestContext(ex, { now: input.now });
  if (
    leads.length === 0 &&
    context.unparsedCount === 0 &&
    context.dropCount === 0
  ) {
    return null;
  }
  const result = await ex.execute<{ id: string }>(
    `/* growth:enqueue-linkedin-digest */
insert into growth_jobs (kind, status, available_at, idempotency_key, payload)
values ('digest', 'pending', $1, $2,
  jsonb_build_object('business_date', $3::text, 'digest_kind', 'linkedin_leads'))
on conflict (idempotency_key) do nothing
returning id`,
    [input.now, input.idempotencyKey, input.businessDate]
  );
  return result.rows[0]?.id ?? null;
}

/** Records the day's digest send; a repeat for the same business date is a no-op. */
export async function markLinkedInDigestSent(
  ex: SqlTransaction,
  input: {
    businessDate: string;
    jobId: string;
    sentAt: Date;
    leadCount: number;
    context: LinkedInDigestContext;
  }
): Promise<void> {
  await ex.execute(
    `/* growth:linkedin-digest-sent */
insert into growth_linkedin_digests
  (business_date, job_id, sent_at, lead_count, unparsed_count, drop_count, ingest_count)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (business_date) do nothing`,
    [
      input.businessDate,
      input.jobId,
      input.sentAt,
      input.leadCount,
      input.context.unparsedCount,
      input.context.dropCount,
      input.context.ingestCount,
    ]
  );
}
