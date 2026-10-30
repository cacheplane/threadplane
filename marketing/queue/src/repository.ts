import type { SqlExecutor, SqlTransaction } from './sql.ts';
import type {
  MarketingPost,
  MarketingWeek,
  NewPost,
  PostResult,
  PostStatus,
} from './types.ts';

type Row = Record<string, unknown>;

export class LeaseConflictError extends Error {
  constructor(postId: string) {
    super(`Lease for marketing post ${postId} is no longer held`);
    this.name = 'LeaseConflictError';
  }
}

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);
const isoOrNull = (value: unknown): string | null =>
  value == null ? null : iso(value);

function mapWeek(row: Row): MarketingWeek {
  return {
    id: row['id'] as string,
    weekStart:
      row['week_start'] instanceof Date
        ? row['week_start'].toISOString().slice(0, 10)
        : String(row['week_start']),
    status: row['status'] as MarketingWeek['status'],
    approvedAt: isoOrNull(row['approved_at']),
    notes: (row['notes'] as string | null) ?? null,
    createdAt: iso(row['created_at']),
  };
}

function mapPost(row: Row): MarketingPost {
  return {
    id: row['id'] as string,
    weekId: (row['week_id'] as string | null) ?? null,
    channel: row['channel'] as MarketingPost['channel'],
    kind: row['kind'] as MarketingPost['kind'],
    status: row['status'] as PostStatus,
    publishAt: iso(row['publish_at']),
    payload: row['payload'] as Record<string, unknown>,
    media: (row['media'] as MarketingPost['media']) ?? [],
    sourceRefs: (row['source_refs'] as unknown[]) ?? [],
    dependsOn: (row['depends_on'] as string | null) ?? null,
    utmCampaign: (row['utm_campaign'] as string | null) ?? null,
    idempotencyKey: row['idempotency_key'] as string,
    confirmedFlags: (row['confirmed_flags'] as string[]) ?? [],
    leaseToken: (row['lease_token'] as string | null) ?? null,
    leaseExpiresAt: isoOrNull(row['lease_expires_at']),
    attempts: Number(row['attempts'] ?? 0),
    deployRequestedAt: isoOrNull(row['deploy_requested_at']),
    result: (row['result'] as PostResult | null) ?? null,
    error: (row['error'] as string | null) ?? null,
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

export async function upsertWeek(
  ex: SqlTransaction,
  input: { weekStart: string }
): Promise<MarketingWeek> {
  const { rows } = await ex.execute(
    `/* marketing:upsert-week */
     insert into marketing_weeks (id, week_start, status)
     values ($1, $2, 'drafting')
     on conflict (week_start) do update set week_start = excluded.week_start
     returning *`,
    [crypto.randomUUID(), input.weekStart]
  );
  return mapWeek(rows[0]);
}

export async function insertDraftPost(
  ex: SqlTransaction,
  input: NewPost
): Promise<MarketingPost> {
  const { rows } = await ex.execute(
    `/* marketing:insert-draft-post */
     insert into marketing_posts (
       id, week_id, channel, kind, status, publish_at, payload, media,
       source_refs, depends_on, utm_campaign, idempotency_key
     ) values ($1, $2, $3, $4, 'draft', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     returning *`,
    [
      crypto.randomUUID(),
      input.weekId,
      input.channel,
      input.kind,
      input.publishAt,
      JSON.stringify(input.payload),
      JSON.stringify(input.media ?? []),
      JSON.stringify(input.sourceRefs ?? []),
      input.dependsOn ?? null,
      input.utmCampaign ?? null,
      input.idempotencyKey,
    ]
  );
  return mapPost(rows[0]);
}

export async function updateDraftPost(
  ex: SqlExecutor,
  id: string,
  patch: Partial<
    Pick<MarketingPost, 'payload' | 'media' | 'publishAt' | 'kind'>
  >
): Promise<MarketingPost> {
  return ex.transaction(async (tx) => {
    const current = await tx.execute(
      `/* marketing:lock-post-for-update */
       select * from marketing_posts where id = $1 for update`,
      [id]
    );
    if (!current.rows[0]) throw new Error(`Marketing post ${id} not found`);
    const before = mapPost(current.rows[0]);
    if (before.status !== 'draft' && before.status !== 'scheduled') {
      throw new Error(
        `Marketing post ${id} is ${before.status} and can no longer be edited`
      );
    }
    const payloadChanged =
      patch.payload !== undefined &&
      JSON.stringify(patch.payload) !== JSON.stringify(before.payload);
    // A changed payload invalidates earlier confirmations, and a scheduled
    // post that now carries a blocking flag goes back to draft for approval.
    const nextStatus =
      payloadChanged &&
      before.status === 'scheduled' &&
      unconfirmedBlockingCodes({
        ...before,
        payload: patch.payload as Record<string, unknown>,
        confirmedFlags: [],
      }).length > 0
        ? 'draft'
        : before.status;
    const { rows } = await tx.execute(
      `/* marketing:update-draft-post */
       update marketing_posts set
         payload = coalesce($2::jsonb, payload),
         media = coalesce($3::jsonb, media),
         publish_at = coalesce($4::timestamptz, publish_at),
         kind = coalesce($5, kind),
         confirmed_flags = case when $6::boolean then '[]'::jsonb else confirmed_flags end,
         status = $7,
         updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        patch.payload === undefined ? null : JSON.stringify(patch.payload),
        patch.media === undefined ? null : JSON.stringify(patch.media),
        patch.publishAt ?? null,
        patch.kind ?? null,
        payloadChanged,
        nextStatus,
      ]
    );
    if (payloadChanged) {
      await tx.execute(
        `/* marketing:insert-revision */
         insert into marketing_post_revisions (id, post_id, before, after)
         values ($1, $2, $3::jsonb, $4::jsonb)`,
        [
          crypto.randomUUID(),
          id,
          JSON.stringify(before.payload),
          JSON.stringify(patch.payload),
        ]
      );
    }
    return mapPost(rows[0]);
  });
}

interface LintFlag {
  code: string;
  blocking: boolean;
}

function unconfirmedBlockingCodes(post: MarketingPost): string[] {
  const flags = (post.payload['lintFlags'] as LintFlag[] | undefined) ?? [];
  return flags
    .filter((flag) => flag.blocking && !post.confirmedFlags.includes(flag.code))
    .map((flag) => flag.code);
}

export async function approveWeek(
  ex: SqlExecutor,
  weekId: string,
  now: Date
): Promise<{
  scheduled: string[];
  blocked: { id: string; codes: string[] }[];
  past: string[];
}> {
  return ex.transaction(async (tx) => {
    const { rows } = await tx.execute(
      `/* marketing:approve-week-drafts */
       select * from marketing_posts
       where week_id = $1 and status = 'draft'
       order by publish_at
       for update`,
      [weekId]
    );
    const scheduled: string[] = [];
    const blocked: { id: string; codes: string[] }[] = [];
    const past: string[] = [];
    for (const post of rows.map(mapPost)) {
      if (new Date(post.publishAt).getTime() <= now.getTime()) {
        past.push(post.id);
        continue;
      }
      const codes = unconfirmedBlockingCodes(post);
      if (codes.length > 0) blocked.push({ id: post.id, codes });
      else scheduled.push(post.id);
    }
    if (scheduled.length > 0) {
      await tx.execute(
        `/* marketing:schedule-posts */
         update marketing_posts set status = 'scheduled', updated_at = now()
         where id = any($1::uuid[]) and status = 'draft'`,
        [scheduled]
      );
    }
    await tx.execute(
      `/* marketing:approve-week */
       update marketing_weeks set status = 'approved', approved_at = $2
       where id = $1`,
      [weekId, now]
    );
    return { scheduled, blocked, past };
  });
}

export async function confirmFlags(
  ex: SqlTransaction,
  id: string,
  codes: string[]
): Promise<MarketingPost> {
  const { rows } = await ex.execute(
    `/* marketing:confirm-flags */
     update marketing_posts set
       confirmed_flags = (
         select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
         from jsonb_array_elements(confirmed_flags || $2::jsonb)
       ),
       updated_at = now()
     where id = $1
     returning *`,
    [id, JSON.stringify(codes)]
  );
  if (!rows[0]) throw new Error(`Marketing post ${id} not found`);
  return mapPost(rows[0]);
}

export async function cancelPost(
  ex: SqlTransaction,
  id: string
): Promise<MarketingPost> {
  const { rows } = await ex.execute(
    `/* marketing:cancel-post */
     update marketing_posts set status = 'cancelled', updated_at = now()
     where id = $1 and status in ('draft', 'scheduled')
     returning *`,
    [id]
  );
  if (!rows[0]) throw new Error(`Marketing post ${id} cannot be cancelled`);
  return mapPost(rows[0]);
}

export async function reschedulePost(
  ex: SqlTransaction,
  id: string,
  publishAt: Date
): Promise<MarketingPost> {
  const { rows } = await ex.execute(
    `/* marketing:reschedule-post */
     update marketing_posts set publish_at = $2, updated_at = now()
     where id = $1 and status in ('draft', 'scheduled')
     returning *`,
    [id, publishAt]
  );
  if (!rows[0]) throw new Error(`Marketing post ${id} cannot be rescheduled`);
  return mapPost(rows[0]);
}

export async function listPosts(
  ex: SqlTransaction,
  filter: { weekStart?: string; status?: PostStatus[] } = {}
): Promise<MarketingPost[]> {
  const { rows } = await ex.execute(
    `/* marketing:list-posts */
     select p.* from marketing_posts p
     left join marketing_weeks w on w.id = p.week_id
     where ($1::date is null or w.week_start = $1::date)
       and ($2::text[] is null or p.status = any($2::text[]))
     order by p.publish_at, p.channel`,
    [filter.weekStart ?? null, filter.status ?? null]
  );
  return rows.map(mapPost);
}

export async function leaseDuePosts(
  ex: SqlTransaction,
  options: { now: Date; limit: number; leaseMs: number }
): Promise<MarketingPost[]> {
  const { rows } = await ex.execute(
    `/* marketing:lease-due-posts */
     update marketing_posts set
       status = 'posting',
       lease_token = gen_random_uuid(),
       lease_expires_at = $1::timestamptz + ($3::int * interval '1 millisecond'),
       attempts = attempts + 1,
       updated_at = now()
     where id in (
       select id from marketing_posts
       where status = 'scheduled' and publish_at <= $1
       order by publish_at
       for update skip locked
       limit $2
     )
     returning *`,
    [options.now, options.limit, options.leaseMs]
  );
  return rows.map(mapPost);
}

async function finishLeased(
  ex: SqlTransaction,
  marker: string,
  setClause: string,
  id: string,
  leaseToken: string,
  extra: unknown[]
): Promise<void> {
  const { rows } = await ex.execute(
    `/* marketing:${marker} */
     update marketing_posts set ${setClause}, updated_at = now()
     where id = $1 and lease_token = $2 and status = 'posting'
     returning id`,
    [id, leaseToken, ...extra]
  );
  if (!rows[0]) throw new LeaseConflictError(id);
}

export function releaseToScheduled(
  ex: SqlTransaction,
  id: string,
  leaseToken: string
): Promise<void> {
  return finishLeased(
    ex,
    'release-to-scheduled',
    `status = 'scheduled', lease_token = null, lease_expires_at = null, attempts = attempts - 1`,
    id,
    leaseToken,
    []
  );
}

export function markPosted(
  ex: SqlTransaction,
  id: string,
  leaseToken: string,
  result: PostResult
): Promise<void> {
  return finishLeased(
    ex,
    'mark-posted',
    `status = 'posted', result = $3::jsonb, error = null, lease_token = null, lease_expires_at = null`,
    id,
    leaseToken,
    [JSON.stringify(result)]
  );
}

export function markFailed(
  ex: SqlTransaction,
  id: string,
  leaseToken: string,
  error: string
): Promise<void> {
  return finishLeased(
    ex,
    'mark-failed',
    `status = 'failed', error = $3, lease_token = null, lease_expires_at = null`,
    id,
    leaseToken,
    [error]
  );
}

export async function markDeployRequested(
  ex: SqlTransaction,
  id: string,
  leaseToken: string,
  at: Date
): Promise<void> {
  const { rows } = await ex.execute(
    `/* marketing:mark-deploy-requested */
     update marketing_posts set deploy_requested_at = $3, updated_at = now()
     where id = $1 and lease_token = $2 and status = 'posting'
     returning id`,
    [id, leaseToken, at]
  );
  if (!rows[0]) throw new LeaseConflictError(id);
}

export async function claimAlert(
  ex: SqlTransaction,
  key: string
): Promise<boolean> {
  const { rows } = await ex.execute(
    `/* marketing:claim-alert */
     insert into marketing_alerts (key) values ($1)
     on conflict do nothing
     returning key`,
    [key]
  );
  return rows.length > 0;
}
