import { createHash } from 'node:crypto';

import {
  nestedExecutor,
  type SqlExecutor,
  type SqlTransaction,
} from '../database.ts';
import {
  addDenyEntry,
  excludeDeniedCompanies,
  LEAD_PROFILE_NOT_DENIED_SQL,
  matchDeny,
} from './deny.ts';
import {
  companyNameFromHeadline,
  headlineSignal,
  normalizeLinkedInProfileUrl,
} from './normalize.ts';
import type {
  LinkedInActor,
  LinkedInNotificationKind,
  LinkedInPostReference,
} from './parser.ts';

/** Score weights; every score is computed from these in `scoreLead`. */
export const LINKEDIN_SCORE = {
  comment: 30,
  reply: 30,
  mention: 25,
  repost: 15,
  reaction: 5,
  extraPost: 10,
  icpHeadline: 20,
  negativeHeadline: -20,
} as const;

/**
 * Sums the engagement kind weights, adds `extraPost` for each distinct post
 * beyond the first, and adjusts for an ICP or negative headline.
 */
export function scoreLead(input: {
  engagements: { kind: LinkedInNotificationKind; postId: string }[];
  headline: string;
}): number {
  let score = 0;
  const posts = new Set<string>();
  for (const engagement of input.engagements) {
    score += LINKEDIN_SCORE[engagement.kind];
    posts.add(engagement.postId);
  }
  if (posts.size > 1) score += (posts.size - 1) * LINKEDIN_SCORE.extraPost;
  const signal = headlineSignal(input.headline);
  if (signal === 'icp') score += LINKEDIN_SCORE.icpHeadline;
  if (signal === 'negative') score += LINKEDIN_SCORE.negativeHeadline;
  return score;
}

/**
 * Returns the id of the `growth_linkedin_posts` row for a reference, inserting
 * one when none exists. A matching posted LinkedIn row in the marketing queue
 * is linked on insert. Throws when the reference has neither urn nor url.
 */
export async function resolvePost(
  tx: SqlTransaction,
  ref: LinkedInPostReference,
  firstSeenAt: Date
): Promise<string> {
  if (!ref.urn && !ref.url) {
    throw new Error('LinkedIn post reference has neither urn nor url');
  }
  const resolve = () =>
    tx.execute<{ id: string; source?: 'post' | 'marketing' }>(
      `/* growth:linkedin-post-resolve */
select id, source from (
  select id, 'post' as source, 0 as rank from growth_linkedin_posts
  where urn = $1::text or url = $2::text
  union all
  select id, 'marketing' as source, 1 as rank from marketing_posts
  where channel = 'linkedin'
    and (result->>'postId' = $1::text or result->>'url' = $2::text)
) matches
order by rank
limit 1`,
      [ref.urn, ref.url]
    );
  const found = (await resolve()).rows[0];
  if (found && found.source !== 'marketing') return found.id;
  const inserted = await tx.execute<{ id: string }>(
    `/* growth:linkedin-post-insert */
insert into growth_linkedin_posts (urn, url, marketing_post_id, first_seen_at)
values ($1, $2, $3, $4)
on conflict do nothing
returning id`,
    [ref.urn, ref.url, found?.id ?? null, firstSeenAt]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const raced = (await resolve()).rows[0];
  if (!raced) throw new Error('LinkedIn post could not be resolved');
  return raced.id;
}

export interface RecordEngagementInput {
  actor: LinkedInActor;
  kind: LinkedInNotificationKind;
  postId: string;
  occurredAt: Date;
  receiptId: string | null;
  source?: 'email' | 'manual';
}

export type RecordEngagementResult =
  | { outcome: 'recorded'; leadId: string; created: boolean }
  | { outcome: 'duplicate'; leadId: string };

/**
 * Upserts the lead, inserts the engagement (a repeat is a no-op) and
 * recomputes the lead score. The deny check is the caller's job.
 */
export async function recordEngagement(
  tx: SqlTransaction,
  input: RecordEngagementInput
): Promise<RecordEngagementResult> {
  const { actor } = input;
  const lead = await tx.execute<{ id: string; created: boolean }>(
    `/* growth:linkedin-lead-upsert */
insert into growth_linkedin_leads
  (profile_url, display_name, headline, company_name, source, first_seen_at, last_seen_at)
values ($1, $2, $3, $4, $5, $6, $6)
on conflict (profile_url) do update set
  display_name = excluded.display_name,
  headline = case when excluded.headline <> '' then excluded.headline
                  else growth_linkedin_leads.headline end,
  company_name = coalesce(excluded.company_name, growth_linkedin_leads.company_name),
  last_seen_at = greatest(growth_linkedin_leads.last_seen_at, excluded.last_seen_at),
  updated_at = now()
returning id, (xmax = 0) as created`,
    [
      actor.profileUrl,
      actor.displayName,
      actor.headline,
      companyNameFromHeadline(actor.headline),
      input.source ?? 'email',
      input.occurredAt,
    ]
  );
  const { id: leadId, created } = lead.rows[0];
  const commentHash = actor.commentText
    ? createHash('sha256').update(actor.commentText).digest('hex')
    : '';
  const inserted = await tx.execute(
    `/* growth:linkedin-engagement-insert */
insert into growth_linkedin_engagements
  (lead_id, post_id, kind, comment_hash, comment_text, occurred_at, receipt_id)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (lead_id, post_id, kind, comment_hash) do nothing
returning id`,
    [
      leadId,
      input.postId,
      input.kind,
      commentHash,
      actor.commentText,
      input.occurredAt,
      input.receiptId,
    ]
  );
  if (inserted.rows.length === 0) return { outcome: 'duplicate', leadId };
  const engagements = await tx.execute<{
    kind: LinkedInNotificationKind;
    post_id: string;
    headline: string;
  }>(
    `/* growth:linkedin-lead-engagements */
select e.kind, e.post_id, l.headline
from growth_linkedin_engagements e
join growth_linkedin_leads l on l.id = e.lead_id
where e.lead_id = $1`,
    [leadId]
  );
  const score = scoreLead({
    engagements: engagements.rows.map((row) => ({
      kind: row.kind,
      postId: row.post_id,
    })),
    headline: engagements.rows[0]?.headline ?? actor.headline,
  });
  await tx.execute(
    `/* growth:linkedin-lead-score */
update growth_linkedin_leads set score = $2, updated_at = now() where id = $1`,
    [leadId, score]
  );
  return { outcome: 'recorded', leadId, created };
}

export type LinkedInLeadStatus = 'new' | 'approved' | 'rejected' | 'denied';

export interface LinkedInLeadSummary {
  id: string;
  profileUrl: string;
  displayName: string;
  headline: string;
  companyName: string | null;
  status: LinkedInLeadStatus;
  score: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  decidedAt: Date | null;
  approvedVariant: 'connection' | 'message' | null;
  approvedText: string | null;
  engagements: {
    kind: LinkedInNotificationKind;
    commentText: string | null;
    occurredAt: Date;
    postUrn: string | null;
    postUrl: string | null;
  }[];
}

/** Raw row shape returned by the lead list queries. */
export interface LeadListRow extends Record<string, unknown> {
  id: string;
  profile_url: string;
  display_name: string;
  headline: string;
  company_name: string | null;
  status: LinkedInLeadStatus;
  score: number;
  first_seen_at: Date;
  last_seen_at: Date;
  decided_at: Date | null;
  approved_variant: 'connection' | 'message' | null;
  approved_text: string | null;
  engagements: {
    kind: LinkedInNotificationKind;
    comment_text: string | null;
    occurred_at: string | Date;
    post_urn: string | null;
    post_url: string | null;
  }[];
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Lists leads by score then recency, with their engagements; default limit 50,
 * max 200. Leads matching an active profile_url or company_name deny row are
 * excluded (this list feeds drafting), except when `status` is `denied`, which
 * lists denied leads for inspection. The company filter runs after the limit,
 * so a page can hold fewer rows than the limit.
 */
export async function listLeads(
  ex: SqlExecutor,
  input: { status?: LinkedInLeadStatus; limit?: number }
): Promise<LinkedInLeadSummary[]> {
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? DEFAULT_LIST_LIMIT), 1),
    MAX_LIST_LIMIT
  );
  const result = await ex.execute<LeadListRow>(
    `/* growth:linkedin-leads-list */
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
where ($1::text is null or l.status = $1::text)
  and ($1::text = 'denied' or ${LEAD_PROFILE_NOT_DENIED_SQL})
group by l.id
order by l.score desc, l.last_seen_at desc
limit $2`,
    [input.status ?? null, limit]
  );
  const rows =
    input.status === 'denied'
      ? result.rows
      : await excludeDeniedCompanies(ex, result.rows);
  return rows.map(mapLeadRow);
}

/** Maps a lead list row to its summary. */
export function mapLeadRow(row: LeadListRow): LinkedInLeadSummary {
  return {
    id: row.id,
    profileUrl: row.profile_url,
    displayName: row.display_name,
    headline: row.headline,
    companyName: row.company_name,
    status: row.status,
    score: row.score,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    decidedAt: row.decided_at,
    approvedVariant: row.approved_variant,
    approvedText: row.approved_text,
    engagements: row.engagements.map((e) => ({
      kind: e.kind,
      commentText: e.comment_text,
      occurredAt: new Date(e.occurred_at),
      postUrn: e.post_urn,
      postUrl: e.post_url,
    })),
  };
}

export type DecideLeadInput =
  | {
      leadId: string;
      decision: 'approve';
      variant: 'connection' | 'message';
      text: string;
      decidedBy: string;
      now: Date;
    }
  | {
      leadId: string;
      decision: 'reject' | 'deny';
      decidedBy: string;
      now: Date;
    };

export type DecideLeadResult =
  | 'applied'
  | 'already_decided'
  | 'not_found'
  | 'denied_by_list';

const TEXT_LIMITS = { connection: 300, message: 600 } as const;

/**
 * Applies a founder decision in one transaction. Approve is allowed from
 * `new` only and re-checks the deny list; reject and deny are allowed from
 * `new` or `rejected`. Deny also adds the profile and company to the deny list.
 * Throws when approve text is empty or whitespace-only, or exceeds the
 * variant limit.
 */
export async function decideLead(
  ex: SqlExecutor,
  input: DecideLeadInput
): Promise<DecideLeadResult> {
  if (input.decision === 'approve') {
    if (!input.text.trim()) {
      throw new Error(`${input.variant} text is empty`);
    }
    const limit = TEXT_LIMITS[input.variant];
    if ([...input.text].length > limit) {
      throw new Error(`${input.variant} text exceeds ${limit} characters`);
    }
  }
  return ex.transaction(async (tx) => {
    const locked = await tx.execute<{
      id: string;
      status: LinkedInLeadStatus;
      profile_url: string;
      headline: string;
      company_name: string | null;
    }>(
      `/* growth:linkedin-lead-lock */
select id, status, profile_url, headline, company_name
from growth_linkedin_leads where id = $1 for update`,
      [input.leadId]
    );
    const lead = locked.rows[0];
    if (!lead) return 'not_found';
    const allowed =
      input.decision === 'approve'
        ? lead.status === 'new'
        : lead.status === 'new' || lead.status === 'rejected';
    if (!allowed) return 'already_decided';

    const update = (
      status: LinkedInLeadStatus,
      variant: string | null,
      text: string | null
    ) =>
      tx.execute(
        `/* growth:linkedin-lead-decide */
update growth_linkedin_leads
set status = $2, decided_by = $3, decided_at = $4,
  approved_variant = $5, approved_text = $6, updated_at = now()
where id = $1`,
        [input.leadId, status, input.decidedBy, input.now, variant, text]
      );

    if (input.decision === 'approve') {
      const denyId = await matchDeny(tx, {
        profileUrl: lead.profile_url,
        headline: lead.headline,
      });
      if (denyId) {
        await update('denied', null, null);
        return 'denied_by_list';
      }
      await update('approved', input.variant, input.text);
      return 'applied';
    }
    if (input.decision === 'reject') {
      await update('rejected', null, null);
      return 'applied';
    }
    const deny = nestedExecutor(tx);
    const entry = {
      reason: 'founder_deny_forever',
      addedBy: input.decidedBy,
    };
    await addDenyEntry(deny, {
      kind: 'profile_url',
      value: lead.profile_url,
      ...entry,
    });
    if (lead.company_name) {
      await addDenyEntry(deny, {
        kind: 'company_name',
        value: lead.company_name,
        ...entry,
      });
    }
    await update('denied', null, null);
    return 'applied';
  });
}

/** Deletes a lead and, by cascade, its engagements; deny drops are untouched. */
export async function deleteLead(
  ex: SqlExecutor,
  input: { profileUrl: string }
): Promise<boolean> {
  const profileUrl =
    normalizeLinkedInProfileUrl(input.profileUrl) ?? input.profileUrl;
  const result = await ex.execute<{ id: string }>(
    `/* growth:linkedin-lead-delete */
delete from growth_linkedin_leads where profile_url = $1 returning id`,
    [profileUrl]
  );
  return result.rows.length > 0;
}
