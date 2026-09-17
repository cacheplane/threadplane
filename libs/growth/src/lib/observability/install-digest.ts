import type { SqlTransaction } from '../database.ts';
import {
  createEmailLookupCandidates,
  type EmailHmacKeyring,
} from '../crypto.ts';
import {
  isPersonalEmailDomain,
  PERSONAL_EMAIL_DOMAINS,
} from '../company-domain.ts';

export interface InstallDigestPackage {
  packageName: string;
  packageVersion: string;
}

export interface InstallDigestCandidate {
  email: string;
  companyDomain: string;
  gitDisplayName: string | null;
  repositoryProvider: string | null;
  repositoryOwner: string | null;
  /** 'local' when any install carried a repository-local git identity, else 'global'. */
  gitConfigOrigin: 'local' | 'global';
  packages: InstallDigestPackage[];
  installCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstInstallObservationId: string;
  emailLookupHmac: string;
  emailKeyVersion: number;
}

export interface InstallDigestContext {
  since: Date;
  anonymousInstallSubjects: number;
  ciInstallSubjects: number;
}

interface CandidateRow extends Record<string, unknown> {
  email: string;
  git_display_name: string | null;
  repository_provider: string | null;
  repository_owner: string | null;
  local_origin: boolean;
  packages: string[];
  install_count: number | string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  first_install_observation_id: string;
  email_lookup_hmac: string;
  email_key_version: number | string;
}

function positiveLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error(
      'Install digest limit must be an integer between 1 and 1000'
    );
  }
  return limit;
}

/**
 * Identified, non-CI installers with a work-email domain who are not a contact
 * in any state and have not been reported in a previous digest. One row per email.
 * Personal mailbox domains are excluded in SQL so `limit` counts only eligible rows.
 */
export async function readInstallDigestCandidates(
  executor: SqlTransaction,
  input: { limit: number; keyring?: EmailHmacKeyring }
): Promise<InstallDigestCandidate[]> {
  const limit = positiveLimit(input.limit);
  const result = await executor.execute<CandidateRow>(
    `/* growth:read-install-digest-candidates */
     with identified as (
       select i.email_normalized as email,
              i.email_lookup_hmac,
              i.email_key_version,
              i.git_display_name,
              i.repository_provider,
              i.repository_owner,
              i.git_config_origin = 'local' as local_origin,
              o.id as observation_id,
              o.received_at,
              coalesce(o.properties->>'packageName', '') as package_name,
              coalesce(o.properties->>'packageVersion', '') as package_version
       from growth_observation_identities i
       join growth_observations o on o.id = i.observation_id
       where o.source = 'install'
         and o.kind = 'package.installed'
         and o.redacted_at is null
         and i.email_normalized is not null
         and split_part(i.email_normalized, '@', 2) <> ''
         and lower(split_part(i.email_normalized, '@', 2)) <> all($2::text[])
         and coalesce(o.properties->>'environment', 'unknown') <> 'ci'
         and not exists (
           select 1 from growth_contacts c
           where c.email_normalized = i.email_normalized::citext
         )
         -- Redaction deletes identity rows, so the transitive email match below
         -- can lose its anchor after a key rotation; the direct pair match and
         -- the post-query keyring check close that gap.
         and not exists (
           select 1 from growth_install_digest_reports r
           where r.email_key_version = i.email_key_version
             and r.email_lookup_hmac = i.email_lookup_hmac
         )
         and not exists (
           select 1
           from growth_install_digest_reports r
           -- identity rows are deleted on redaction, never nulled
           join growth_observation_identities ri
             on ri.email_key_version = r.email_key_version
            and ri.email_lookup_hmac = r.email_lookup_hmac
           where ri.email_normalized = i.email_normalized
         )
     )
     select email,
            max(git_display_name) as git_display_name,
            max(repository_provider) as repository_provider,
            max(repository_owner) as repository_owner,
            bool_or(local_origin) as local_origin,
            array_agg(distinct package_name || '@' || package_version) as packages,
            count(*)::integer as install_count,
            min(received_at) as first_seen_at,
            max(received_at) as last_seen_at,
            (array_agg(observation_id order by received_at, observation_id))[1]
              as first_install_observation_id,
            (array_agg(email_lookup_hmac order by received_at, observation_id))[1]
              as email_lookup_hmac,
            (array_agg(email_key_version order by received_at, observation_id))[1]
              as email_key_version
     from identified
     group by email
     order by min(received_at), email
     limit $1`,
    [limit, [...PERSONAL_EMAIL_DOMAINS]]
  );
  const candidates: InstallDigestCandidate[] = [];
  for (const row of result.rows) {
    const domain = row.email.split('@')[1] ?? '';
    // Belt and braces: the SQL already excludes these.
    if (!domain || isPersonalEmailDomain(domain)) continue;
    candidates.push({
      email: row.email,
      companyDomain: domain,
      gitDisplayName: row.git_display_name,
      repositoryProvider: row.repository_provider,
      repositoryOwner: row.repository_owner,
      gitConfigOrigin: row.local_origin ? 'local' : 'global',
      packages: row.packages
        .map((entry) => {
          const at = entry.lastIndexOf('@');
          return {
            packageName: entry.slice(0, at),
            packageVersion: entry.slice(at + 1),
          };
        })
        .filter((p) => p.packageName && p.packageVersion),
      installCount: Number(row.install_count),
      firstSeenAt: new Date(row.first_seen_at),
      lastSeenAt: new Date(row.last_seen_at),
      firstInstallObservationId: row.first_install_observation_id,
      emailLookupHmac: row.email_lookup_hmac,
      emailKeyVersion: Number(row.email_key_version),
    });
  }
  if (!input.keyring || candidates.length === 0) return candidates;
  // Rotated-and-redacted edge: a report recorded under a previous key whose
  // identity rows were since redacted matches neither exclusion above. The SQL
  // already excluded every other reported identity, so this rarely drops rows
  // and does not disturb `limit` in normal operation.
  const pairs = candidates.flatMap((candidate) =>
    createEmailLookupCandidates(candidate.email, input.keyring!).map((c) => ({
      email_key_version: c.keyVersion,
      email_lookup_hmac: c.digest,
    }))
  );
  const reported = await executor.execute<{
    email_key_version: number | string;
    email_lookup_hmac: string;
  }>(
    `/* growth:read-install-digest-reported-pairs */
     select r.email_key_version, r.email_lookup_hmac
     from growth_install_digest_reports r
     where (r.email_key_version, r.email_lookup_hmac) in (
       select c.email_key_version, c.email_lookup_hmac
       from jsonb_to_recordset($1::jsonb)
         as c(email_key_version smallint, email_lookup_hmac text)
     )`,
    [JSON.stringify(pairs)]
  );
  const hits = new Set(
    reported.rows.map(
      (r) => `${Number(r.email_key_version)}:${r.email_lookup_hmac}`
    )
  );
  if (hits.size === 0) return candidates;
  return candidates.filter((candidate) =>
    createEmailLookupCandidates(candidate.email, input.keyring!).every(
      (c) => !hits.has(`${c.keyVersion}:${c.digest}`)
    )
  );
}

/** Install subjects since `since` that carried no identity, and CI install subjects. */
export async function readInstallDigestContext(
  executor: SqlTransaction,
  input: { since: Date }
): Promise<InstallDigestContext> {
  if (!Number.isFinite(input.since.getTime())) {
    throw new Error('Install digest context requires a valid since date');
  }
  const result = await executor.execute<{
    anonymous: number | string;
    ci: number | string;
  }>(
    `/* growth:read-install-digest-context */
     select count(distinct o.subject_id) filter (where i.observation_id is null) as anonymous,
            count(distinct o.subject_id)
              filter (where coalesce(o.properties->>'environment', 'unknown') = 'ci') as ci
     from growth_observations o
     left join growth_observation_identities i
       on i.observation_id = o.id and i.email_normalized is not null
     where o.source = 'install'
       and o.kind = 'package.installed'
       and o.redacted_at is null
       and o.received_at >= $1`,
    [input.since]
  );
  const row = result.rows[0];
  return {
    since: input.since,
    anonymousInstallSubjects: Number(row?.anonymous ?? 0),
    ciInstallSubjects: Number(row?.ci ?? 0),
  };
}

/**
 * Enqueue one digest job for the idempotency key when at least one candidate
 * exists. Returns the new job id, or null when nothing was enqueued.
 */
export async function enqueueInstallDigestJob(
  executor: SqlTransaction,
  input: {
    now: Date;
    idempotencyKey: string;
    businessDate: string;
    keyring?: EmailHmacKeyring;
  }
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.businessDate)) {
    throw new Error('Install digest business date must be YYYY-MM-DD');
  }
  if (!input.idempotencyKey.startsWith('install_digest:')) {
    throw new Error(
      'Install digest idempotency key must start with install_digest:'
    );
  }
  const candidates = await readInstallDigestCandidates(executor, {
    limit: 1,
    keyring: input.keyring,
  });
  if (candidates.length === 0) return null;
  const result = await executor.execute<{ id: string }>(
    `/* growth:enqueue-install-digest */
     insert into growth_jobs (kind, status, available_at, idempotency_key, payload)
     values ('digest', 'pending', $1, $2,
             jsonb_build_object('business_date', $3::text, 'digest_kind', 'install_identities'))
     on conflict (idempotency_key) do nothing
     returning id`,
    [input.now, input.idempotencyKey, input.businessDate]
  );
  return result.rows[0]?.id ?? null;
}

/** Record reported identities; repeats are no-ops so a retried job never double-reports. */
export async function markInstallDigestReported(
  executor: SqlTransaction,
  input: {
    digestJobId: string;
    reportedAt: Date;
    candidates: readonly Pick<
      InstallDigestCandidate,
      'emailLookupHmac' | 'emailKeyVersion' | 'firstInstallObservationId'
    >[];
  }
): Promise<void> {
  if (input.candidates.length === 0) return;
  await executor.execute(
    `/* growth:mark-install-digest-reported */
     insert into growth_install_digest_reports
       (email_lookup_hmac, email_key_version, first_install_observation_id, digest_job_id, reported_at)
     select c.hmac, c.version, c.observation_id::uuid, $1::uuid, $2
     from jsonb_to_recordset($3::jsonb)
       as c(hmac text, version smallint, observation_id text)
     on conflict (email_key_version, email_lookup_hmac) do nothing`,
    [
      input.digestJobId,
      input.reportedAt,
      JSON.stringify(
        input.candidates.map((c) => ({
          hmac: c.emailLookupHmac,
          version: c.emailKeyVersion,
          observation_id: c.firstInstallObservationId,
        }))
      ),
    ]
  );
}
